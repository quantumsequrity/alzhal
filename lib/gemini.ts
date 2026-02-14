import { GoogleGenerativeAI, Part } from '@google/generative-ai'
import { GoogleGenAI } from '@google/genai'

// sharp removed — AVIF/HEIC images are rejected with a user-friendly message on Cloudflare
const sharp: any = null

const apiKey = process.env.GEMINI_API_KEY

if (!apiKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('GEMINI_API_KEY is required in production')
  }
  console.warn('Missing Gemini API Key - API calls will fail')
}

const genAI = new GoogleGenerativeAI(apiKey || '')
const genAINew = new GoogleGenAI({ apiKey: apiKey || '' })

// Use Gemini 2.0 Flash for speed and multimodal capabilities
export const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

// Sanitize ingredient names to prevent prompt injection
function sanitizeIngredientName(name: string): string {
  return name
    // Strip control characters (U+0000–U+001F, U+007F–U+009F)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    // Strip common prompt injection delimiters
    .replace(/[`${}\\]/g, '')
    // Limit length to 200 characters
    .slice(0, 200)
    .trim()
}

// Helper to handle rate limits (429)
export async function callGeminiWithRetry(geminiModel: any, prompt: any, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await geminiModel.generateContent(prompt)
      return result
    } catch (error: any) {
      if (error.message?.includes('429') || error.status === 429) {
        console.warn(`Gemini 429 Rate Limit. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= 2 // Exponential backoff (2s -> 4s -> 8s)
      } else {
        throw error // Rethrow non-429 errors
      }
    }
  }
  throw new Error('Gemini API Rate Limit Exceeded after retries')
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string) {
  const prompt = "Transcribe this audio exactly as spoken. Detect the language and return the text."

  const audioPart: Part = {
    inlineData: {
      data: audioBuffer.toString('base64'),
      mimeType,
    },
  }

  const result = await callGeminiWithRetry(model, [prompt, audioPart])
  const response = await result.response
  return response.text()
}


export async function analyzeImage(imageBuffer: Buffer, mimeType: string) {
  // Convert AVIF to JPEG using sharp since Gemini API doesn't support AVIF
  let finalBuffer = imageBuffer;
  let finalMimeType = mimeType;
  if (mimeType === 'image/avif' && sharp) {
      console.log('Converting AVIF to JPEG for Gemini API compatibility');
      finalBuffer = await sharp(imageBuffer).jpeg({ quality: 90 }).toBuffer() as Buffer;
      finalMimeType = 'image/jpeg';
  }

  const prompt = `
    You are a product label extraction expert. Extract ALL information from this product label image.

    CRITICAL RULES FOR INGREDIENT EXTRACTION:
    1. Extract EVERY SINGLE ingredient listed - do NOT skip any
    2. Ingredients in parentheses are sub-ingredients - list them as separate items with the parent context
       Example: "Spice Mix (Salt, Turmeric, Chilli)" → list "Spice Mix", "Salt", "Turmeric", "Chilli" separately
    3. Include ALL vitamins, minerals, nutrients, E-numbers, INS numbers
    4. Include preservatives, emulsifiers, stabilizers, colors, flavoring agents
    5. If ingredients are in multiple languages, use the English names
    6. Keep the EXACT order as printed on the label
    7. Count carefully - if the label says 33 ingredients, you must return 33 items

    PRODUCT TYPE DETECTION:
    - "food" = edible items (noodles, biscuits, drinks, snacks, dairy, etc.)
    - "cosmetic" = beauty/personal care (shampoo, soap, face wash, cream, lotion, perfume, deodorant, hair oil, sunscreen, toothpaste, etc.)
    - "household" = cleaning/home products (detergent, floor cleaner, dishwash, insecticide, etc.)
    - "pharma" = medicines, supplements, OTC drugs

    Return as JSON:
    {
      "product_name": "exact product name",
      "brand": "brand name",
      "category": "food/cosmetic/household/pharma",
      "ingredients": [
        {"name": "ingredient name", "percentage": "percentage if visible or empty string"},
        ...
      ]
    }

    IMPORTANT: Return ONLY valid JSON, no explanation text.
  `

  const imagePart: Part = {
    inlineData: {
      data: finalBuffer.toString('base64'),
      mimeType: finalMimeType,
    },
  }

  const result = await callGeminiWithRetry(model, [prompt, imagePart])
  const response = await result.response
  const text = response.text()

  try {
    // Clean up markdown code blocks if present
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim()
    return JSON.parse(jsonString)
  } catch (e) {
    console.error('Failed to parse JSON from Gemini vision:', text)
    throw new Error('Failed to parse product data')
  }
}

// Max ingredients per batch to avoid Gemini output token truncation
const BATCH_CHUNK_SIZE = 8

export async function analyzeIngredientBatch(ingredientNames: string[], productCategory: string = 'food') {
  const categoryContext = {
    food: 'This is a FOOD product. Prioritize FSSAI, FDA GRAS, Codex Alimentarius, EU food additive regulations.',
    cosmetic: 'This is a COSMETIC/PERSONAL CARE product (shampoo, soap, cream, etc.). Prioritize EU CosIng, BIS IS 4707, FDA cosmetic regulations, IFRA standards.',
    household: 'This is a HOUSEHOLD/CLEANING product. Prioritize EPA SCIL, OSHA standards, EU detergent regulations, chemical safety data.',
    pharma: 'This is a PHARMACEUTICAL product. Prioritize FDA CFR 21, CDSCO, EU pharmacopoeia standards.',
  }

  // Split ingredients into chunks to prevent output truncation
  const chunks: string[][] = []
  for (let i = 0; i < ingredientNames.length; i += BATCH_CHUNK_SIZE) {
    chunks.push(ingredientNames.slice(i, i + BATCH_CHUNK_SIZE))
  }

  console.log(`[Gemini] Splitting ${ingredientNames.length} ingredients into ${chunks.length} batch(es) of max ${BATCH_CHUNK_SIZE}`)

  const allResults: Record<string, any> = {}

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]

    // Rate limit protection between chunks
    if (chunkIndex > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    const prompt = `
You are an Official Regulatory Compliance Auditor performing BATCH analysis.

PRODUCT CONTEXT: ${categoryContext[productCategory as keyof typeof categoryContext] || categoryContext.food}

STRICT REQUIREMENT: Use ONLY data from ABSOLUTE OFFICIAL SOURCES.

DATA SOURCES: BIS IS 4707, FSSAI FSS Regulations 2011, EU CosIng Database, EU Regulation (EC) No 1223/2009 & No 1333/2008, FDA CFR 21 & GRAS List, EPA SCIL, IFRA Standards, WHO/IARC, Codex Alimentarius.

ANALYZE THESE ${chunk.length} INGREDIENTS: ${JSON.stringify(chunk.map(sanitizeIngredientName))}

Return a JSON Object where KEY = ingredient name, VALUE = analysis object:

{
  "Ingredient Name": {
    "simple_name": "Plain language explanation",
    "chemical_formula": "Formula or 'N/A'",
    "cas_number": "CAS number if known",
    "raw_materials": "Source material",
    "common_uses": ["3 common products"],
    "regulatory_status": {
      "india_fssai": "FSSAI status or 'Data not available'",
      "eu_cosing": "EU status or 'Data not available'",
      "us_fda": "FDA status or 'Data not available'",
      "who_iarc": "WHO/IARC classification or 'Data not available'"
    },
    "safety_limits": {
      "fssai_max": "Max % India or 'Not specified'",
      "eu_max": "Max % EU or 'Not specified'",
      "fda_max": "Max % USA or 'Not specified'"
    },
    "safety_verdict": "SAFE/CAUTION/AVOID/BANNED",
    "concerns": ["Only official source findings"],
    "banned_countries": ["Countries where banned"],
    "sources_cited": ["Specific regulation references"],
    "limit_exceeded": {
      "fssai": { "max_allowed": "percentage or amount", "typical_use": "typical % in this product type", "exceeded": true/false },
      "eu": { "max_allowed": "percentage or amount", "typical_use": "typical %", "exceeded": true/false },
      "fda": { "max_allowed": "percentage or amount", "typical_use": "typical %", "exceeded": true/false }
    },
    "regional_ban_conflicts": ["e.g. 'Legal in India but banned in EU (Annex II)'"]
  }
}

RULES:
1. If no official data exists, use "Data not available" - DO NOT guess.
2. safety_verdict MUST be based on official banned/restricted lists only.
3. sources_cited MUST reference specific regulation numbers.
4. Zero official data = safety_verdict: "CAUTION", concerns: ["No official data found"]
5. Return ONLY valid JSON, no markdown code blocks, no explanation text.
6. limit_exceeded: set to null if no official limits exist. Only set exceeded=true if the typical use level in this product type exceeds the regulatory max.
7. regional_ban_conflicts: list cases where the ingredient is legal in one major market but banned/restricted in another. Empty array if no conflicts.
`

    try {
      const result = await callGeminiWithRetry(model, prompt)
      const response = await result.response
      const text = response.text()

      const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(jsonString)

      // Validate each ingredient result
      for (const key of Object.keys(parsed)) {
        if (!parsed[key].sources_cited || parsed[key].sources_cited.length === 0) {
          parsed[key].sources_cited = ["No official sources found"]
          parsed[key].safety_verdict = "CAUTION"
        }
      }

      Object.assign(allResults, parsed)
      console.log(`[Gemini] Batch ${chunkIndex + 1}/${chunks.length}: ${Object.keys(parsed).length}/${chunk.length} ingredients parsed`)
    } catch (e) {
      console.error(`[Gemini] Batch ${chunkIndex + 1}/${chunks.length} failed:`, (e as Error).message)
      // Continue with other chunks even if one fails
    }
  }

  return allResults
}

export async function analyzeIngredient(ingredientName: string) {
  // Add a small initial delay to prevent instant burst
  await new Promise(resolve => setTimeout(resolve, 1000));

  const prompt = `
⚠️ CRITICAL INSTRUCTION: You are an Official Regulatory Compliance Auditor.

STRICT REQUIREMENT: You MUST ONLY use data from these ABSOLUTE OFFICIAL SOURCES. Any answer without official source citation is REJECTED.

📚 MANDATORY DATA SOURCES (In Order of Priority):

🇮🇳 INDIA (Bureau of Indian Standards - BIS):
   - IS 4707 (Cosmetics Standards) - Parts 1 & 2
   - FSSAI Food Safety Standards (FSS) Regulations 2011
   - FSSAI Compendium - "Substances added to food"
   - CDSCO (Central Drugs Standard Control Organization)

🇪🇺 EUROPEAN UNION:
   - EU CosIng Database (Cosmetic Ingredients)
   - Annex II: Prohibited Substances (BANNED)
   - Annex III: Restricted Substances (with limits)
   - Regulation (EC) No 1223/2009
   - EU Food Additives Regulation (EC) No 1333/2008

🇺🇸 UNITED STATES:
   - FDA Code of Federal Regulations (CFR 21)
   - FDA GRAS (Generally Recognized As Safe) List
   - EPA Safer Chemical Ingredients List (SCIL)
   - EPA CompTox Dashboard

🌍 WORLD HEALTH ORGANIZATION:
   - WHO/ILO International Chemical Safety Cards (ICSC)
   - IARC (International Agency for Research on Cancer) Classifications
   - Codex Alimentarius (Food Standards)

ANALYZE THIS INGREDIENT: "${sanitizeIngredientName(ingredientName)}"

OUTPUT FORMAT (JSON):
{
  "simple_name": "One sentence in simple Hindi/English (layman terms)",
  "chemical_formula": "Molecular formula or 'Not applicable'",
  "cas_number": "CAS Registry Number if available",
  "raw_materials": "Natural source or synthetic process",
  "common_uses": ["List 3-5 common products where this is used"],
  "regulatory_status": {
    "india_bis": "BIS IS 4707 status OR 'Data not available'",
    "india_fssai": "FSSAI approval status with limits OR 'Data not available'",
    "eu_cosing": "Annex status (Approved/Annex II Prohibited/Annex III Restricted) OR 'Data not available'",
    "us_fda": "FDA CFR 21 status OR 'Data not available'",
    "us_epa": "EPA SCIL rating OR 'Data not available'",
    "who_iarc": "WHO/IARC group (1/2A/2B/3) OR 'Data not available'"
  },
  "safety_limits": {
    "fssai_max": "Maximum allowed % in India OR 'Not specified'",
    "eu_max": "Maximum allowed % in EU OR 'Not specified'",
    "fda_max": "Maximum allowed % in USA OR 'Not specified'"
  },
  "safety_verdict": "SAFE / CAUTION / AVOID / BANNED",
  "concerns": [
    "ONLY list if found in official sources above",
    "Format: 'Source: Specific finding (e.g., EU Annex II: Carcinogenic)'"
  ],
  "banned_countries": ["List countries where completely banned"],
  "sources_cited": [
    "MUST cite specific documents (e.g., 'EU CosIng Annex II', 'FSSAI FSS Regulation 2011, Table 3')",
    "If no official source found, write 'No regulatory data found'"
  ]
}

⚠️ STRICT RULES:
1. If you cannot find data in the official sources listed above, write "Data not available" - DO NOT guess or use general knowledge.
2. NEVER use phrases like "generally safe", "may cause", "some studies suggest" - only cite official regulations.
3. safety_verdict can ONLY be based on official banned/restricted lists, not general opinions.
4. sources_cited MUST include specific regulation numbers or document names.
5. If the ingredient has ZERO official regulatory data, mark safety_verdict as "CAUTION" with concerns: ["No official safety data found in BIS/FSSAI/EU/FDA databases"]

ANALYZE NOW.
  `

  const result = await callGeminiWithRetry(model, prompt)
  const response = await result.response
  const text = response.text()

  try {
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(jsonString)

    // Validation: Ensure sources are cited
    if (!parsed.sources_cited || parsed.sources_cited.length === 0) {
      parsed.sources_cited = ["No official sources found"]
      parsed.safety_verdict = "CAUTION"
      parsed.concerns = ["No regulatory data available from BIS/FSSAI/EU/FDA/WHO"]
    }

    return parsed
  } catch (e) {
    console.error('Failed to parse JSON from Gemini ingredient analysis:', text)
    return {
      simple_name: "Regulatory analysis pending",
      safety_verdict: "CAUTION",
      concerns: ["Failed to verify against official standards - requires manual review"],
      sources_cited: ["Verification failed"]
    }
  }
}

// WAV header for raw PCM from Gemini TTS (16-bit, 24kHz, mono)
function createWavBuffer(pcmData: Buffer): Buffer {
  const sampleRate = 24000
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcmData.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(dataSize + 36, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcmData])
}

const MAX_TTS_TEXT_LENGTH = 1500

export async function generateVoiceResponse(
  text: string,
  language: string = 'English'
): Promise<{ audioBuffer: Buffer; mimeType: string } | null> {
  const ttsText = text.length > MAX_TTS_TEXT_LENGTH
    ? text.slice(0, MAX_TTS_TEXT_LENGTH) + '...'
    : text

  const prompt = `Read the following product safety summary aloud in ${language}. Speak naturally and clearly:\n\n${ttsText}`

  const TTS_TIMEOUT_MS = 35_000 // 35 second timeout
  const MAX_RETRIES = 2

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ttsPromise = genAINew.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      })

      // Race against timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TTS timeout')), TTS_TIMEOUT_MS)
      )
      const response = await Promise.race([ttsPromise, timeoutPromise])

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData
      if (!inlineData?.data) {
        console.warn('[Gemini TTS] No audio data in response')
        return null
      }

      const pcmBuffer = Buffer.from(inlineData.data, 'base64')
      const wavBuffer = createWavBuffer(pcmBuffer)

      return { audioBuffer: wavBuffer, mimeType: 'audio/wav' }
    } catch (error: any) {
      const is429 = error.message?.includes('429') || error.status === 429
      if (is429 && attempt < MAX_RETRIES) {
        console.warn(`[Gemini TTS] Rate limited, retrying in ${2000 * (attempt + 1)}ms...`)
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
        continue
      }
      console.error('[Gemini TTS] Audio generation failed:', error.message || error)
      return null
    }
  }

  return null
}

export async function translateContent(content: string, targetLanguage: string) {
  if (targetLanguage.toLowerCase() === 'english') return content

  const prompt = `
    Translate this ingredient analysis to ${targetLanguage}:

    ${content}

    Rules:
    - Keep chemical formulas in English (e.g., C12H25)
    - Keep organization names in English (FDA, EU, WHO)
    - Keep percentages as numbers (8%, 50%)
    - Translate all explanations and descriptions
    - Use simple words suitable for uneducated audience
    - Keep emojis
  `

  const result = await callGeminiWithRetry(model, prompt)
  const response = await result.response
  return response.text()
}
