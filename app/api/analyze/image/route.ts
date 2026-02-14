import { NextRequest, NextResponse } from 'next/server'
import { processImageAndAnalyze } from '@/lib/analysis'
import { supabase } from '@/lib/supabase'
import { rateLimit, getClientIdentifier, validateImageFile, validateLanguage, getSecurityHeaders } from '@/lib/security'

export const maxDuration = 60

const limiter = rateLimit({ windowMs: 60000, maxRequests: 5 })

export async function POST(req: NextRequest) {
    try {
        // Rate limiting
        const clientId = getClientIdentifier(req)
        const { allowed } = limiter(clientId)
        if (!allowed) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait a moment before scanning again.' },
                { status: 429, headers: getSecurityHeaders() }
            )
        }

        const formData = await req.formData()
        const file = formData.get('image')
        const rawLang = formData.get('language')
        const language = validateLanguage(typeof rawLang === 'string' ? rawLang : 'English')

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: 'No image provided' }, { status: 400, headers: getSecurityHeaders() })
        }

        // Validate file
        const validation = validateImageFile(file)
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400, headers: getSecurityHeaders() })
        }

        let buffer: Buffer = Buffer.from(await file.arrayBuffer()) as Buffer
        let mimeType = file.type

        // Detect MIME type from extension if browser sends generic type
        if (mimeType === 'application/octet-stream' || !mimeType) {
            const fileName = file.name.toLowerCase()
            if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg'
            else if (fileName.endsWith('.png')) mimeType = 'image/png'
            else if (fileName.endsWith('.webp')) mimeType = 'image/webp'
            else if (fileName.endsWith('.avif')) mimeType = 'image/avif'
            else if (fileName.endsWith('.heic')) mimeType = 'image/heic'
            else if (fileName.endsWith('.heif')) mimeType = 'image/heif'

            // Default to jpeg if still unknown
            if (mimeType === 'application/octet-stream') {
                mimeType = 'image/jpeg'
            }
        }

        // Validate final MIME type - pass all supported formats to Gemini directly
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'].includes(mimeType)) {
            return NextResponse.json(
                { error: 'Unsupported image format. Please use JPEG, PNG, WebP, AVIF, or HEIC.' },
                { status: 400, headers: getSecurityHeaders() }
            )
        }

        // Process and analyze
        const result = await processImageAndAnalyze(buffer, mimeType, language)

        // Log scan (non-blocking)
        let scanId: string | undefined
        try {
            const { data: scanData } = await supabase.from('scans').insert({
                product_id: result.productId,
                input_type: 'web_upload',
                language,
                ingredients_found: result.ingredients.map((i: any) => i.name),
                response_sent: true,
            }).select('id').single()
            scanId = scanData?.id
        } catch (e) {
            console.error('Failed to log scan:', e)
        }

        return NextResponse.json({
            product: result.productData,
            ingredients: result.ingredients,
            scanId,
            scannedCount: result.scannedCount,
        }, { headers: getSecurityHeaders() })
    } catch (error: any) {
        console.error('Analysis failed:', error)

        // Return user-friendly error messages
        let userMessage = 'Analysis failed. Please try again.'
        if (error.message?.includes('429')) {
            userMessage = 'Service is busy. Please wait a moment and try again.'
        } else if (error.message?.includes('parse')) {
            userMessage = 'Could not read the product label clearly. Please try a clearer photo.'
        } else if (error.message?.includes('API')) {
            userMessage = 'External service temporarily unavailable. Please try again shortly.'
        }

        return NextResponse.json({ error: userMessage }, { status: 500, headers: getSecurityHeaders() })
    }
}
