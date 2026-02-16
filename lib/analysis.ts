import { analyzeImage, analyzeIngredientBatch, translateContent } from './gemini'
import { query, queryOne, execute, generateId } from './db'
import { getEnrichedDataForBatch, formatEnrichedDataForPrompt, EnrichedIngredientData } from './external-data'
import { lookupIngredientsContext, lookupProductContext } from './product-data'
import { mergeOcrResults } from './ocr-merge'
import { extractWithWorkersAI } from './workers-ai-ocr'

export async function processImageAndAnalyze(imageBuffer: Buffer, mimeType: string, language: string = 'English', clientOcrText: string = '') {
    // 1. Multi-source OCR: Gemini Vision + Workers AI in parallel (Tesseract already ran client-side)
    console.log('[Analysis] Starting multi-source OCR...')

    const [geminiResult, workersAIResult] = await Promise.allSettled([
        analyzeImage(imageBuffer, mimeType),
        extractWithWorkersAI(imageBuffer, mimeType),
    ])

    const geminiData = geminiResult.status === 'fulfilled' ? geminiResult.value : null
    const workersAIData = workersAIResult.status === 'fulfilled' ? workersAIResult.value : null

    if (geminiResult.status === 'rejected') {
        console.warn('[Analysis] Gemini Vision failed:', geminiResult.reason?.message || geminiResult.reason)
    }
    if (workersAIResult.status === 'rejected') {
        console.warn('[Analysis] Workers AI OCR failed:', workersAIResult.reason?.message || workersAIResult.reason)
    }

    // Merge all OCR sources
    const merged = mergeOcrResults({
        gemini: geminiData,
        workersAI: workersAIData,
        tesseractRaw: clientOcrText,
    })

    console.log(`[Analysis] OCR sources: [${merged.ocrSources.join(', ')}], primary: ${merged.primarySource}, ${merged.ingredients.length} ingredients`)

    const productData = {
        product_name: merged.product_name,
        brand: merged.brand,
        category: merged.category,
        ingredients: merged.ingredients,
    }
    const ocrSources = merged.ocrSources
    const productCategory = productData.category || 'food'
    console.log(`[Analysis] Product: ${productData.product_name} (${productCategory}), ${productData.ingredients.length} ingredients`)

    // 2. Upsert Product in DB (atomic to prevent race conditions)
    let productId: string | undefined
    let existingScannedCount = 0
    try {
        const newId = generateId()
        await execute(
            `INSERT INTO products (id, product_name, brand, category, total_ingredients, last_scanned_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(product_name) DO UPDATE SET
               brand = excluded.brand,
               category = excluded.category,
               total_ingredients = excluded.total_ingredients,
               last_scanned_at = datetime('now')`,
            [newId, productData.product_name, productData.brand, productData.category, productData.ingredients.length]
        )
        const product = await queryOne<{ id: string; scanned_count: number }>(
            'SELECT id, scanned_count FROM products WHERE product_name = ?',
            [productData.product_name]
        )
        if (product) {
            productId = product.id
            existingScannedCount = product.scanned_count || 0
            // Atomic increment — single SQL statement, no RPC needed
            await execute('UPDATE products SET scanned_count = scanned_count + 1 WHERE id = ?', [product.id])
        }
    } catch (e) {
        console.error('[Analysis] Product upsert failed:', e)
    }

    // 3. Analyze Ingredients (BATCH MODE)
    const analyzedIngredients = []

    // A. Identify which ingredients need analysis
    const ingredientNames = productData.ingredients.map((i: { name: string }) => i.name)
    const placeholders = ingredientNames.map(() => '?').join(',')
    const cachedIngredients = ingredientNames.length > 0
        ? await query<any>(`SELECT * FROM ingredients WHERE name IN (${placeholders})`, ingredientNames)
        : []

    const cachedMap = new Map(cachedIngredients.map((i: any) => {
        // Parse JSON text columns from D1
        if (typeof i.concerns === 'string') try { i.concerns = JSON.parse(i.concerns) } catch { i.concerns = [] }
        if (typeof i.banned_in === 'string') try { i.banned_in = JSON.parse(i.banned_in) } catch { i.banned_in = [] }
        return [i.name.toLowerCase(), i]
    }))
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
            let analysisToSave: any = {
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
                const ingId = generateId()
                try {
                    await execute(
                        `INSERT INTO ingredients (id, name, analyzed_count, simple_name, chemical_formula, raw_materials, common_uses, fda_status, eu_status, who_status, banned_in, safe_limit, concerns, category)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT(name) DO NOTHING`,
                        [ingId, analysisToSave.name, analysisToSave.analyzed_count, analysisToSave.simple_name,
                         analysisToSave.chemical_formula,
                         typeof analysisToSave.raw_materials === 'string' ? analysisToSave.raw_materials : JSON.stringify(analysisToSave.raw_materials || null),
                         typeof analysisToSave.common_uses === 'string' ? analysisToSave.common_uses : JSON.stringify(analysisToSave.common_uses || null),
                         analysisToSave.fda_status, analysisToSave.eu_status, analysisToSave.who_status,
                         JSON.stringify(analysisToSave.banned_in), analysisToSave.safe_limit,
                         JSON.stringify(analysisToSave.concerns), analysisToSave.category]
                    )
                } catch (e) {
                    console.error(`[Analysis] DB save failed for ${name}:`, e)
                }
                analysis = analysisToSave
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
        ocrSources,
    }
}