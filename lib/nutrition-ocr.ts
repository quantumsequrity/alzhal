/**
 * Nutrition-panel OCR.
 *
 * Dedicated Gemini prompt that extracts structured per-100g and per-serving
 * values from a nutrition facts panel. The panel is a specific layout —
 * separate from the ingredient OCR prompt so each can be precise.
 *
 * The extracted values are then optionally compared against:
 *   1. Regulatory labeling requirements (FSSAI, FDA 21 CFR §101) when available
 *   2. Estimated contributions from the ingredient list (via USDA FDC) when
 *      nutrition data for those ingredients is indexed.
 *
 * This module does NOT call the LLM for anything except OCR of a printed
 * label. Any "the label should list X" claims come from regulatory_fact rows.
 */

import { Part } from '@google/generative-ai'
import { callGeminiWithRetry, modelCreative } from './gemini'

export type NutritionValue = {
  amount_per_100g: number | null
  amount_per_serving: number | null
  unit: string | null
  percent_dv: number | null
}

export type NutritionPanelData = {
  serving_size: string | null          // e.g. "30 g (about 10 crackers)"
  serving_size_g: number | null        // normalized to grams when possible
  servings_per_container: number | null
  energy: {
    kcal: NutritionValue
    kj: NutritionValue
  }
  macros: {
    protein_g:       NutritionValue
    fat_g:           NutritionValue
    saturated_fat_g: NutritionValue
    trans_fat_g:     NutritionValue
    carbohydrate_g:  NutritionValue
    sugar_g:         NutritionValue
    added_sugar_g:   NutritionValue
    fiber_g:         NutritionValue
  }
  sodium_mg:     NutritionValue
  // Optional micronutrients — parser returns a flat list of whatever is found
  micronutrients: Array<{
    name: string
    unit: string
    amount_per_100g: number | null
    amount_per_serving: number | null
    percent_dv: number | null
  }>
  source_label: 'US_FDA_nutrition_facts' | 'EU_nutrition_declaration' | 'IN_FSSAI_nutritional_information' | 'unknown'
  raw_ocr_text: string
}

const NUTRITION_PROMPT = `You are extracting a NUTRITION FACTS PANEL from a product image.

IMPORTANT: this prompt is for the NUTRITION panel (the box with calories / fat / carbs / sugars / sodium etc.), NOT the ingredient list. If the image shows only ingredients, return: { "source_label": "unknown", "raw_ocr_text": "" } with all other numeric fields null.

Extract ONLY what is printed on the label. Do NOT infer or estimate.

For each nutrient, return amount_per_100g and amount_per_serving when both are shown. If only one is shown, fill just that field and leave the other null.

Detect which labeling standard the panel follows:
  US_FDA_nutrition_facts        — white box, "Nutrition Facts", % Daily Value column
  EU_nutrition_declaration      — "Typical values per 100g" / "per serving"
  IN_FSSAI_nutritional_information — "Nutritional Information" table with per 100g/ml column
  unknown                       — doesn't match known layouts

Return ONLY valid JSON (no markdown fences, no prose):

{
  "serving_size": "string or null (as printed, e.g. '30 g (about 10 crackers)')",
  "serving_size_g": number or null (normalized to grams when unambiguous),
  "servings_per_container": number or null,
  "energy": {
    "kcal": { "amount_per_100g": n|null, "amount_per_serving": n|null, "unit": "kcal", "percent_dv": n|null },
    "kj":   { "amount_per_100g": n|null, "amount_per_serving": n|null, "unit": "kJ",   "percent_dv": n|null }
  },
  "macros": {
    "protein_g":       { ... },
    "fat_g":           { ... },
    "saturated_fat_g": { ... },
    "trans_fat_g":     { ... },
    "carbohydrate_g":  { ... },
    "sugar_g":         { ... },
    "added_sugar_g":   { ... },
    "fiber_g":         { ... }
  },
  "sodium_mg":         { ... },
  "micronutrients": [
    { "name": "Vitamin D", "unit": "mcg", "amount_per_100g": n|null, "amount_per_serving": n|null, "percent_dv": n|null },
    ...
  ],
  "source_label": "US_FDA_nutrition_facts" | "EU_nutrition_declaration" | "IN_FSSAI_nutritional_information" | "unknown",
  "raw_ocr_text": "verbatim transcription of the panel text"
}

Rules:
1. If a value is not printed, set its fields to null. Never guess.
2. Convert mg to g ONLY for fields whose shape uses grams (e.g. if saturated fat is listed as "2500 mg", return 2.5 in saturated_fat_g).
3. Keep sodium in mg.
4. raw_ocr_text is the verbatim text of the panel for audit; keep units and line breaks as printed.

Return the JSON and nothing else.`

function emptyValue(unit: string | null = null): NutritionValue {
  return { amount_per_100g: null, amount_per_serving: null, unit, percent_dv: null }
}

function emptyPanel(rawOcr = ''): NutritionPanelData {
  return {
    serving_size: null,
    serving_size_g: null,
    servings_per_container: null,
    energy: { kcal: emptyValue('kcal'), kj: emptyValue('kJ') },
    macros: {
      protein_g: emptyValue('g'),
      fat_g: emptyValue('g'),
      saturated_fat_g: emptyValue('g'),
      trans_fat_g: emptyValue('g'),
      carbohydrate_g: emptyValue('g'),
      sugar_g: emptyValue('g'),
      added_sugar_g: emptyValue('g'),
      fiber_g: emptyValue('g'),
    },
    sodium_mg: emptyValue('mg'),
    micronutrients: [],
    source_label: 'unknown',
    raw_ocr_text: rawOcr,
  }
}

/**
 * Extract a nutrition facts panel from an image. Returns a fully-typed
 * `NutritionPanelData`. Any extraction failure returns an empty panel
 * (all-null values) with `source_label: 'unknown'` so callers can always
 * render a consistent shape.
 */
export async function extractNutritionPanel(imageBuffer: Buffer, mimeType: string): Promise<NutritionPanelData> {
  const imagePart: Part = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType,
    },
  }

  try {
    const result = await callGeminiWithRetry(modelCreative, [NUTRITION_PROMPT, imagePart])
    const response = await result.response
    const text = response.text()
    const json = text.replace(/```json/g, '').replace(/```/g, '').trim()

    const parsed = JSON.parse(json) as Partial<NutritionPanelData>

    // Merge with an empty panel so the shape is always complete
    const base = emptyPanel(parsed.raw_ocr_text ?? '')
    return {
      ...base,
      ...parsed,
      energy:          { ...base.energy,          ...(parsed.energy ?? {}) },
      macros:          { ...base.macros,          ...(parsed.macros ?? {}) },
      sodium_mg:       parsed.sodium_mg          ?? base.sodium_mg,
      micronutrients:  parsed.micronutrients     ?? [],
      source_label:    parsed.source_label       ?? 'unknown',
    }
  } catch (err) {
    console.error('[Nutrition OCR] Extraction failed:', (err as Error).message)
    return emptyPanel('')
  }
}

// ---------- ingredient → nutrition attribution (approximate) ----------

export type IngredientWithPercentage = {
  name: string
  percentage: number | null   // 0–100, from label ("Water (40%), Sugar (20%), ...")
}

export type NutritionEstimate = {
  energy_kcal_100g: number | null
  protein_g_100g: number | null
  fat_g_100g: number | null
  saturated_fat_g_100g: number | null
  carbohydrate_g_100g: number | null
  sugar_g_100g: number | null
  fiber_g_100g: number | null
  sodium_mg_100g: number | null
  coverage_percent: number   // percentage of ingredients whose nutrition data was found
  notes: string[]
}

/**
 * Compute an APPROXIMATE per-100g nutrition estimate from an ingredient list
 * with printed percentages, using per-ingredient nutrition_fact rows from the
 * CIG. Only ingredients with printed percentages contribute — the rest are
 * labeled as "coverage gap".
 *
 * This is an ESTIMATE, not a regulatory claim. The result must be labeled
 * clearly as such in the UI. Proprietary formulations mean the estimate can
 * be off by ±30% even with good per-ingredient data.
 */
export async function estimateNutritionFromIngredients(
  ingredients: IngredientWithPercentage[],
  nutritionLookup: (name: string) => Promise<{
    energy_kcal_100g?: number | null
    protein_g_100g?: number | null
    fat_g_100g?: number | null
    saturated_fat_g_100g?: number | null
    carbohydrate_g_100g?: number | null
    sugar_g_100g?: number | null
    fiber_g_100g?: number | null
    sodium_mg_100g?: number | null
  } | null>,
): Promise<NutritionEstimate> {
  const withPercent = ingredients.filter(i => typeof i.percentage === 'number' && i.percentage! > 0)
  if (withPercent.length === 0) {
    return {
      energy_kcal_100g: null,
      protein_g_100g: null,
      fat_g_100g: null,
      saturated_fat_g_100g: null,
      carbohydrate_g_100g: null,
      sugar_g_100g: null,
      fiber_g_100g: null,
      sodium_mg_100g: null,
      coverage_percent: 0,
      notes: ['No ingredient percentages printed on the label — attribution not possible.'],
    }
  }

  const agg = {
    energy_kcal_100g: 0,
    protein_g_100g: 0,
    fat_g_100g: 0,
    saturated_fat_g_100g: 0,
    carbohydrate_g_100g: 0,
    sugar_g_100g: 0,
    fiber_g_100g: 0,
    sodium_mg_100g: 0,
  }
  let coverageWeight = 0
  const totalPercent = withPercent.reduce((s, i) => s + (i.percentage ?? 0), 0)
  const notes: string[] = []
  if (Math.abs(totalPercent - 100) > 5) {
    notes.push(`Declared percentages sum to ${totalPercent.toFixed(1)}%, not ~100% — estimate will be rescaled.`)
  }

  for (const item of withPercent) {
    const nutr = await nutritionLookup(item.name)
    if (!nutr) {
      notes.push(`No indexed nutrition data for "${item.name}" — its contribution is excluded.`)
      continue
    }
    const w = (item.percentage ?? 0) / 100
    coverageWeight += (item.percentage ?? 0)
    agg.energy_kcal_100g    += (nutr.energy_kcal_100g    ?? 0) * w
    agg.protein_g_100g      += (nutr.protein_g_100g      ?? 0) * w
    agg.fat_g_100g          += (nutr.fat_g_100g          ?? 0) * w
    agg.saturated_fat_g_100g+= (nutr.saturated_fat_g_100g?? 0) * w
    agg.carbohydrate_g_100g += (nutr.carbohydrate_g_100g ?? 0) * w
    agg.sugar_g_100g        += (nutr.sugar_g_100g        ?? 0) * w
    agg.fiber_g_100g        += (nutr.fiber_g_100g        ?? 0) * w
    agg.sodium_mg_100g      += (nutr.sodium_mg_100g      ?? 0) * w
  }

  return {
    ...agg,
    coverage_percent: Math.round(coverageWeight),
    notes,
  }
}
