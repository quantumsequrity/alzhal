#!/usr/bin/env npx tsx
/**
 * Extract unique ingredient names from FOOD_DB (D1) for seeding the ingredients reference database.
 *
 * Queries all ingredients_text from food_products, splits on commas/semicolons,
 * normalizes and aggressively filters to keep only English chemical/food ingredient names.
 *
 * Key filters:
 * - ASCII-only (filters out CJK, Cyrillic, Arabic, etc.)
 * - 3-60 chars (too short = abbreviations, too long = descriptions)
 * - No URLs, emails, pure numbers
 * - Frequency-based: only keep names that appear in 2+ products (filters one-off typos/brand names)
 * - Blocklist for common non-ingredient tokens (brand names, countries, etc.)
 *
 * Usage:
 *   npx tsx scripts/extract-ingredient-names.ts
 *
 * Output: scripts/ingredient-seed-list.json (~30-50k names)
 */

import { writeFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

const OUTPUT_FILE = path.join(process.cwd(), 'scripts', 'ingredient-seed-list.json')
const BATCH_SIZE = 5000
const DB_NAME = 'alzhal-food'
const MIN_FREQUENCY = 20 // Ingredient must appear in at least 20 products

// Non-ingredient tokens to filter out
const BLOCKLIST = new Set([
  'and', 'or', 'with', 'from', 'the', 'for', 'may', 'contain', 'contains',
  'less', 'than', 'more', 'added', 'not', 'see', 'ingredients', 'ingredient',
  'product', 'made', 'organic', 'natural', 'artificial', 'flavor', 'flavors',
  'flavoring', 'colour', 'color', 'certified', 'grade', 'quality', 'premium',
  'free', 'range', 'farm', 'fresh', 'pure', 'real', 'original', 'classic',
  'style', 'type', 'brand', 'tm', 'registered', 'trademark',
  'see back panel', 'allergen information', 'nutrition facts',
  'best before', 'use by', 'keep refrigerated', 'store in',
  'warning', 'caution', 'attention', 'manufactured', 'distributed',
  'produced', 'packed', 'imported', 'exported',
])

function normalize(raw: string): string {
  let s = raw.trim().toLowerCase()
  // Strip parenthetical sub-ingredients: "sugar (cane)" → "sugar"
  s = s.replace(/\s*\([^)]*\)/g, '')
  // Strip leading "e" number prefix but keep as separate: "e330 citric acid" → "citric acid"
  // But keep standalone E-numbers: "e330" stays
  s = s.replace(/^e\d{3}[a-z]?\s+/i, '')
  // Strip leading numbers/percentages: "2% milk" → "milk"
  s = s.replace(/^\d+\.?\d*%?\s+/, '')
  // Strip trailing periods/colons/asterisks
  s = s.replace(/[.:*]+$/, '')
  // Strip leading/trailing quotes
  s = s.replace(/^["']+|["']+$/g, '')
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function isValidIngredient(name: string): boolean {
  // Length filter: 3-60 chars
  if (name.length < 3 || name.length > 60) return false

  // ASCII-only (filters CJK, Cyrillic, Arabic, accented-heavy text)
  // Allow basic latin, numbers, spaces, hyphens, apostrophes, periods
  if (!/^[a-z0-9\s\-'.,:\/]+$/.test(name)) return false

  // Must contain at least one letter
  if (!/[a-z]/.test(name)) return false

  // No URLs or emails
  if (name.includes('http') || name.includes('www.') || name.includes('@')) return false

  // Filter pure numbers or number-heavy strings
  const letterCount = (name.match(/[a-z]/g) || []).length
  if (letterCount < 3) return false

  // Filter if it's in the blocklist
  if (BLOCKLIST.has(name)) return false

  // Filter strings that look like sentences (more than 6 words = probably a description)
  const words = name.split(/\s+/)
  if (words.length > 6) return false

  // Filter if starts with common non-ingredient words
  const firstWord = words[0]
  if (['please', 'warning', 'caution', 'note', 'see', 'visit', 'call', 'contact'].includes(firstWord)) return false

  return true
}

function splitIngredients(text: string): string[] {
  // Split on comma, semicolon, or " - " (common in ingredient lists)
  return text
    .split(/[,;]|\s-\s/)
    .map(normalize)
    .filter(isValidIngredient)
}

async function main() {
  console.log('Extracting ingredient names from FOOD_DB...')

  // Track frequency: name → count of products it appears in
  const frequency = new Map<string, number>()
  let offset = 0
  let totalRows = 0

  // Get total count first
  try {
    const countResult = execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT COUNT(*) as cnt FROM food_products WHERE ingredients_text != '' AND ingredients_text IS NOT NULL" --json`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    )
    const parsed = JSON.parse(countResult)
    const total = parsed?.[0]?.results?.[0]?.cnt || 0
    console.log(`Total rows with ingredients: ${total}`)
  } catch (e) {
    console.error('Failed to get count, continuing anyway...')
  }

  while (true) {
    console.log(`Fetching batch at offset ${offset}...`)

    try {
      const result = execSync(
        `npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT ingredients_text FROM food_products WHERE ingredients_text != '' AND ingredients_text IS NOT NULL LIMIT ${BATCH_SIZE} OFFSET ${offset}" --json`,
        { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 }
      )

      const parsed = JSON.parse(result)
      const rows = parsed?.[0]?.results || []

      if (rows.length === 0) break

      for (const row of rows) {
        if (row.ingredients_text) {
          const names = splitIngredients(row.ingredients_text)
          // Deduplicate per-row to count product frequency (not raw occurrence)
          const seen = new Set<string>()
          for (const name of names) {
            if (!seen.has(name)) {
              seen.add(name)
              frequency.set(name, (frequency.get(name) || 0) + 1)
            }
          }
        }
      }

      totalRows += rows.length
      console.log(`  Processed ${totalRows} rows, ${frequency.size} unique candidates so far`)

      if (rows.length < BATCH_SIZE) break
      offset += BATCH_SIZE
    } catch (e: any) {
      console.error(`Error at offset ${offset}:`, e.message?.slice(0, 200))
      offset += BATCH_SIZE
      if (offset > 2_000_000) break // Safety cap
    }
  }

  // Filter by minimum frequency and sort
  const filtered = Array.from(frequency.entries())
    .filter(([, count]) => count >= MIN_FREQUENCY)
    .map(([name]) => name)
    .sort()

  writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 0))
  console.log(`\nDone!`)
  console.log(`  Total rows processed: ${totalRows}`)
  console.log(`  Raw unique candidates: ${frequency.size}`)
  console.log(`  After frequency filter (>=${MIN_FREQUENCY}): ${filtered.length}`)
  console.log(`  Output: ${OUTPUT_FILE}`)
}

main().catch(console.error)
