// Shared response formatter for WhatsApp and Telegram webhooks.
// Extracts duplicated formatting logic into a single module.

interface IngredientAnalysis {
  name: string
  analysis: {
    category?: string
    safety_verdict?: string
    simple_name?: string
    concerns?: string[]
    banned_in?: string[]
    banned_countries?: string[]
    safety_limits_per_100g?: {
      plain_english?: string
      india_fssai?: string
      eu?: string
      [key: string]: string | undefined
    }
    how_its_made?: string
    [key: string]: any
  }
}

interface AnalysisResult {
  productData: {
    product_name: string
    brand?: string
  }
  ingredients: IngredientAnalysis[]
}

interface FormatOptions {
  maxChars?: number // Default 4096 (WhatsApp limit)
  showHowItsMade?: boolean // Only for single-ingredient deep-dive
}

interface FormattedReport {
  responseText: string
  voiceSummary: string
  safeCount: number
  cautionCount: number
  avoidCount: number
}

export function formatIngredientReport(result: AnalysisResult, options: FormatOptions = {}): FormattedReport {
  const { maxChars = 4096, showHowItsMade = false } = options
  const product = result.productData

  let safeCount = 0
  let cautionCount = 0
  let avoidCount = 0
  const topConcerns: string[] = []

  // Count ALL ingredients for summary
  for (const item of result.ingredients) {
    const verdict = getVerdict(item)
    if (verdict === 'BANNED' || verdict === 'AVOID') {
      avoidCount++
      if (topConcerns.length < 3) topConcerns.push(`${item.name} (${verdict})`)
    } else if (verdict === 'CAUTION') {
      cautionCount++
      if (topConcerns.length < 3) topConcerns.push(`${item.name} (${verdict})`)
    } else {
      safeCount++
    }
  }

  // Build header
  let responseText = `*${product.product_name}* - ${product.brand || 'Unknown Brand'}\n\n`
  responseText += `Found ${result.ingredients.length} ingredients.\n`
  responseText += `---\n\n`

  // Calculate how many ingredients we can show given char budget
  const headerLen = responseText.length
  const footerLen = 200 // approximate footer size
  const availableChars = maxChars - headerLen - footerLen
  const charsPerIngredient = 300
  const maxIngredients = Math.max(5, Math.min(15, Math.floor(availableChars / charsPerIngredient)))

  const topIngredients = result.ingredients.slice(0, maxIngredients)

  for (const item of topIngredients) {
    const analysis = item.analysis
    const verdict = getVerdict(item)
    const icon = getIcon(verdict)

    responseText += `[${icon}] *${item.name}*\n`

    // simple_name shown for ALL ingredients
    if (analysis.simple_name) {
      responseText += `${analysis.simple_name}\n`
    }

    // safety_limits_per_100g.plain_english shown for CAUTION/AVOID/BANNED only
    const hasConcerns = verdict === 'CAUTION' || verdict === 'AVOID' || verdict === 'BANNED'

    if (hasConcerns && analysis.safety_limits_per_100g?.plain_english) {
      responseText += `Limit: ${analysis.safety_limits_per_100g.plain_english}\n`
    }

    if (hasConcerns && analysis.concerns && analysis.concerns.length > 0) {
      responseText += `Concerns: ${analysis.concerns.slice(0, 2).join(', ')}\n`
    }

    if (analysis.banned_in && analysis.banned_in.length > 0) {
      responseText += `Banned in: ${analysis.banned_in.join(', ')}\n`
    } else if (analysis.banned_countries && analysis.banned_countries.length > 0) {
      responseText += `Banned in: ${analysis.banned_countries.join(', ')}\n`
    }

    // how_its_made only shown on single-ingredient deep-dive
    if (showHowItsMade && analysis.how_its_made) {
      responseText += `How it's made: ${analysis.how_its_made}\n`
    }

    responseText += `\n`
  }

  if (result.ingredients.length > maxIngredients) {
    responseText += `...and ${result.ingredients.length - maxIngredients} more ingredients.\n`
  }

  responseText += `---\n`
  responseText += `*Summary* (${result.ingredients.length} total):\n`
  responseText += `Safe: ${safeCount} | Caution: ${cautionCount} | Avoid: ${avoidCount}\n\n`
  responseText += `Reply with an ingredient name for more details.\n`
  responseText += `\n_Disclaimer: Educational info only. Sources: FDA/EU/WHO/BIS/FSSAI/PubChem. Consult a professional for health advice._`

  // Build voice summary
  const safetyScore = result.ingredients.length > 0
    ? Math.round((safeCount / Math.max(result.ingredients.length, 1)) * 10)
    : 0
  const concernsList = topConcerns.length > 0
    ? `Top concerns: ${topConcerns.join(', ')}.`
    : 'No major concerns found.'
  const voiceSummary = `${product.product_name}. Safety score: ${safetyScore} out of 10. Found ${result.ingredients.length} ingredients. ${safeCount} safe, ${cautionCount} caution, ${avoidCount} avoid. ${concernsList}`

  return { responseText, voiceSummary, safeCount, cautionCount, avoidCount }
}

function getVerdict(item: IngredientAnalysis): string {
  return (item.analysis.category || item.analysis.safety_verdict || 'CAUTION').toUpperCase()
}

function getIcon(verdict: string): string {
  if (verdict === 'BANNED') return 'BANNED'
  if (verdict === 'AVOID') return 'DANGER'
  if (verdict === 'CAUTION') return 'CAUTION'
  return 'SAFE'
}
