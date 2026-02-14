import { analyzeImage, analyzeIngredientBatch, translateContent } from './gemini'
import { supabase } from './supabase'
import { getOfficialData } from './external-data'

export async function processImageAndAnalyze(imageBuffer: Buffer, mimeType: string, language: string = 'English') {
    // 1. Analyze Image with Gemini Vision
    console.log('[Analysis] Starting image analysis...')
    const productData = await analyzeImage(imageBuffer, mimeType)
    const productCategory = productData.category || 'food'
    console.log(`[Analysis] Product: ${productData.product_name} (${productCategory}), ${productData.ingredients.length} ingredients`)

    // 2. Check/Update Product in DB
    let productId
    const { data: existingProduct } = await supabase
        .from('products')
        .select('id, scanned_count')
        .eq('product_name', productData.product_name)
        .single()

    if (existingProduct) {
        productId = existingProduct.id
        await supabase
            .from('products')
            .update({
                scanned_count: existingProduct.scanned_count + 1,
                last_scanned_at: new Date().toISOString(),
            })
            .eq('id', productId)
    } else {
        const { data: newProduct } = await supabase
            .from('products')
            .insert({
                product_name: productData.product_name,
                brand: productData.brand,
                category: productData.category,
                total_ingredients: productData.ingredients.length,
            })
            .select()
            .single()
        productId = newProduct?.id
    }

    // 3. Analyze Ingredients (BATCH MODE)
    const analyzedIngredients = []

    // A. Identify which ingredients need analysis
    const ingredientNames = productData.ingredients.map((i: any) => i.name)
    const { data: cachedIngredients } = await supabase
        .from('ingredients')
        .select('*')
        .in('name', ingredientNames)

    const cachedMap = new Map((cachedIngredients || []).map((i) => [i.name.toLowerCase(), i]))
    const needsAnalysis = []

    for (const item of productData.ingredients) {
        if (!cachedMap.has(item.name.toLowerCase())) {
            needsAnalysis.push(item.name)
        }
    }

    // B. Call Gemini in ONE Batch for all missing items
    let batchResults: Record<string, any> = {}
    if (needsAnalysis.length > 0) {
        console.log(`[Analysis] Batch analyzing ${needsAnalysis.length} new ingredients for ${productCategory} product...`)
        const rawBatchResults = await analyzeIngredientBatch(needsAnalysis, productCategory)
        
        // Normalize batch results keys to lowercase for robust matching
        // Gemini might return "Citric Acid" or "citric acid", we want to match "Citric Acid" input
        for (const [key, value] of Object.entries(rawBatchResults)) {
            batchResults[key.toLowerCase()] = value
        }
    }

    // C. Merge Results & Add Deterministic Data
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

            // 2. Deterministic Check (CAS/FDA/EPA) - Still run per item but it's fast/free
            let officialData = { cas_number: "Unknown", fda_reports: 0, epa_link: null as string | null };
            try {
                officialData = await getOfficialData(name, productCategory);
            } catch (e) { console.error('Official Data Check failed', e) }

            let concerns = finalAnalysisData.concerns || []
            let safetyVerdict = finalAnalysisData.safety_verdict || "Caution"

            if (officialData.fda_reports > 0) {
                concerns.push(`⚠️ FDA Adverse Events: ${officialData.fda_reports} reports filed.`)
            }
            if (officialData.cas_number !== "Unknown") {
                 finalAnalysisData.chemical_formula = `${finalAnalysisData.chemical_formula || ''} (CAS: ${officialData.cas_number})`
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
                eu_status: finalAnalysisData.regulatory_status?.eu_cosing || "N/A",
                who_status: finalAnalysisData.regulatory_status?.who_iarc || "N/A",
                banned_in: safetyVerdict === 'Banned' ? (finalAnalysisData.banned_countries || ['Check Sources']) : [],
                safe_limit: finalAnalysisData.regulatory_status?.india_fssai || "N/A",
                concerns: concerns,
                category: safetyVerdict
            }

            // ONLY Save to DB if we actually got a valid analysis from Gemini
            // We don't want to fill the DB with "Analysis pending" placeholders
            if (isValidAnalysis) {
                const { data: savedIngredient } = await supabase
                    .from('ingredients')
                    .insert(analysisToSave)
                    .select()
                    .single()
                analysis = savedIngredient || analysisToSave
            } else {
                // Return the fallback data to the user, but don't cache it
                console.warn(`Skipping DB save for ${name} (Batch analysis failed)`)
                analysis = analysisToSave
            }

            // Enrich with Gemini's structured data for rich UI display
            // (these aren't stored in DB but are needed by the frontend)
            analysis.regulatory_status = finalAnalysisData.regulatory_status
            analysis.safety_limits = finalAnalysisData.safety_limits
            analysis.sources_cited = finalAnalysisData.sources_cited || []
            analysis.banned_countries = finalAnalysisData.banned_countries || []
            analysis.epa_link = officialData.epa_link
            analysis.limit_exceeded = finalAnalysisData.limit_exceeded || null
            analysis.regional_ban_conflicts = finalAnalysisData.regional_ban_conflicts || []
        }

        // Translate if needed
        if (language.toLowerCase() !== 'english' && analysis) {
            try {
                const textToTranslate = `
           Explanation: ${analysis.simple_name}
           Concerns: ${Array.isArray(analysis.concerns) ? analysis.concerns.join(', ') : analysis.concerns}
         `
                const translatedText = await translateContent(textToTranslate, language)
                analysis.translated_text = translatedText
            } catch (e) {
                console.error('Translation failed', e)
            }
        }

        analyzedIngredients.push({
            ...item,
            analysis,
        })
    }

    return {
        productId,
        productData,
        ingredients: analyzedIngredients,
        scannedCount: existingProduct?.scanned_count ? existingProduct.scanned_count + 1 : 1,
    }
}