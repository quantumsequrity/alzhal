import { supabase } from './supabase'

// --- Types ---

export interface ProductRecord {
  product_name: string
  brands: string
  categories: string
  ingredients_text: string
  nutriscore_grade: string
  nova_group: string
  countries: string
  additives: string
  allergens: string
  code: string
}

export interface IngredientRecord {
  name: string
  found_in_products: string[]
  categories: string[]
}

export interface NutritionRecord {
  code: string
  serving_size: string
  energy_kcal_100g: string
  fat_100g: string
  saturated_fat_100g: string
  trans_fat_100g: string
  carbohydrates_100g: string
  sugars_100g: string
  added_sugars_100g: string
  fiber_100g: string
  proteins_100g: string
  salt_100g: string
  sodium_100g: string
  cholesterol_100g: string
  vitamin_a_100g: string
  vitamin_c_100g: string
  vitamin_d_100g: string
  vitamin_b12_100g: string
  calcium_100g: string
  iron_100g: string
  potassium_100g: string
  zinc_100g: string
  caffeine_100g: string
  nutriscore_score: string
}

export interface ProductMetaRecord {
  code: string
  generic_name: string
  quantity: string
  packaging: string
  labels: string
  origins: string
  manufacturing_places: string
  stores: string
  traces: string
  brand_owner: string
  food_groups: string
  ecoscore_grade: string
  image_url: string
  image_ingredients_url: string
  image_nutrition_url: string
  popularity_scans: string
}

export interface FullProductData {
  product: ProductRecord
  nutrition: NutritionRecord | null
  meta: ProductMetaRecord | null
}

// --- Configuration ---

const MAX_SEARCH_RESULTS = 10

// --- D1 Database Access ---

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ success: boolean }>
}

/**
 * Get D1 database bindings if running on Cloudflare Workers.
 * Returns null in local dev (falls back to Supabase).
 */
function getD1(): D1Database | null {
  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare')
    const { env } = getCloudflareContext()
    return env?.FOOD_DB || null
  } catch {
    return null
  }
}

function getD1Nutrition(): D1Database | null {
  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare')
    const { env } = getCloudflareContext()
    return env?.FOOD_NUTRITION_DB || null
  } catch {
    return null
  }
}

function getD1Meta(): D1Database | null {
  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare')
    const { env } = getCloudflareContext()
    return env?.FOOD_META_DB || null
  } catch {
    return null
  }
}

// --- Internal Helpers ---

function toProductRecord(row: Record<string, any>): ProductRecord {
  return {
    product_name: row.product_name || '',
    brands: row.brands || '',
    categories: row.categories || '',
    ingredients_text: row.ingredients_text || '',
    nutriscore_grade: row.nutriscore_grade || '',
    nova_group: String(row.nova_group || ''),
    countries: row.countries || '',
    additives: row.additives_tags || '',
    allergens: row.allergens || '',
    code: row.code || '',
  }
}

// --- Public Search Functions ---

/**
 * Search for a product by name.
 * Uses D1 on Cloudflare Workers, falls back to Supabase in local dev.
 */
export async function searchProductByName(name: string): Promise<ProductRecord | null> {
  if (!name || name.trim().length < 2) return null
  const q = name.trim().slice(0, 200)

  const db = getD1()
  if (db) {
    const row = await db
      .prepare('SELECT * FROM food_products WHERE product_name LIKE ?1 LIMIT 1')
      .bind(`%${q}%`)
      .first()
    if (row) return toProductRecord(row)

    const fallback = await db
      .prepare('SELECT * FROM food_products WHERE product_name LIKE ?1 OR brands LIKE ?1 LIMIT 1')
      .bind(`%${q}%`)
      .first()
    return fallback ? toProductRecord(fallback) : null
  }

  // Supabase fallback for local dev
  const { data } = await supabase
    .from('food_products')
    .select('*')
    .ilike('product_name', `%${q}%`)
    .limit(1)
    .maybeSingle()

  if (data) return toProductRecord(data)

  const { data: fb } = await supabase
    .from('food_products')
    .select('*')
    .or(`product_name.ilike.%${q}%,brands.ilike.%${q}%`)
    .limit(1)
    .maybeSingle()

  return fb ? toProductRecord(fb) : null
}

/**
 * Search for information about a specific ingredient across the dataset.
 */
export async function searchIngredientInfo(ingredient: string): Promise<IngredientRecord | null> {
  if (!ingredient || ingredient.trim().length < 2) return null
  const q = ingredient.trim().slice(0, 200)

  let rows: Record<string, any>[]

  const db = getD1()
  if (db) {
    const result = await db
      .prepare('SELECT product_name, categories FROM food_products WHERE ingredients_text LIKE ?1 LIMIT ?2')
      .bind(`%${q}%`, MAX_SEARCH_RESULTS)
      .all()
    rows = result.results as Record<string, any>[]
  } else {
    const { data } = await supabase
      .from('food_products')
      .select('product_name, categories')
      .ilike('ingredients_text', `%${q}%`)
      .limit(MAX_SEARCH_RESULTS)
    rows = data || []
  }

  if (rows.length === 0) return null

  const foundInProducts: string[] = []
  const categoriesSet = new Set<string>()

  for (const row of rows) {
    if (row.product_name) foundInProducts.push(row.product_name)
    if (row.categories) {
      row.categories.split(',').map((c: string) => c.trim()).filter(Boolean).forEach((c: string) => categoriesSet.add(c))
    }
  }

  if (foundInProducts.length === 0) return null

  return {
    name: ingredient,
    found_in_products: foundInProducts.slice(0, 10),
    categories: Array.from(categoriesSet).slice(0, 10),
  }
}

/**
 * Search for a product by barcode.
 */
export async function searchProductsByBarcode(barcode: string): Promise<ProductRecord | null> {
  if (!barcode || barcode.trim().length < 6) return null
  const code = barcode.trim().slice(0, 20)

  const db = getD1()
  if (db) {
    const row = await db
      .prepare('SELECT * FROM food_products WHERE code = ?1 LIMIT 1')
      .bind(code)
      .first()
    return row ? toProductRecord(row) : null
  }

  const { data } = await supabase
    .from('food_products')
    .select('*')
    .eq('code', code)
    .limit(1)
    .maybeSingle()

  return data ? toProductRecord(data) : null
}

/**
 * Search for products matching a general query. Returns multiple results.
 */
export async function searchProducts(query: string, maxResults: number = MAX_SEARCH_RESULTS): Promise<ProductRecord[]> {
  if (!query || query.trim().length < 2) return []
  const q = query.trim().slice(0, 200)
  const limit = Math.min(maxResults, MAX_SEARCH_RESULTS)

  const db = getD1()
  if (db) {
    const result = await db
      .prepare('SELECT * FROM food_products WHERE product_name LIKE ?1 OR brands LIKE ?1 OR ingredients_text LIKE ?1 LIMIT ?2')
      .bind(`%${q}%`, limit)
      .all()
    return (result.results as Record<string, any>[])
      .map(toProductRecord)
      .filter(p => p.product_name || p.brands || p.ingredients_text)
  }

  const { data } = await supabase
    .from('food_products')
    .select('*')
    .or(`product_name.ilike.%${q}%,brands.ilike.%${q}%,ingredients_text.ilike.%${q}%`)
    .limit(limit)

  return (data || [])
    .map(toProductRecord)
    .filter(p => p.product_name || p.brands || p.ingredients_text)
}

/**
 * Look up multiple ingredients and return a combined context string for Gemini.
 */
export async function lookupIngredientsContext(ingredientNames: string[]): Promise<string | null> {
  const contextParts: string[] = []

  for (const name of ingredientNames.slice(0, 20)) {
    try {
      const info = await searchIngredientInfo(name)
      if (info && info.found_in_products.length > 0) {
        contextParts.push(
          `- ${info.name}: Found in ${info.found_in_products.length} product(s) (${info.found_in_products.slice(0, 3).join(', ')}). ` +
          `Categories: ${info.categories.slice(0, 3).join(', ') || 'N/A'}`
        )
      }
    } catch {
      // Skip failures silently
    }
  }

  if (contextParts.length === 0) return null
  return `Additional data from FDA/Open Food Facts database:\n${contextParts.join('\n')}`
}

/**
 * Look up a product by name and return a context string for Gemini.
 */
export async function lookupProductContext(productName: string): Promise<string | null> {
  try {
    const product = await searchProductByName(productName)
    if (!product || !product.product_name) return null

    const parts: string[] = [`Product: ${product.product_name}`]
    if (product.brands) parts.push(`Brand: ${product.brands}`)
    if (product.categories) parts.push(`Categories: ${product.categories}`)
    if (product.ingredients_text) parts.push(`Ingredients (from database): ${product.ingredients_text.slice(0, 500)}`)
    if (product.nutriscore_grade) parts.push(`Nutri-Score: ${product.nutriscore_grade.toUpperCase()}`)
    if (product.nova_group) parts.push(`NOVA Group: ${product.nova_group}`)
    if (product.additives) parts.push(`Additives: ${product.additives}`)
    if (product.allergens) parts.push(`Allergens: ${product.allergens}`)

    return `Additional data from FDA/Open Food Facts database:\n${parts.join('\n')}`
  } catch {
    return null
  }
}

// --- Premium Data Functions (cross-DB queries) ---

/**
 * Get nutrition data for a product by barcode.
 * Queries the FOOD_NUTRITION_DB (separate D1 database).
 */
export async function getNutritionByCode(code: string): Promise<NutritionRecord | null> {
  if (!code) return null

  const db = getD1Nutrition()
  if (!db) return null

  try {
    const row = await db
      .prepare('SELECT * FROM food_nutrition WHERE code = ?1 LIMIT 1')
      .bind(code)
      .first()
    return row as NutritionRecord | null
  } catch {
    return null
  }
}

/**
 * Get product metadata by barcode.
 * Queries the FOOD_META_DB (separate D1 database).
 */
export async function getMetaByCode(code: string): Promise<ProductMetaRecord | null> {
  if (!code) return null

  const db = getD1Meta()
  if (!db) return null

  try {
    const row = await db
      .prepare('SELECT * FROM food_meta WHERE code = ?1 LIMIT 1')
      .bind(code)
      .first()
    return row as ProductMetaRecord | null
  } catch {
    return null
  }
}

/**
 * Get full product data across all 3 databases.
 * Uses `code` (barcode) as the reference key to join data.
 * This is the premium endpoint — returns core + nutrition + meta.
 */
export async function getFullProductData(code: string): Promise<FullProductData | null> {
  const product = await searchProductsByBarcode(code)
  if (!product) return null

  // Query nutrition and meta databases in parallel
  const [nutrition, meta] = await Promise.all([
    getNutritionByCode(code),
    getMetaByCode(code),
  ])

  return { product, nutrition, meta }
}

/**
 * Get full product data by name (searches core DB first, then enriches).
 */
export async function getFullProductDataByName(name: string): Promise<FullProductData | null> {
  const product = await searchProductByName(name)
  if (!product || !product.code) return null

  const [nutrition, meta] = await Promise.all([
    getNutritionByCode(product.code),
    getMetaByCode(product.code),
  ])

  return { product, nutrition, meta }
}
