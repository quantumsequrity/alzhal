import { analyzeImage, analyzeIngredientBatch, translateContent } from './gemini'
import { supabase } from './supabase'
import { getEnrichedDataForBatch, formatEnrichedDataForPrompt, EnrichedIngredientData } from './external-data'
import { lookupIngredientsContext, lookupProductContext } from './product-data'

export async function processImageAndAnalyze(imageBuffer: Buffer, mimeType: string, language: string = 'English') {
    // 1. Analyze Image with Gemini Vision
    console.log('[Analysis] Starting image analysis...')
    const productData = await analyzeImage(imageBuffer, mimeType)
    const productCategory = productData.category || 'food'
    console.log(`[Analysis] Product: ${productData.product_name} (${productCategory}), ${productData.ingredients.length} ingredients`)

    // 2. Upsert Product in DB (atomic to prevent race conditions)
    let productId: string | undefined
    let existingScannedCount = 0
    try {
        const { data: upsertedProduct } = await supabase
            .from('products')
            .upsert({
                product_name: productData.product_name,
                brand: productData.brand,
                category: productData.category,
                total_ingredients: productData.ingredients.length,
                last_scanned_at: new Date().toISOString(),
            }, { onConflict: 'product_name' })
            .select('id, scanned_count')
            .single()

        if (upsertedProduct) {
            productId = upsertedProduct.id
            existingScannedCount = upsertedProduct.scanned_count || 0
            // Atomic increment of scanned_count using RPC or raw update
            await supabase.rpc('increment_scanned_count', { product_id: upsertedProduct.id })
                .then(null, async () => {
                    // Fallback if RPC doesn't exist: use direct update
                    await supabase
                        .from('products')
                        .update({ scanned_count: existingScannedCount + 1 })
                        .eq('id', upsertedProduct.id)
                })
        }
    } catch (e) {
        console.error('[Analysis] Product upsert failed:', e)
    }

    // 3. Analyze Ingredients (BATCH MODE)
    const analyzedIngredients = []

    // A. Identify which ingredients need analysis
    const ingredientNames = productData.ingredients.map((i: { name: string }) => i.name)
    const { data: cachedIngredients } = await supabase
        .from('ingredients')
        .select('*')
        .in('name', ingredientNames)

    const cachedMap = new Map((cachedIngredients || []).map((i) => [i.name.toLowerCase(), i]))
    const needsAnalysis: string[] = []

    for (const item of productData.ingredients) {
        if (!cachedMap.has(item.name.toLowerCase())) {
            needsAnalysis.push(item.name)
        }
    }

    // B. Fetch CSV + external API data in PARALLEL (before Gemini)
    let csvContext = ''
    let enrichedData: Record<string, EnrichedIngredientData> = {}
    let externalApiContext = ''

    if (needsAnalysis.length > 0) {
        const [csvResult, enrichedResult] = await Promise.allSettled([
            // CSV lookup
            (async () => {
                const [productCsvContext, ingredientCsvContext] = await Promise.all([
                    lookupProductContext(productData.product_name),
                    lookupIngredientsContext(needsAnalysis),
                ])
                const parts: string[] = []
                if (productCsvContext) parts.push(productCsvContext)
                if (ingredientCsvContext) parts.push(ingredientCsvContext)
                return parts.length > 0 ? parts.join('\n\n') : ''
            })(),
            // External API enrichment (PubChem, CAS, FDA adverse events + recalls)
            getEnrichedDataForBatch(needsAnalysis, productCategory),
        ])

        if (csvResult.status === 'fulfilled' && csvResult.value) {
            csvContext = csvResult.value
            console.log(`[Analysis] CSV data found: ${csvContext.length} chars of additional context`)
        } else if (csvResult.status === 'rejected') {
            console.warn('[Analysis] CSV lookup failed (non-blocking):', csvResult.reason)
        }

        if (enrichedResult.status === 'fulfilled') {
            enrichedData = enrichedResult.value
            externalApiContext = formatEnrichedDataForPrompt(enrichedData)
            console.log(`[Analysis] External API data: ${Object.keys(enrichedData).length} ingredients enriched`)
        } else {
            console.warn('[Analysis] External API enrichment failed (non-blocking):', enrichedResult.reason)
        }
    }

    // C. Call Gemini in ONE Batch with enriched context
    let batchResults: Record<string, any> = {}
    if (needsAnalysis.length > 0) {
        console.log(`[Analysis] Batch analyzing ${needsAnalysis.length} new ingredients for ${productCategory} product...`)
        const rawBatchResults = await analyzeIngredientBatch(needsAnalysis, productCategory, csvContext, externalApiContext)

        // Build case-insensitive lookup: map lowercase key to first matching result
        for (const [key, value] of Object.entries(rawBatchResults)) {
            const lowerKey = key.toLowerCase()
            if (!(lowerKey in batchResults)) {
                batchResults[lowerKey] = value
            }
        }
    }

    // D. Merge Results — use pre-fetched enriched data (no per-ingredient API calls)
    for (const item of productData.ingredients) {
        const name = item.name
        const lowerName = name.toLowerCase()
        let analysis

        // 1. Get Base Analysis (Cache or Batch)
        if (cachedMap.has(lowerName)) {
            console.log(`Using cache for: ${name}`)
            analysis = cachedMap.get(lowerName)
        } else {
            // Get from batch result using lowercase key
            const analysisData = batchResults[lowerName]

            // Check if we actually got data. If not, use fallback but DO NOT SAVE to DB.
            const isValidAnalysis = !!analysisData
            const finalAnalysisData = analysisData || {
                simple_name: "Analysis pending",
                safety_verdict: "Caution",
                concerns: ["Could not verify in batch"]
            }

            // 2. Use pre-fetched enriched data (already fetched in parallel before Gemini)
            const officialData = enrichedData[name] || {
                cas_number: "Unknown",
                fda_reports: 0,
                epa_link: null,
                pubchem: null,
                fda_recalls: null,
                sources_checked: [],
            }

            let concerns = finalAnalysisData.concerns || []
            let safetyVerdict = finalAnalysisData.safety_verdict || "Caution"

            if (officialData.fda_reports > 0) {
                concerns.push(`FDA Adverse Events: ${officialData.fda_reports} reports filed.`)
                // Escalate verdict based on FDA adverse event volume
                if (officialData.fda_reports >= 100 && safetyVerdict === "SAFE") {
                    safetyVerdict = "CAUTION"
                }
                if (officialData.fda_reports >= 1000) {
                    safetyVerdict = "AVOID"
                }
            }
            if (officialData.fda_recalls && officialData.fda_recalls.total_recalls > 0) {
                concerns.push(`FDA Recalls: ${officialData.fda_recalls.total_recalls} recall(s) found.`)
                // Any FDA recall escalates at least to CAUTION
                if (safetyVerdict === "SAFE") {
                    safetyVerdict = "CAUTION"
                }
                if (officialData.fda_recalls.total_recalls >= 5) {
                    safetyVerdict = "AVOID"
                }
            }
            if (officialData.cas_number !== "Unknown") {
                 finalAnalysisData.chemical_formula = `${finalAnalysisData.chemical_formula || ''} (CAS: ${officialData.cas_number})`
            }

            // Populate banned_in from enriched data regardless of Gemini's verdict
            const bannedCountries = finalAnalysisData.banned_countries || []
            if (bannedCountries.length > 0 && safetyVerdict !== "BANNED") {
                safetyVerdict = "BANNED"
            }

            // Flat fields for DB storage
            let analysisToSave = {
                name,
                analyzed_count: 1,
                simple_name: finalAnalysisData.simple_name || "Analysis unavailable",
                chemical_formula: finalAnalysisData.chemical_formula,
                raw_materials: finalAnalysisData.raw_materials,
                common_uses: finalAnalysisData.common_uses,
                fda_status: finalAnalysisData.regulatory_status?.us_fda || "N/A",
                eu_status: finalAnalysisData.regulatory_status?.eu_efsa || finalAnalysisData.regulatory_status?.eu_cosing || "N/A",
                who_status: finalAnalysisData.regulatory_status?.who_iarc || "N/A",
                banned_in: bannedCountries.length > 0 ? bannedCountries : [],
                safe_limit: finalAnalysisData.regulatory_status?.india_fssai || "N/A",
                concerns: concerns,
                category: safetyVerdict
            }

            // ONLY Save to DB if we actually got a valid analysis from Gemini
            if (isValidAnalysis) {
                const { data: savedIngredient } = await supabase
                    .from('ingredients')
                    .insert(analysisToSave)
                    .select()
                    .single()
                analysis = savedIngredient || analysisToSave
            } else {
                console.warn(`Skipping DB save for ${name} (Batch analysis failed)`)
                analysis = analysisToSave
            }

            // Enrich with Gemini's structured data for rich UI display
            analysis.regulatory_status = finalAnalysisData.regulatory_status
            analysis.safety_limits = finalAnalysisData.safety_limits
            analysis.safety_limits_per_100g = finalAnalysisData.safety_limits_per_100g
            analysis.how_its_made = finalAnalysisData.how_its_made
            analysis.sources_cited = finalAnalysisData.sources_cited || []
            analysis.banned_countries = finalAnalysisData.banned_countries || []
            analysis.restricted_countries = finalAnalysisData.restricted_countries || []
            analysis.epa_link = officialData.epa_link
            analysis.pubchem_url = officialData.pubchem?.pubchem_url || null
            analysis.limit_exceeded = finalAnalysisData.limit_exceeded || null
            analysis.regional_ban_conflicts = finalAnalysisData.regional_ban_conflicts || []
            analysis.sources_checked = officialData.sources_checked || []
        }

        analyzedIngredients.push({
            ...item,
            analysis,
        })
    }

    // Batch translate all ingredients in ONE Gemini call instead of per-ingredient
    if (language.toLowerCase() !== 'english' && analyzedIngredients.length > 0) {
        try {
            const translationInput = analyzedIngredients
                .filter(item => item.analysis)
                .map((item, i) => `[${i}] ${item.analysis.simple_name || ''} | ${Array.isArray(item.analysis.concerns) ? item.analysis.concerns.join(', ') : (item.analysis.concerns || '')}`)
                .join('\n')

            const translated = await translateContent(translationInput, language)
            const lines = translated.split('\n')

            for (const line of lines) {
                const match = line.match(/^\[(\d+)\]\s*(.*)/)
                if (match) {
                    const idx = parseInt(match[1])
                    if (idx >= 0 && idx < analyzedIngredients.length && analyzedIngredients[idx].analysis) {
                        analyzedIngredients[idx].analysis.translated_text = match[2].trim()
                    }
                }
            }
            console.log(`[Analysis] Batch translated ${lines.length} ingredients to ${language}`)
        } catch (e) {
            console.warn('[Analysis] Batch translation failed, returning English:', (e as Error).message)
        }
    }

    return {
        productId,
        productData,
        ingredients: analyzedIngredients,
        scannedCount: existingScannedCount + 1,
    }
}