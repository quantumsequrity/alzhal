// OFFICIAL DATA SOURCES - DETERMINISTIC LAYER
// 1. OpenFoodFacts / OpenBeautyFacts (Global Product DB)
// 2. CAS Common Chemistry (Chemical Identity)
// 3. OpenFDA (Adverse Events + Recalls)
// 4. EPA CompTox (Chemical Safety)
// 5. PubChem (Chemical Identity & Properties)

import { cacheExternalData, getCachedExternalData } from './cache'

const HEADERS = { 'User-Agent': 'ConsumerTruth-Hackathon/1.0 (bloodraven@example.com)' }

// Timeout for external API calls (8 seconds)
const FETCH_TIMEOUT = 8000

// Circuit breaker: stop calling APIs after consecutive failures
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000 // 5 minutes

interface CircuitBreakerState {
  failCount: number
  isOpen: boolean
  openedAt: number
}

const circuits: Record<string, CircuitBreakerState> = {
  cas: { failCount: 0, isOpen: false, openedAt: 0 },
  fda: { failCount: 0, isOpen: false, openedAt: 0 },
  pubchem: { failCount: 0, isOpen: false, openedAt: 0 },
}

function isCircuitOpen(name: string): boolean {
  const cb = circuits[name]
  if (!cb || !cb.isOpen) return false
  if (Date.now() - cb.openedAt > CIRCUIT_BREAKER_RESET_MS) {
    cb.isOpen = false
    cb.failCount = 0
    console.log(`[${name.toUpperCase()}] Circuit breaker reset - retrying API calls`)
    return false
  }
  return true
}

function recordFailure(name: string): void {
  const cb = circuits[name]
  if (!cb) return
  cb.failCount++
  if (cb.failCount >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.isOpen = true
    cb.openedAt = Date.now()
    console.warn(`[${name.toUpperCase()}] Circuit breaker OPEN after ${cb.failCount} failures. Pausing for 5 min.`)
  }
}

function recordSuccess(name: string): void {
  const cb = circuits[name]
  if (cb) cb.failCount = 0
}

// PubChem types
export interface PubChemData {
  cid: number | null
  molecular_formula: string | null
  molecular_weight: string | null
  iupac_name: string | null
  pubchem_url: string | null
}

// FDA Recalls types
export interface FDARecallData {
  total_recalls: number
  recent_recalls: Array<{
    reason: string
    classification: string
    status: string
  }>
}

// Enriched data per ingredient from all external APIs
export interface EnrichedIngredientData {
  cas_number: string
  fda_reports: number
  epa_link: string | null
  pubchem: PubChemData | null
  fda_recalls: FDARecallData | null
  sources_checked: string[]
}

// Helper function to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// --- 1. OPEN FOOD/BEAUTY FACTS (The "Everything" Engine) ---
export async function searchOpenWebFacts(query: string, type: 'food' | 'beauty' = 'food') {
    try {
        const subdomain = type === 'beauty' ? 'world.openbeautyfacts.org' : 'world.openfoodfacts.org';
        const url = `https://${subdomain}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1`;

        const res = await fetchWithTimeout(url, { headers: HEADERS });
        const data = await res.json();

        if (data.products && data.products.length > 0) {
            const product = data.products[0];
            return {
                found: true,
                allergens: product.allergens_tags || [],
                additives: product.additives_tags || [], // e.g., "en:e330"
                ingredients_text: product.ingredients_text,
                ecoscore: product.ecoscore_grade,
                nova_group: product.nova_group, // Processing level (1-4)
                brand: product.brands
            };
        }
        return null;
    } catch (e) {
        console.error(`Open${type}Facts lookup failed:`, e);
        return null;
    }
}

// --- 2. CAS COMMON CHEMISTRY (The Identity Source) ---
// Maps names to CAS Registry Numbers for 100% accurate lookups
export async function getCASNumber(ingredientName: string): Promise<string | null> {
    if (isCircuitOpen('cas')) return null

    const cacheKey = `cas:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached === '__FAILED__' ? null : cached
    }

    try {
        const url = `https://commonchemistry.cas.org/api/search?q=${encodeURIComponent(ingredientName)}`
        const res = await fetchWithTimeout(url, {
            headers: { ...HEADERS, 'Accept': 'application/json' }
        })

        if (!res.ok) {
            recordFailure('cas')
            cacheExternalData(cacheKey, '__FAILED__')
            return null
        }

        recordSuccess('cas')
        const data = await res.json()

        if (data.count > 0 && data.results[0]) {
            const casNumber = data.results[0].rn
            cacheExternalData(cacheKey, casNumber)
            return casNumber
        }

        cacheExternalData(cacheKey, null)
        return null
    } catch (e) {
        recordFailure('cas')
        cacheExternalData(cacheKey, '__FAILED__')
        return null
    }
}

// --- 3. OPEN FDA (Adverse Events) ---
// Supports multiple product types: food, drug, device
export async function getOpenFDACount(ingredientName: string, productType: string = 'food'): Promise<number> {
    if (isCircuitOpen('fda')) return 0

    const cacheKey = `fda:${productType}:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached
    }

    try {
        let endpoint: string
        let searchField: string

        switch (productType) {
            case 'cosmetic':
            case 'household':
                endpoint = 'drug/event'
                searchField = 'patient.drug.openfda.substance_name'
                break
            case 'pharma':
                endpoint = 'drug/event'
                searchField = 'patient.drug.openfda.substance_name'
                break
            default:
                endpoint = 'food/event'
                searchField = 'products.industry_name'
                break
        }

        const encodedName = encodeURIComponent(`"${ingredientName}"`)
        const url = `https://api.fda.gov/${endpoint}.json?search=${searchField}:${encodedName}&limit=1`

        const res = await fetchWithTimeout(url, { headers: HEADERS })

        if (!res.ok) {
            recordFailure('fda')
            cacheExternalData(cacheKey, 0)
            return 0
        }

        recordSuccess('fda')
        const data = await res.json()

        const count = data.meta?.results?.total || 0
        cacheExternalData(cacheKey, count)
        return count
    } catch (e) {
        recordFailure('fda')
        cacheExternalData(cacheKey, 0)
        return 0
    }
}

// --- 4. EPA COMPTOX (via CAS Number) ---
export function getEPALink(casNumber: string | null) {
    if (!casNumber) return null;
    return `https://comptox.epa.gov/dashboard/chemical/details/${casNumber}`;
}

// --- 5. PUBCHEM (Chemical Identity & Properties) ---
// No API key needed; 5 requests/second limit
export async function getPubChemData(ingredientName: string): Promise<PubChemData | null> {
    if (isCircuitOpen('pubchem')) return null

    const cacheKey = `pubchem:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached === '__FAILED__' ? null : cached
    }

    try {
        const encodedName = encodeURIComponent(ingredientName)
        const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodedName}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`

        const res = await fetchWithTimeout(url, { headers: HEADERS })

        if (!res.ok) {
            recordFailure('pubchem')
            cacheExternalData(cacheKey, '__FAILED__')
            return null
        }

        recordSuccess('pubchem')
        const data = await res.json()
        const props = data?.PropertyTable?.Properties?.[0]

        if (!props) {
            cacheExternalData(cacheKey, null)
            return null
        }

        const result: PubChemData = {
            cid: props.CID || null,
            molecular_formula: props.MolecularFormula || null,
            molecular_weight: props.MolecularWeight ? String(props.MolecularWeight) : null,
            iupac_name: props.IUPACName || null,
            pubchem_url: props.CID ? `https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}` : null,
        }

        cacheExternalData(cacheKey, result)
        return result
    } catch (e) {
        recordFailure('pubchem')
        cacheExternalData(cacheKey, '__FAILED__')
        return null
    }
}

// --- 6. FDA RECALLS (Food Enforcement) ---
// No API key needed
export async function getFDARecalls(ingredientName: string): Promise<FDARecallData | null> {
    if (isCircuitOpen('fda')) return null

    const cacheKey = `fda_recalls:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached === '__FAILED__' ? null : cached
    }

    try {
        const encodedName = encodeURIComponent(`"${ingredientName}"`)
        const url = `https://api.fda.gov/food/enforcement.json?search=reason_for_recall:${encodedName}&limit=3`

        const res = await fetchWithTimeout(url, { headers: HEADERS })

        if (!res.ok) {
            // 404 means no results, not a failure
            if (res.status === 404) {
                const empty: FDARecallData = { total_recalls: 0, recent_recalls: [] }
                cacheExternalData(cacheKey, empty)
                return empty
            }
            recordFailure('fda')
            cacheExternalData(cacheKey, '__FAILED__')
            return null
        }

        recordSuccess('fda')
        const data = await res.json()

        const result: FDARecallData = {
            total_recalls: data.meta?.results?.total || 0,
            recent_recalls: (data.results || []).slice(0, 3).map((r: any) => ({
                reason: r.reason_for_recall || 'Unknown',
                classification: r.classification || 'Unknown',
                status: r.status || 'Unknown',
            })),
        }

        cacheExternalData(cacheKey, result)
        return result
    } catch (e) {
        recordFailure('fda')
        cacheExternalData(cacheKey, '__FAILED__')
        return null
    }
}

// --- BATCH ENRICHMENT (Parallel for all ingredients) ---
export async function getEnrichedDataForBatch(
    ingredientNames: string[],
    productType: string = 'food'
): Promise<Record<string, EnrichedIngredientData>> {
    const results: Record<string, EnrichedIngredientData> = {}

    // Run all ingredient lookups in parallel, each ingredient runs CAS + FDA + PubChem + FDA Recalls concurrently
    const promises = ingredientNames.map(async (name) => {
        const cacheKey = `enriched:${productType}:${name}`
        const cached = getCachedExternalData(cacheKey)
        if (cached !== undefined && cached !== '__FAILED__') {
            results[name] = cached
            return
        }

        try {
            const [cas, fdaCount, pubchem, fdaRecalls] = await Promise.all([
                getCASNumber(name),
                getOpenFDACount(name, productType),
                getPubChemData(name),
                getFDARecalls(name),
            ])

            const enriched: EnrichedIngredientData = {
                cas_number: cas || "Unknown",
                fda_reports: fdaCount,
                epa_link: getEPALink(cas),
                pubchem,
                fda_recalls: fdaRecalls,
                sources_checked: [
                    "CAS Common Chemistry",
                    "OpenFDA Adverse Events",
                    "EPA CompTox",
                    ...(pubchem ? ["PubChem"] : []),
                    ...(fdaRecalls ? ["FDA Recalls"] : []),
                ],
            }

            cacheExternalData(cacheKey, enriched)
            results[name] = enriched
        } catch (error) {
            console.error(`[EnrichedData] Failed for ${name}:`, error)
            results[name] = {
                cas_number: "Unknown",
                fda_reports: 0,
                epa_link: null,
                pubchem: null,
                fda_recalls: null,
                sources_checked: ["CAS Common Chemistry", "OpenFDA Adverse Events", "EPA CompTox"],
            }
        }
    })

    await Promise.all(promises)
    return results
}

// --- MASTER AGGREGATOR (single ingredient, includes PubChem + FDA Recalls) ---
export async function getOfficialData(ingredientName: string, productType: string = 'food'): Promise<EnrichedIngredientData> {
    const cacheKey = `official:${productType}:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached
    }

    try {
        const [cas, fdaCount, pubchem, fdaRecalls] = await Promise.all([
            getCASNumber(ingredientName),
            getOpenFDACount(ingredientName, productType),
            getPubChemData(ingredientName),
            getFDARecalls(ingredientName),
        ])

        const result: EnrichedIngredientData = {
            cas_number: cas || "Unknown",
            fda_reports: fdaCount,
            epa_link: getEPALink(cas),
            pubchem,
            fda_recalls: fdaRecalls,
            sources_checked: [
                "CAS Common Chemistry",
                "OpenFDA Adverse Events",
                "EPA CompTox",
                ...(pubchem ? ["PubChem"] : []),
                ...(fdaRecalls ? ["FDA Recalls"] : []),
            ],
        }

        cacheExternalData(cacheKey, result)
        return result
    } catch (error) {
        console.error('Official data aggregation failed:', error)
        const fallback: EnrichedIngredientData = {
            cas_number: "Unknown",
            fda_reports: 0,
            epa_link: null,
            pubchem: null,
            fda_recalls: null,
            sources_checked: ["CAS Common Chemistry", "OpenFDA Adverse Events", "EPA CompTox"],
        }
        cacheExternalData(cacheKey, fallback)
        return fallback
    }
}

// Format enriched data as context string for Gemini prompts
export function formatEnrichedDataForPrompt(enrichedData: Record<string, EnrichedIngredientData>): string {
    const lines: string[] = []

    for (const [name, data] of Object.entries(enrichedData)) {
        const parts: string[] = [`--- ${name} ---`]

        if (data.cas_number !== "Unknown") {
            parts.push(`CAS Number: ${data.cas_number}`)
        }

        if (data.pubchem) {
            if (data.pubchem.molecular_formula) parts.push(`Molecular Formula (PubChem): ${data.pubchem.molecular_formula}`)
            if (data.pubchem.molecular_weight) parts.push(`Molecular Weight: ${data.pubchem.molecular_weight}`)
            if (data.pubchem.iupac_name) parts.push(`IUPAC Name: ${data.pubchem.iupac_name}`)
            if (data.pubchem.pubchem_url) parts.push(`PubChem: ${data.pubchem.pubchem_url}`)
        }

        if (data.fda_reports > 0) {
            parts.push(`FDA Adverse Event Reports: ${data.fda_reports}`)
        }

        if (data.fda_recalls && data.fda_recalls.total_recalls > 0) {
            parts.push(`FDA Recalls: ${data.fda_recalls.total_recalls} total`)
            for (const recall of data.fda_recalls.recent_recalls) {
                parts.push(`  - ${recall.reason} (${recall.classification}, ${recall.status})`)
            }
        }

        if (data.epa_link) {
            parts.push(`EPA CompTox: ${data.epa_link}`)
        }

        lines.push(parts.join('\n'))
    }

    return lines.join('\n\n')
}
