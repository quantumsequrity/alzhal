#!/usr/bin/env npx tsx
/**
 * Eval harness — measures the grounded-rendering guarantees against a fixed
 * gold-standard set of ingredients.
 *
 * Three layers:
 *
 *   1. Deterministic verdict test — `computeVerdict(facts)` must match the
 *      expected verdict for each gold case. No LLM. Pure logic.
 *
 *   2. Jurisdiction-leak test — `validateNoJurisdictionLeak` must detect
 *      hallucinated mentions of jurisdictions not present in the input facts.
 *
 *   3. Integration test (optional) — when GEMINI_API_KEY is set, call
 *      `renderGroundedFacts` with mock inputs and assert the output never
 *      mentions a jurisdiction absent from the input.
 *
 * The unit layers (1 + 2) run in <1s with no network. They are the quality
 * gate that proves "no hallucinations" is structural, not wishful.
 *
 * Usage:
 *   npm run eval
 *   # or, to include live Gemini calls:
 *   GEMINI_API_KEY=... npm run eval
 *
 * Exit code: 0 if all tests pass, 1 if any fail.
 */

import {
  computeVerdict,
  missingJurisdictions,
  renderGroundedFacts,
  validateNoJurisdictionLeak,
  type GroundedIngredientFacts,
  type RegulatoryFact,
  type RenderedAnalysis,
  type Verdict,
} from '../lib/gemini-renderer'

// ----- Test data builders -----

const IARC_URL = 'https://monographs.iarc.who.int/list-of-classifications/'
const ECFR_URL_BASE = 'https://www.ecfr.gov/current/title-21/chapter-I'
const SNAPSHOT = '2026-04-16'

function iarcFact(group: '1' | '2A' | '2B' | '3', description: string): RegulatoryFact {
  return {
    jurisdiction: 'WHO_IARC',
    fact_type: 'classification',
    status: `WHO/IARC Group ${group} — ${description}`,
    regulation_ref: `IARC Monographs — Group ${group}`,
    source_url: IARC_URL,
    source_name: 'IARC Monographs — Agents Classified by the IARC Monographs',
    snapshot_date: SNAPSHOT,
  }
}

function fdaGrasFact(section: string, substanceName: string): RegulatoryFact {
  return {
    jurisdiction: 'US_FDA',
    fact_type: 'gras',
    status: `Affirmed as GRAS — ${substanceName} (21 CFR §${section})`,
    regulation_ref: `21 CFR §${section}`,
    source_url: `${ECFR_URL_BASE}/subchapter-B/part-184#p-${section}`,
    source_name: 'FDA CFR Title 21 Part 184 — GRAS Direct Food Substances',
    snapshot_date: SNAPSHOT,
  }
}

function fdaProhibitedFact(section: string, substanceName: string): RegulatoryFact {
  return {
    jurisdiction: 'US_FDA',
    fact_type: 'prohibited',
    status: `Prohibited from use in human food — ${substanceName} (21 CFR §${section})`,
    regulation_ref: `21 CFR §${section}`,
    source_url: `${ECFR_URL_BASE}/subchapter-B/part-189#p-${section}`,
    source_name: 'FDA CFR Title 21 Part 189 — Substances Prohibited from Use in Human Food',
    snapshot_date: SNAPSHOT,
  }
}

function mockFacts(canonical_id: string, primary_name: string, facts: RegulatoryFact[], isNatural = false): GroundedIngredientFacts {
  return {
    canonical_id,
    primary_name,
    aliases: [primary_name],
    ingredient_class: 'substance',
    category: 'food',
    is_natural: isNatural,
    facts,
  }
}

// ----- Gold cases -----
// Every entry references real, publicly verifiable regulatory data.
// Where a CAS is cited, it is the authoritative CAS Registry Number.

type GoldCase = {
  id: string
  description: string
  input: GroundedIngredientFacts
  expected_verdict: Verdict
  verdict_reason_contains: string[]
}

const GOLD_CASES: GoldCase[] = [
  // --- BANNED: IARC Group 1 ---
  {
    id: 'asbestos-iarc-g1',
    description: 'Asbestos (all forms) — IARC Group 1',
    input: mockFacts('CAS_1332_21_4', 'Asbestos', [iarcFact('1', 'Carcinogenic to humans')]),
    expected_verdict: 'BANNED',
    verdict_reason_contains: ['IARC', 'Group 1'],
  },
  {
    id: 'benzene-iarc-g1',
    description: 'Benzene — IARC Group 1',
    input: mockFacts('CAS_71_43_2', 'Benzene', [iarcFact('1', 'Carcinogenic to humans')]),
    expected_verdict: 'BANNED',
    verdict_reason_contains: ['IARC', 'Group 1'],
  },
  {
    id: 'formaldehyde-iarc-g1',
    description: 'Formaldehyde — IARC Group 1',
    input: mockFacts('CAS_50_00_0', 'Formaldehyde', [iarcFact('1', 'Carcinogenic to humans')]),
    expected_verdict: 'BANNED',
    verdict_reason_contains: ['IARC', 'Group 1'],
  },

  // --- BANNED: explicit FDA prohibition ---
  {
    id: 'coumarin-fda-prohibited',
    description: 'Coumarin — prohibited by FDA per 21 CFR §189.130',
    input: mockFacts('CAS_91_64_5', 'Coumarin', [fdaProhibitedFact('189.130', 'Coumarin')]),
    expected_verdict: 'BANNED',
    verdict_reason_contains: ['Prohibited', 'US_FDA'],
  },
  {
    id: 'safrole-fda-prohibited',
    description: 'Safrole — prohibited by FDA per 21 CFR §189.180',
    input: mockFacts('CAS_94_59_7', 'Safrole', [fdaProhibitedFact('189.180', 'Safrole')]),
    expected_verdict: 'BANNED',
    verdict_reason_contains: ['Prohibited'],
  },

  // --- AVOID: IARC Group 2A ---
  {
    id: 'glyphosate-iarc-g2a',
    description: 'Glyphosate — IARC Group 2A',
    input: mockFacts('CAS_1071_83_6', 'Glyphosate', [iarcFact('2A', 'Probably carcinogenic to humans')]),
    expected_verdict: 'AVOID',
    verdict_reason_contains: ['IARC', 'Group 2A'],
  },
  {
    id: 'acrylamide-iarc-g2a',
    description: 'Acrylamide — IARC Group 2A',
    input: mockFacts('CAS_79_06_1', 'Acrylamide', [iarcFact('2A', 'Probably carcinogenic to humans')]),
    expected_verdict: 'AVOID',
    verdict_reason_contains: ['IARC', 'Group 2A'],
  },

  // --- CAUTION: IARC Group 2B ---
  {
    id: 'aspartame-iarc-g2b',
    description: 'Aspartame — IARC Group 2B (IARC 2023 evaluation)',
    input: mockFacts('CAS_22839_47_0', 'Aspartame', [iarcFact('2B', 'Possibly carcinogenic to humans')]),
    expected_verdict: 'CAUTION',
    verdict_reason_contains: ['IARC', 'Group 2B'],
  },
  {
    id: 'styrene-iarc-g2b',
    description: 'Styrene — IARC Group 2B',
    input: mockFacts('CAS_100_42_5', 'Styrene', [iarcFact('2B', 'Possibly carcinogenic to humans')]),
    expected_verdict: 'CAUTION',
    verdict_reason_contains: ['IARC', 'Group 2B'],
  },
  {
    id: 'gasoline-iarc-g2b',
    description: 'Gasoline — IARC Group 2B',
    input: mockFacts('CAS_8006_61_9', 'Gasoline', [iarcFact('2B', 'Possibly carcinogenic to humans')]),
    expected_verdict: 'CAUTION',
    verdict_reason_contains: ['IARC', 'Group 2B'],
  },

  // --- SAFE: FDA GRAS (21 CFR §184) ---
  {
    id: 'acetic-acid-gras',
    description: 'Acetic acid — GRAS per 21 CFR §184.1005',
    input: mockFacts('CAS_64_19_7', 'Acetic acid', [fdaGrasFact('184.1005', 'Acetic acid')]),
    expected_verdict: 'SAFE',
    verdict_reason_contains: ['GRAS', '184.1005'],
  },
  {
    id: 'glycerin-gras',
    description: 'Glycerin — GRAS per 21 CFR §184.1027',
    input: mockFacts('CAS_56_81_5', 'Glycerin', [fdaGrasFact('184.1027', 'Glycerin')]),
    expected_verdict: 'SAFE',
    verdict_reason_contains: ['GRAS', '184.1027'],
  },
  {
    id: 'citric-acid-gras',
    description: 'Citric acid — GRAS per 21 CFR §184.1033',
    input: mockFacts('CAS_77_92_9', 'Citric acid', [fdaGrasFact('184.1033', 'Citric acid')]),
    expected_verdict: 'SAFE',
    verdict_reason_contains: ['GRAS', '184.1033'],
  },
  {
    id: 'lactic-acid-gras',
    description: 'Lactic acid — GRAS per 21 CFR §184.1061',
    input: mockFacts('CAS_50_21_5', 'Lactic acid', [fdaGrasFact('184.1061', 'Lactic acid')]),
    expected_verdict: 'SAFE',
    verdict_reason_contains: ['GRAS'],
  },

  // --- SAFE: natural ingredient with only IARC Group 3 (not classifiable) ---
  {
    id: 'caffeine-iarc-g3-natural',
    description: 'Caffeine — IARC Group 3 (not classifiable); natural → SAFE',
    input: mockFacts(
      'CAS_58_08_2',
      'Caffeine',
      [iarcFact('3', 'Not classifiable as to carcinogenicity in humans')],
      true, // is_natural
    ),
    expected_verdict: 'SAFE',
    verdict_reason_contains: ['Group 3'],
  },

  // --- UNKNOWN: no facts ---
  {
    id: 'novel-unknown-1',
    description: 'Made-up substance with no regulatory records → UNKNOWN',
    input: mockFacts('CAS_0_00_0', 'Fake-substance-XYZ-2026', []),
    expected_verdict: 'UNKNOWN',
    verdict_reason_contains: ['No official regulatory record'],
  },
  {
    id: 'novel-unknown-2',
    description: 'Natural-but-unindexed herb with no facts → UNKNOWN',
    input: mockFacts('NAME_obscure_herb_xyz', 'Obscure-Herb-XYZ', [], true),
    expected_verdict: 'UNKNOWN',
    verdict_reason_contains: ['No official'],
  },

  // --- Multi-jurisdiction: FDA GRAS + IARC Group 3 → SAFE ---
  {
    id: 'calcium-carbonate-safe',
    description: 'Calcium carbonate — GRAS (21 CFR §184.1191) + IARC Group 3',
    input: mockFacts(
      'CAS_471_34_1',
      'Calcium carbonate',
      [
        fdaGrasFact('184.1191', 'Calcium carbonate'),
        iarcFact('3', 'Not classifiable as to carcinogenicity'),
      ],
    ),
    expected_verdict: 'SAFE',
    verdict_reason_contains: ['GRAS'],
  },

  // --- Conflict: FDA GRAS + IARC Group 2B → CAUTION wins (safety ratchet up) ---
  {
    id: 'conflict-gras-vs-iarc2b',
    description: 'Hypothetical conflict — GRAS in US but IARC Group 2B → CAUTION',
    input: mockFacts(
      'CAS_TEST_CONFLICT',
      'Test-conflict-substance',
      [
        fdaGrasFact('184.9999', 'Test substance'),
        iarcFact('2B', 'Possibly carcinogenic to humans'),
      ],
    ),
    expected_verdict: 'CAUTION',
    verdict_reason_contains: ['2B'],
  },

  // --- Conflict: IARC Group 1 overrides FDA GRAS → BANNED ---
  {
    id: 'conflict-iarc1-overrides-gras',
    description: 'Hypothetical conflict — GRAS in US but IARC Group 1 → BANNED',
    input: mockFacts(
      'CAS_TEST_OVERRIDE',
      'Test-override-substance',
      [
        fdaGrasFact('184.9998', 'Test substance'),
        iarcFact('1', 'Carcinogenic to humans'),
      ],
    ),
    expected_verdict: 'BANNED',
    verdict_reason_contains: ['Group 1'],
  },
]

// ----- Test runner -----

type TestResult = {
  id: string
  description: string
  passed: boolean
  failures: string[]
}

function verdictTest(gc: GoldCase): TestResult {
  const { verdict, reason } = computeVerdict(gc.input.facts, gc.input.is_natural)
  const failures: string[] = []

  if (verdict !== gc.expected_verdict) {
    failures.push(`verdict: expected "${gc.expected_verdict}", got "${verdict}"`)
  }

  for (const needle of gc.verdict_reason_contains) {
    if (!reason.toLowerCase().includes(needle.toLowerCase())) {
      failures.push(`verdict_reason missing substring "${needle}" — got: "${reason}"`)
    }
  }

  // Every fact must have a non-empty source_url — architectural guarantee.
  for (const f of gc.input.facts) {
    if (!f.source_url) {
      failures.push(`fact with jurisdiction=${f.jurisdiction} has no source_url`)
    }
  }

  return { id: gc.id, description: gc.description, passed: failures.length === 0, failures }
}

function leakValidatorTest(): TestResult[] {
  const results: TestResult[] = []

  // Test 1: rendered text mentions FSSAI but only IARC was in facts → must detect leak
  const rendered1: RenderedAnalysis = {
    canonical_id: 'CAS_71_43_2',
    primary_name: 'Benzene',
    verdict: 'BANNED',
    verdict_reason: 'IARC Group 1',
    simple_name: 'A chemical that causes cancer',
    how_its_made: null,
    safety_summary: 'WHO/IARC says this is a Group 1 carcinogen. Also FSSAI restricts it in India.', // FSSAI not in facts
    per_jurisdiction: [],
    missing_jurisdictions: [],
    citations: [],
    sources_used: [],
  }
  const leak1 = validateNoJurisdictionLeak(rendered1, new Set(['WHO_IARC']))
  results.push({
    id: 'leak-detect-fssai-mention',
    description: 'validateNoJurisdictionLeak detects FSSAI mention when only IARC in facts',
    passed: !leak1.ok && leak1.leaks.includes('IN_FSSAI'),
    failures: !leak1.ok && leak1.leaks.includes('IN_FSSAI') ? [] : [`expected leak IN_FSSAI, got ${JSON.stringify(leak1)}`],
  })

  // Test 2: rendered text only mentions WHO/IARC, which IS in facts → no leak
  const rendered2: RenderedAnalysis = {
    canonical_id: 'CAS_71_43_2',
    primary_name: 'Benzene',
    verdict: 'BANNED',
    verdict_reason: 'IARC Group 1',
    simple_name: 'A chemical that causes cancer',
    how_its_made: null,
    safety_summary: 'WHO/IARC classifies this as Group 1 — carcinogenic to humans.',
    per_jurisdiction: [],
    missing_jurisdictions: [],
    citations: [],
    sources_used: [],
  }
  const leak2 = validateNoJurisdictionLeak(rendered2, new Set(['WHO_IARC']))
  results.push({
    id: 'leak-detect-no-false-positive',
    description: 'validateNoJurisdictionLeak does not flag allowed WHO_IARC mention',
    passed: leak2.ok,
    failures: leak2.ok ? [] : [`unexpected leaks: ${JSON.stringify(leak2.leaks)}`],
  })

  // Test 3: multiple leaked jurisdictions
  const rendered3: RenderedAnalysis = {
    canonical_id: 'CAS_71_43_2',
    primary_name: 'Benzene',
    verdict: 'BANNED',
    verdict_reason: 'IARC Group 1',
    simple_name: 'X',
    how_its_made: null,
    safety_summary: 'FDA approves; EU banned; FSSAI restricts; BIS has no record.',
    per_jurisdiction: [],
    missing_jurisdictions: [],
    citations: [],
    sources_used: [],
  }
  const leak3 = validateNoJurisdictionLeak(rendered3, new Set(['WHO_IARC']))
  const expectedLeaks = ['US_FDA', 'EU', 'IN_FSSAI', 'IN_BIS']
  const allExpectedDetected = expectedLeaks.every(j => leak3.leaks.includes(j))
  results.push({
    id: 'leak-detect-multiple',
    description: 'validateNoJurisdictionLeak catches multiple simultaneous leaks',
    passed: !leak3.ok && allExpectedDetected,
    failures: (!leak3.ok && allExpectedDetected) ? [] : [`expected leaks including ${expectedLeaks.join(',')}, got ${JSON.stringify(leak3.leaks)}`],
  })

  return results
}

function missingJurisdictionsTest(): TestResult[] {
  const facts = [iarcFact('1', 'Carcinogenic to humans'), fdaGrasFact('184.1005', 'Acetic acid')]
  const missing = missingJurisdictions(facts)
  const shouldBePresent = ['WHO_IARC', 'US_FDA']
  const anyPresentMarkedMissing = shouldBePresent.filter(j => missing.includes(j))
  const passed = anyPresentMarkedMissing.length === 0 && missing.length > 0

  return [{
    id: 'missing-jurisdictions',
    description: 'missingJurisdictions returns checked-but-absent list correctly',
    passed,
    failures: passed ? [] : [
      `present jurisdictions marked missing: ${anyPresentMarkedMissing.join(',')}`,
      `full missing list: ${missing.join(',')}`,
    ],
  }]
}

async function integrationTest(): Promise<TestResult[]> {
  if (!process.env.GEMINI_API_KEY) {
    return [{
      id: 'integration-skip',
      description: 'Integration tests skipped (no GEMINI_API_KEY)',
      passed: true,
      failures: [],
    }]
  }

  const results: TestResult[] = []
  const subset: GoldCase[] = [
    GOLD_CASES.find(g => g.id === 'asbestos-iarc-g1')!,
    GOLD_CASES.find(g => g.id === 'acetic-acid-gras')!,
    GOLD_CASES.find(g => g.id === 'novel-unknown-1')!,
  ]

  for (const gc of subset) {
    try {
      const rendered = await renderGroundedFacts(gc.input, 'English')
      const allowed = new Set(gc.input.facts.map(f => f.jurisdiction))
      const leak = validateNoJurisdictionLeak(rendered, allowed)

      const failures: string[] = []
      if (rendered.verdict !== gc.expected_verdict) {
        failures.push(`verdict mismatch: expected ${gc.expected_verdict}, got ${rendered.verdict}`)
      }
      if (!leak.ok) {
        failures.push(`jurisdiction leak in rendered output: ${leak.leaks.join(',')}`)
      }
      results.push({
        id: `integration-${gc.id}`,
        description: `live Gemini render — ${gc.description}`,
        passed: failures.length === 0,
        failures,
      })
    } catch (err) {
      results.push({
        id: `integration-${gc.id}`,
        description: `live Gemini render — ${gc.description}`,
        passed: false,
        failures: [`exception: ${(err as Error).message}`],
      })
    }
  }

  return results
}

async function main() {
  const allResults: TestResult[] = []

  console.log('\n=== Eval harness: grounded-rendering guarantees ===\n')

  console.log(`Layer 1: deterministic verdict (${GOLD_CASES.length} gold cases)`)
  for (const gc of GOLD_CASES) {
    allResults.push(verdictTest(gc))
  }

  console.log(`Layer 2: jurisdiction-leak validator`)
  allResults.push(...leakValidatorTest())

  console.log(`Layer 3: missingJurisdictions helper`)
  allResults.push(...missingJurisdictionsTest())

  console.log(`Layer 4: integration (live Gemini) ${process.env.GEMINI_API_KEY ? '— running' : '— skipped, no GEMINI_API_KEY'}`)
  allResults.push(...(await integrationTest()))

  // Print per-test results
  const failed = allResults.filter(r => !r.passed)
  const passed = allResults.filter(r => r.passed)

  console.log('')
  for (const r of allResults) {
    const icon = r.passed ? '✓' : '✗'
    console.log(`  ${icon} ${r.id}  —  ${r.description}`)
    if (!r.passed) {
      for (const f of r.failures) console.log(`      ${f}`)
    }
  }

  // Summary
  console.log('')
  console.log('─'.repeat(60))
  console.log(`Total: ${allResults.length}   Passed: ${passed.length}   Failed: ${failed.length}`)
  console.log('─'.repeat(60))

  if (failed.length > 0) {
    console.log('\nFailed tests:')
    for (const r of failed) console.log(`  - ${r.id}: ${r.failures.join('; ')}`)
    process.exit(1)
  }

  console.log('\nAll tests passed. Hallucination guardrails verified.')
  process.exit(0)
}

main().catch(err => {
  console.error('Eval harness crashed:', err)
  process.exit(2)
})
