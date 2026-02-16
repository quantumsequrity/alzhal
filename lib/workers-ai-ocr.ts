// Workers AI Vision OCR — supplementary OCR source using Cloudflare Workers AI
// Model: @cf/meta/llama-3.2-11b-vision-instruct
// Returns null on any failure (non-blocking supplementary source)

interface WorkersAIOcrResult {
  product_name: string
  brand: string
  category: string
  ingredients: string[]
}

interface AiBinding {
  run(model: string, input: Record<string, any>): Promise<any>
}

function getAI(): AiBinding | null {
  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare')
    const { env } = getCloudflareContext()
    return env?.AI || null
  } catch {
    return null
  }
}

/**
 * Extract product label data using Workers AI Vision.
 * Returns structured data or null on any failure.
 */
export async function extractWithWorkersAI(
  imageBuffer: Buffer,
  mimeType: string
): Promise<WorkersAIOcrResult | null> {
  try {
    const ai = getAI()
    if (!ai) {
      console.log('[WorkersAI OCR] AI binding not available (local dev or not configured)')
      return null
    }

    const base64 = imageBuffer.toString('base64')

    const prompt = `You are a product label extraction expert. Look at this product label image and extract:
1. Product name
2. Brand name
3. Category (food/cosmetic/household/pharma)
4. Complete list of ingredients

Return ONLY valid JSON in this exact format:
{"product_name":"name","brand":"brand","category":"food","ingredients":["ingredient1","ingredient2"]}

IMPORTANT: Extract EVERY ingredient. Do not skip any. Return ONLY the JSON, nothing else.`

    const response = await ai.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 2048,
    })

    if (!response?.response) {
      console.warn('[WorkersAI OCR] Empty response from model')
      return null
    }

    const text = typeof response.response === 'string'
      ? response.response
      : JSON.stringify(response.response)

    // Parse JSON from response (may be wrapped in markdown code blocks)
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(jsonString)

    // Validate minimum structure
    if (!parsed.ingredients || !Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) {
      console.warn('[WorkersAI OCR] No ingredients in parsed response')
      return null
    }

    // Ensure all ingredients are strings
    const ingredients = parsed.ingredients
      .map((i: any) => typeof i === 'string' ? i : (i?.name || String(i)))
      .filter((i: string) => i.length >= 2)

    if (ingredients.length === 0) return null

    console.log(`[WorkersAI OCR] Extracted ${ingredients.length} ingredients`)

    return {
      product_name: parsed.product_name || '',
      brand: parsed.brand || '',
      category: parsed.category || 'food',
      ingredients,
    }
  } catch (error: any) {
    console.warn('[WorkersAI OCR] Failed (non-blocking):', error.message)
    return null
  }
}
