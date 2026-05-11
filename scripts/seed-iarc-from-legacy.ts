#!/usr/bin/env npx tsx
/**
 * IARC → Canonical Ingredient Graph — migration from the legacy D1
 * (INGREDIENTS_REF_DB) into the new regulatory schema.
 *
 * The legacy table `ingredient_reference` already carries IARC columns
 * populated from an earlier ingestion run. Rather than re-scraping IARC
 * (which requires a data source we can't currently locate), we migrate
 * those rows into the grounded CIG.
 *
 * Canonical ID rules (keep IARC rows join-compatible with CFR rows):
 *   - CAS present + validly formatted → CAS_{cas_with_underscores}
 *   - Otherwise → NAME_{slug(agent_name)}
 *
 * Usage:
 *
 *   # 1. Export the legacy IARC rows:
 *   npx wrangler d1 execute alzhal-ingredients-ref --remote --json \
 *     --command "SELECT name, name_original, cas_number, pubchem_cid, molecular_formula, molecular_weight, iupac_name, iarc_group, iarc_description, iarc_agent_name FROM ingredient_reference WHERE iarc_group IS NOT NULL" \
 *     > scripts/bulk-data/iarc-legacy-export.json
 *
 *   # 2. Run this script:
 *   npx tsx scripts/seed-iarc-from-legacy.ts
 *
 *   # 3. Apply to the new regulatory D1:
 *   npx wrangler d1 execute alzhal-regulatory --remote \
 *     --file=scripts/d1-regulatory-iarc.sql
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const INPUT = path.join(process.cwd(), 'scripts', 'bulk-data', 'iarc-legacy-export.json')
const OUTPUT = path.join(process.cwd(), 'scripts', 'd1-regulatory-iarc.sql')

const INGESTER = 'seed-iarc-from-legacy'
const VERSION = '1.0.0'
const IARC_SOURCE_NAME = 'IARC Monographs — Agents Classified by the IARC Monographs'
const IARC_SOURCE_URL = 'https://monographs.iarc.who.int/list-of-classifications/'

type LegacyRow = {
  name: string
  name_original?: string | null
  cas_number?: string | null
  pubchem_cid?: number | null
  molecular_formula?: string | null
  molecular_weight?: string | number | null
  iupac_name?: string | null
  iarc_group: string
  iarc_description?: string | null
  iarc_agent_name?: string | null
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  '1':  'Carcinogenic to humans',
  '2A': 'Probably carcinogenic to humans',
  '2B': 'Possibly carcinogenic to humans',
  '3':  'Not classifiable as to carcinogenicity in humans',
}

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === '') return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function isValidCas(cas: string | null | undefined): boolean {
  if (!cas) return false
  return /^\d{3,7}-\d{2}-\d$/.test(cas.trim())
}

function canonicalId(row: LegacyRow): string {
  const cas = row.cas_number?.trim()
  if (cas && isValidCas(cas)) {
    return `CAS_${cas.replace(/-/g, '_')}`
  }
  const name = row.iarc_agent_name || row.name_original || row.name
  return `NAME_${slug(name)}`
}

function normalizeAlias(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

function loadLegacyExport(): LegacyRow[] {
  if (!existsSync(INPUT)) {
    console.error(`No legacy export file at ${INPUT}`)
    console.error('')
    console.error('Generate it first with:')
    console.error('  npx wrangler d1 execute alzhal-ingredients-ref --remote --json \\')
    console.error('    --command "SELECT name, name_original, cas_number, pubchem_cid, molecular_formula, molecular_weight, iupac_name, iarc_group, iarc_description, iarc_agent_name FROM ingredient_reference WHERE iarc_group IS NOT NULL" \\')
    console.error(`    > ${INPUT.replace(process.cwd() + '/', '')}`)
    process.exit(2)
  }

  const raw = readFileSync(INPUT, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error(`Cannot parse ${INPUT} as JSON:`, (e as Error).message)
    process.exit(2)
  }

  // wrangler --json returns [{ results: [...], success, meta, ... }]
  if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object' && 'results' in (parsed[0] as any)) {
    return ((parsed[0] as any).results || []) as LegacyRow[]
  }
  // Accept raw array of rows too
  if (Array.isArray(parsed)) {
    return parsed as LegacyRow[]
  }
  // Accept { results: [...] }
  if (typeof parsed === 'object' && parsed && 'results' in (parsed as any)) {
    return ((parsed as any).results || []) as LegacyRow[]
  }
  console.error('Unrecognized JSON shape. Expected wrangler d1 --json output (array with results) or a plain array.')
  process.exit(2)
}

function main() {
  const rows = loadLegacyExport()
  console.log(`Loaded ${rows.length} legacy IARC rows`)

  // Filter: skip rows missing both a group and a name
  const valid = rows.filter(r => r.iarc_group && (r.iarc_agent_name || r.name_original || r.name))
  const skipped = rows.length - valid.length
  if (skipped > 0) console.log(`  skipped ${skipped} rows missing iarc_group or name`)

  const groups: Record<string, number> = {}
  for (const r of valid) groups[r.iarc_group] = (groups[r.iarc_group] || 0) + 1
  console.log('  groups:', groups)

  const snapshotDate = new Date().toISOString().slice(0, 10)
  const lines: string[] = []

  lines.push('-- ============================================================')
  lines.push(`-- IARC Monographs -> Canonical Ingredient Graph (from legacy DB)`)
  lines.push(`-- Generated: ${new Date().toISOString()}`)
  lines.push(`-- Ingester:  ${INGESTER} v${VERSION}`)
  lines.push(`-- Entries:   ${valid.length}`)
  lines.push(`-- Source:    ${IARC_SOURCE_URL}`)
  lines.push(`-- Origin:    legacy INGREDIENTS_REF_DB.ingredient_reference`)
  lines.push('-- ============================================================')
  lines.push('')
  // Note: D1 rejects raw BEGIN TRANSACTION. Idempotent ON CONFLICT clauses provide safety.
  lines.push('')
  lines.push(`INSERT INTO ingestion_run (ingester_name, ingester_version, status) VALUES (${esc(INGESTER)}, ${esc(VERSION)}, 'running');`)
  lines.push('')

  lines.push('-- Evidence row: single IARC list, dated at migration time')
  lines.push(
    `INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by) ` +
    `VALUES (${esc(IARC_SOURCE_NAME)}, ${esc(IARC_SOURCE_URL)}, 'Full classification list (migrated from legacy)', ${esc(snapshotDate)}, 'en', ${esc(INGESTER + ':' + VERSION)}) ` +
    `ON CONFLICT(source_url, snapshot_date) DO NOTHING;`
  )
  lines.push('')

  const seenCanonical = new Set<string>()
  let ingredientCount = 0
  let aliasCount = 0
  let factCount = 0

  for (const r of valid) {
    const id = canonicalId(r)
    const primaryName = (r.iarc_agent_name || r.name_original || r.name).trim()
    const cas = r.cas_number?.trim()
    const hasCas = cas && isValidCas(cas)

    if (!seenCanonical.has(id)) {
      seenCanonical.add(id)
      const formula = r.molecular_formula || null
      const mw = r.molecular_weight != null ? Number(r.molecular_weight) : null
      const mwSql = mw != null && !isNaN(mw) ? mw.toString() : 'NULL'

      lines.push(
        `INSERT INTO ingredient (canonical_id, primary_name, ingredient_class, cas_number, pubchem_cid, molecular_formula, molecular_weight, category, is_natural) ` +
        `VALUES (${esc(id)}, ${esc(primaryName)}, 'substance', ${hasCas ? esc(cas) : 'NULL'}, ` +
        `${r.pubchem_cid ?? 'NULL'}, ${esc(formula)}, ${mwSql}, 'multi', 0) ` +
        `ON CONFLICT(canonical_id) DO NOTHING;`
      )
      ingredientCount++

      // Alias: primary IARC agent name
      lines.push(
        `INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) ` +
        `VALUES (${esc(id)}, ${esc(primaryName)}, ${esc(normalizeAlias(primaryName))}, 'synonym', 'en', 1.0, 'IARC-legacy') ` +
        `ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;`
      )
      aliasCount++

      // Alias: CAS number, if present
      if (hasCas) {
        lines.push(
          `INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) ` +
          `VALUES (${esc(id)}, ${esc(cas)}, ${esc(normalizeAlias(cas!))}, 'cas', NULL, 1.0, 'IARC-legacy') ` +
          `ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;`
        )
        aliasCount++
      }

      // Alias: legacy lowercased name, if different from primary
      if (r.name && r.name.toLowerCase() !== primaryName.toLowerCase()) {
        lines.push(
          `INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) ` +
          `VALUES (${esc(id)}, ${esc(r.name)}, ${esc(normalizeAlias(r.name))}, 'synonym', 'en', 0.9, 'IARC-legacy') ` +
          `ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;`
        )
        aliasCount++
      }
    }

    // Regulatory fact: the IARC classification
    const description = r.iarc_description || GROUP_DESCRIPTIONS[r.iarc_group] || ''
    const status = `WHO/IARC Group ${r.iarc_group} — ${description}`
    const regRef = `IARC Monographs — Group ${r.iarc_group}`

    lines.push(
      `INSERT INTO regulatory_fact (canonical_id, jurisdiction, fact_type, status, regulation_ref, evidence_id) ` +
      `VALUES (${esc(id)}, 'WHO_IARC', 'classification', ${esc(status)}, ${esc(regRef)}, ` +
      `(SELECT id FROM fact_evidence WHERE source_url = ${esc(IARC_SOURCE_URL)} AND snapshot_date = ${esc(snapshotDate)} LIMIT 1));`
    )
    factCount++
  }

  lines.push('')
  lines.push(
    `UPDATE ingestion_run SET finished_at = datetime('now'), status = 'completed', rows_inserted = ${ingredientCount + aliasCount + factCount} ` +
    `WHERE id = (SELECT id FROM ingestion_run WHERE ingester_name = ${esc(INGESTER)} AND status = 'running' ORDER BY started_at DESC LIMIT 1);`
  )
  lines.push('')

  writeFileSync(OUTPUT, lines.join('\n'))

  console.log('')
  console.log(`Wrote ${OUTPUT}`)
  console.log(`  ingredients: ${ingredientCount}`)
  console.log(`  aliases:     ${aliasCount}`)
  console.log(`  facts:       ${factCount}`)
  console.log('')
  console.log('Apply:')
  console.log(`  npx wrangler d1 execute alzhal-regulatory --remote --file=${path.relative(process.cwd(), OUTPUT)}`)
}

main()
