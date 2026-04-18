import { NextRequest, NextResponse } from 'next/server'
import { extractNutritionPanel } from '@/lib/nutrition-ocr'
import {
  rateLimit,
  getClientIdentifier,
  validateImageFile,
  validateFileSignature,
  validateOrigin,
  getSecurityHeaders,
} from '@/lib/security'

export const maxDuration = 60

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5 })

export async function POST(req: NextRequest) {
  try {
    if (!validateOrigin(req)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getSecurityHeaders() })
    }

    const clientId = getClientIdentifier(req)
    const { allowed } = limiter(clientId)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment before scanning again.' },
        { status: 429, headers: getSecurityHeaders() },
      )
    }

    const formData = await req.formData()
    const file = formData.get('image')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400, headers: getSecurityHeaders() })
    }

    const validation = validateImageFile(file)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400, headers: getSecurityHeaders() })
    }

    const signatureValid = await validateFileSignature(file)
    if (!signatureValid) {
      return NextResponse.json(
        { error: 'File content does not match its declared type. Please upload a valid image.' },
        { status: 400, headers: getSecurityHeaders() },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer()) as Buffer
    const panel = await extractNutritionPanel(buffer, file.type)

    return NextResponse.json(
      {
        success: true,
        panel,
        // Explicit labeling so the UI can show a "measured from label, not inferred"
        // badge. This reinforces the no-hallucination guarantee.
        provenance: {
          source: 'OCR of nutrition facts panel printed on the product',
          detection_method: 'Gemini Vision + structured extraction',
          note: 'Values are transcribed from the printed panel. They are not cross-verified against regulatory limits here.',
        },
      },
      { headers: getSecurityHeaders() },
    )
  } catch (err) {
    console.error('[Nutrition route] error:', err)
    return NextResponse.json(
      { error: 'Nutrition panel extraction failed' },
      { status: 500, headers: getSecurityHeaders() },
    )
  }
}
