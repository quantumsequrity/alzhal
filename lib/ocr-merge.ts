// Multi-source OCR merge: union-dedup ingredients from Gemini, Workers AI, and Tesseract

export interface OcrSource {
  name: 'gemini' | 'workersai' | 'tesseract'
  ingredients: string[]
  productName?: string
  brand?: string
  category?: string
}

export interface MergeResult {
  product_name: string
  brand: string
  category: string
  ingredients: { name: string; percentage: string }[]
  ocrSources: string[]
  primarySource: string
}

// Noise words to filter from raw Tesseract OCR text
const NOISE_PATTERNS = [
  /^net\s*w[te]/i,
  /^mfg/i,
  /^exp/i,
  /^best\s*before/i,
  /^use\s*by/i,
  /^batch/i,
  /^lot/i,
  /^pkg/i,
  /^mrp/i,
  /^price/i,
  /^rs\.?/i,
  /^ingredients\s*:?\s*$/i,
  /^contains\s*:?\s*$/i,
  /^allergen/i,
  /^may\s*contain/i,
  /^store\s*(in|at|below)/i,
  /^manufactured\s*by/i,
  /^marketed\s*by/i,
  /^packed\s*by/i,
  /^fssai/i,
  /^lic\s*no/i,
  /^\d+\s*(g|kg|ml|l|oz|lb|mg)\b/i,
  /^serving\s*size/i,
  /^nutrition/i,
  /^energy/i,
  /^protein/i,
  /^total\s*(fat|carb)/i,
  /^calories/i,
]

/**
 * Parse raw OCR text (from Tesseract) into an ingredient list.
 * Splits on commas, semicolons, newlines. Filters noise and junk tokens.
 */
export function parseRawOcrToIngredients(rawText: string): string[] {
  if (!rawText || rawText.trim().length < 3) return []

  // Try to find the ingredients section
  const ingredientsMatch = rawText.replace(/\n/g, ' ').match(/ingredients\s*:?\s*(.+)/i)
  const textToProcess = ingredientsMatch ? ingredientsMatch[1] : rawText

  // Split on commas, semicolons, newlines
  const tokens = textToProcess
    .split(/[,;\n]+/)
    .map(t => t.trim())
    .map(t => t.replace(/\(.*?\)/g, match => match)) // preserve parenthetical content
    .filter(t => t.length >= 2)
    .filter(t => !/^\d+\.?\d*$/.test(t)) // pure numbers
    .filter(t => !/^\d+\s*%$/.test(t))   // pure percentages
    .filter(t => {
      for (const pattern of NOISE_PATTERNS) {
        if (pattern.test(t)) return false
      }
      return true
    })
    .map(t => {
      // Clean up leading/trailing special chars
      return t.replace(/^[\s\-•*]+/, '').replace(/[\s\-•*.]+$/, '').trim()
    })
    .filter(t => t.length >= 2)

  return tokens
}

/**
 * Case-insensitive dedup with substring fuzzy match.
 * If one name is a substring of another, keep the longer one.
 */
function deduplicateIngredients(allNames: string[]): string[] {
  const normalized = allNames.map(n => ({
    original: n.trim(),
    lower: n.trim().toLowerCase(),
  }))

  const result: { original: string; lower: string }[] = []

  for (const item of normalized) {
    if (!item.original) continue

    let dominated = false
    let dominatesIdx = -1

    for (let i = 0; i < result.length; i++) {
      const existing = result[i]

      // Exact match
      if (existing.lower === item.lower) {
        dominated = true
        break
      }

      // Substring: new is contained in existing → skip new
      if (existing.lower.includes(item.lower)) {
        dominated = true
        break
      }

      // Substring: existing is contained in new → replace existing with new
      if (item.lower.includes(existing.lower)) {
        dominatesIdx = i
        break
      }
    }

    if (dominated) continue

    if (dominatesIdx >= 0) {
      result[dominatesIdx] = item
    } else {
      result.push(item)
    }
  }

  return result.map(r => r.original)
}

/**
 * Merge OCR results from up to 3 sources using union strategy.
 * Priority for metadata: Gemini > Workers AI > Tesseract
 * Ingredients: union of all sources, deduplicated.
 */
export function mergeOcrResults({
  gemini,
  workersAI,
  tesseractRaw,
}: {
  gemini: { product_name: string; brand: string; category: string; ingredients: { name: string; percentage: string }[] } | null
  workersAI: { product_name: string; brand: string; category: string; ingredients: string[] } | null
  tesseractRaw: string
}): MergeResult {
  const sources: OcrSource[] = []
  const allIngredientNames: string[] = []

  // Collect Gemini ingredients
  if (gemini && gemini.ingredients && gemini.ingredients.length > 0) {
    const names = gemini.ingredients.map(i => i.name)
    sources.push({
      name: 'gemini',
      ingredients: names,
      productName: gemini.product_name,
      brand: gemini.brand,
      category: gemini.category,
    })
    allIngredientNames.push(...names)
  }

  // Collect Workers AI ingredients
  if (workersAI && workersAI.ingredients && workersAI.ingredients.length > 0) {
    sources.push({
      name: 'workersai',
      ingredients: workersAI.ingredients,
      productName: workersAI.product_name,
      brand: workersAI.brand,
      category: workersAI.category,
    })
    allIngredientNames.push(...workersAI.ingredients)
  }

  // Collect Tesseract ingredients
  const tesseractIngredients = parseRawOcrToIngredients(tesseractRaw)
  if (tesseractIngredients.length > 0) {
    sources.push({
      name: 'tesseract',
      ingredients: tesseractIngredients,
    })
    allIngredientNames.push(...tesseractIngredients)
  }

  if (sources.length === 0) {
    throw new Error('All OCR sources failed — no ingredients extracted')
  }

  // Determine primary source for metadata
  const primarySource = sources[0] // first available in priority order (gemini > workersai > tesseract)

  // Product metadata: prefer Gemini > Workers AI > Tesseract first-line
  const product_name = sources.find(s => s.productName)?.productName || 'Unknown Product'
  const brand = sources.find(s => s.brand)?.brand || ''
  const category = sources.find(s => s.category)?.category || 'food'

  // Union-deduplicate ingredients
  const mergedNames = deduplicateIngredients(allIngredientNames)

  // Build final ingredients list, preserving percentages from Gemini where available
  const geminiPercentageMap = new Map<string, string>()
  if (gemini?.ingredients) {
    for (const ing of gemini.ingredients) {
      geminiPercentageMap.set(ing.name.toLowerCase(), ing.percentage || '')
    }
  }

  const ingredients = mergedNames.map(name => ({
    name,
    percentage: geminiPercentageMap.get(name.toLowerCase()) || '',
  }))

  return {
    product_name,
    brand,
    category,
    ingredients,
    ocrSources: sources.map(s => s.name),
    primarySource: primarySource.name,
  }
}
