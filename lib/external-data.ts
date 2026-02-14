// OFFICIAL DATA SOURCES - DETERMINISTIC LAYER
// 1. OpenFoodFacts / OpenBeautyFacts (Global Product DB)
// 2. CAS Common Chemistry (Chemical Identity)
// 3. OpenFDA (Adverse Events)
// 4. EPA CompTox (Chemical Safety)

import { cacheExternalData, getCachedExternalData } from './cache'

const HEADERS = { 'User-Agent': 'ConsumerTruth-Hackathon/1.0 (bloodraven@example.com)' }

// Timeout for external API calls (8 seconds)
const FETCH_TIMEOUT = 8000

// Circuit breaker: stop calling APIs after consecutive failures
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000 // 5 minutes

let casFailCount = 0
let casCircuitOpen = false
let casCircuitOpenedAt = 0

let fdaFailCount = 0
let fdaCircuitOpen = false
let fdaCircuitOpenedAt = 0

function isCASCircuitOpen(): boolean {
  if (!casCircuitOpen) return false
  if (Date.now() - casCircuitOpenedAt > CIRCUIT_BREAKER_RESET_MS) {
    casCircuitOpen = false
    casFailCount = 0
    console.log('[CAS] Circuit breaker reset - retrying API calls')
    return false
  }
  return true
}

function isFDACircuitOpen(): boolean {
  if (!fdaCircuitOpen) return false
  if (Date.now() - fdaCircuitOpenedAt > CIRCUIT_BREAKER_RESET_MS) {
    fdaCircuitOpen = false
    fdaFailCount = 0
    console.log('[FDA] Circuit breaker reset - retrying API calls')
    return false
  }
  return true
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
    // Circuit breaker check
    if (isCASCircuitOpen()) return null

    // Check cache first
    const cacheKey = `cas:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached === '__FAILED__' ? null : cached
    }

    try {
        const url = `https://commonchemistry.cas.org/api/search?q=${encodeURIComponent(ingredientName)}`
        const res = await fetchWithTimeout(url, {
            headers: {
                ...HEADERS,
                'Accept': 'application/json',
            }
        })

        if (!res.ok) {
            casFailCount++
            if (casFailCount >= CIRCUIT_BREAKER_THRESHOLD) {
                casCircuitOpen = true
                casCircuitOpenedAt = Date.now()
                console.warn(`[CAS] Circuit breaker OPEN after ${casFailCount} failures (status ${res.status}). Pausing for 5 min.`)
            }
            cacheExternalData(cacheKey, '__FAILED__')
            return null
        }

        // Reset on success
        casFailCount = 0
        const data = await res.json()

        if (data.count > 0 && data.results[0]) {
            const casNumber = data.results[0].rn
            cacheExternalData(cacheKey, casNumber)
            return casNumber
        }

        cacheExternalData(cacheKey, null)
        return null
    } catch (e) {
        casFailCount++
        if (casFailCount >= CIRCUIT_BREAKER_THRESHOLD) {
            casCircuitOpen = true
            casCircuitOpenedAt = Date.now()
            console.warn(`[CAS] Circuit breaker OPEN after ${casFailCount} failures. Pausing for 5 min.`)
        }
        cacheExternalData(cacheKey, '__FAILED__')
        return null
    }
}

// --- 3. OPEN FDA (Adverse Events) ---
// Supports multiple product types: food, drug, device
export async function getOpenFDACount(ingredientName: string, productType: string = 'food'): Promise<number> {
    // Circuit breaker check
    if (isFDACircuitOpen()) return 0

    // Check cache first
    const cacheKey = `fda:${productType}:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached
    }

    try {
        // Valid OpenFDA endpoints: food/event, drug/event, device/event
        // Note: there is NO cosmetic/event endpoint
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
            fdaFailCount++
            if (fdaFailCount >= CIRCUIT_BREAKER_THRESHOLD) {
                fdaCircuitOpen = true
                fdaCircuitOpenedAt = Date.now()
                console.warn(`[FDA] Circuit breaker OPEN after ${fdaFailCount} failures (status ${res.status}). Pausing for 5 min.`)
            }
            cacheExternalData(cacheKey, 0)
            return 0
        }

        // Reset on success
        fdaFailCount = 0
        const data = await res.json()

        const count = data.meta?.results?.total || 0
        cacheExternalData(cacheKey, count)
        return count
    } catch (e) {
        fdaFailCount++
        if (fdaFailCount >= CIRCUIT_BREAKER_THRESHOLD) {
            fdaCircuitOpen = true
            fdaCircuitOpenedAt = Date.now()
            console.warn(`[FDA] Circuit breaker OPEN after ${fdaFailCount} failures. Pausing for 5 min.`)
        }
        cacheExternalData(cacheKey, 0)
        return 0
    }
}

// --- 4. EPA COMPTOX (via CAS Number) ---
export function getEPALink(casNumber: string | null) {
    if (!casNumber) return null;
    return `https://comptox.epa.gov/dashboard/chemical/details/${casNumber}`;
}

// --- MASTER AGGREGATOR ---
export async function getOfficialData(ingredientName: string, productType: string = 'food') {
    // Check complete cache first
    const cacheKey = `official:${productType}:${ingredientName}`
    const cached = getCachedExternalData(cacheKey)
    if (cached !== undefined) {
        return cached
    }

    try {
        // Run CAS and FDA lookups in parallel
        const [cas, fdaCount] = await Promise.all([
            getCASNumber(ingredientName),
            getOpenFDACount(ingredientName, productType)
        ])

        const result = {
            cas_number: cas || "Unknown",
            fda_reports: fdaCount,
            epa_link: getEPALink(cas),
            sources_checked: ["CAS Common Chemistry", "OpenFDA", "EPA CompTox"]
        }

        cacheExternalData(cacheKey, result)
        return result
    } catch (error) {
        console.error('Official data aggregation failed:', error)
        const fallback = {
            cas_number: "Unknown",
            fda_reports: 0,
            epa_link: null as string | null,
            sources_checked: ["CAS Common Chemistry", "OpenFDA", "EPA CompTox"],
        }
        cacheExternalData(cacheKey, fallback)
        return fallback
    }
}
