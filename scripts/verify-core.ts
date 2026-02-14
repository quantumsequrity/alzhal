import { model, analyzeImage, analyzeIngredientBatch } from '../lib/gemini';
import fs from 'fs';
import path from 'path';

async function testGeminiIntegration() {
    console.log("🔍 STARTING GEMINI VERIFICATION...");

    // TEST 1: Text API (Batch Analysis)
    console.log("\n1️⃣  Testing Text API (Batch Analysis)...");
    try {
        const testIngredients = ["Sodium Laureth Sulfate", "Aqua", "Citric Acid"];
        console.log(`   Asking Gemini to analyze: ${testIngredients.join(", ")}`);
        
        const textStart = Date.now();
        const batchResult = await analyzeIngredientBatch(testIngredients);
        const textDuration = Date.now() - textStart;

        const keys = Object.keys(batchResult);
        if (keys.length > 0) {
            console.log(`   ✅ SUCCESS (${textDuration}ms)`);
            console.log(`   Received analysis for: ${keys.join(", ")}`);
            // Check if it followed strict rules
            const firstItem = batchResult[keys[0]];
            if (firstItem.regulatory_status) {
                 console.log(`   ✅ Structured Data Validated (Found regulatory_status)`);
            } else {
                 console.warn(`   ⚠️ Warning: Output format might be loose.`);
            }
        } else {
            console.error("   ❌ FAILED: Returned empty object.");
        }
    } catch (e: any) {
        console.error(`   ❌ CRITICAL FAILURE: ${e.message}`);
    }

    // TEST 2: Vision API (Image Analysis)
    console.log("\n2️⃣  Testing Vision API (Image Analysis)...");
    try {
        // We need a dummy image buffer. I'll create a tiny 1x1 JPEG buffer manually 
        // because we might not have a real file handy, and we just want to test the connection.
        // Actually, let's try to read the 'mag.avif' if it exists, or use a base64 string.
        
        // Minimal valid JPEG Base64
        const minimalJpeg = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
        const imageBuffer = Buffer.from(minimalJpeg, 'base64');
        
        console.log(`   Sending minimal test image to Gemini Vision...`);
        const visionStart = Date.now();
        
        // We use the raw model call to avoid our app's complexity for this pure connectivity test
        const result = await model.generateContent([
            "What color is this image? Reply with one word.", 
            { inlineData: { data: imageBuffer.toString('base64'), mimeType: "image/jpeg" } }
        ]);
        const response = await result.response;
        const text = response.text();
        const visionDuration = Date.now() - visionStart;

        if (text && text.length > 0) {
            console.log(`   ✅ SUCCESS (${visionDuration}ms)`);
            console.log(`   Gemini saw: "${text.trim()}"`);
        } else {
            console.error("   ❌ FAILED: Empty response.");
        }

    } catch (e: any) {
        console.error(`   ❌ CRITICAL FAILURE: ${e.message}`);
    }

    console.log("\n🏁 VERIFICATION COMPLETE.");
}

// Execute
testGeminiIntegration();