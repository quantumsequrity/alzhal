import crypto from 'crypto'

const whatsappToken = process.env.WHATSAPP_TOKEN
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
const appSecret = process.env.WHATSAPP_APP_SECRET

if (!whatsappToken || !phoneNumberId) {
    if (process.env.NODE_ENV === 'production') {
        console.error(
            'Missing required WhatsApp environment variables. ' +
            'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.'
        )
    } else {
        console.warn('Missing WhatsApp environment variables - WhatsApp operations will fail')
    }
}

export type WhatsAppResult = { success: true; data: any } | { success: false; rateLimited: boolean; error: string }

const WHATSAPP_API_BASE = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

/**
 * Normalize a phone number to Meta WhatsApp format.
 * Accepts formats like "whatsapp:+919876543210", "+919876543210", "919876543210"
 * and returns "919876543210" (country code + number, no prefix).
 */
function normalizePhoneNumber(phone: string): string {
    let normalized = phone
    // Strip "whatsapp:" prefix (case-insensitive)
    normalized = normalized.replace(/^whatsapp:/i, '')
    // Strip leading "+"
    normalized = normalized.replace(/^\+/, '')
    // Remove any spaces
    normalized = normalized.replace(/\s/g, '')
    return normalized
}

/**
 * Make an API call to the Meta WhatsApp Cloud API.
 */
async function whatsappApiCall(payload: Record<string, any>): Promise<WhatsAppResult> {
    const res = await fetch(WHATSAPP_API_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${whatsappToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    })

    if (!res.ok) {
        const errText = await res.text()
        const rateLimited = res.status === 429
        if (rateLimited) {
            console.warn('[WhatsApp] Rate limited. Message dropped.')
        } else {
            console.error(`[WhatsApp] API error (${res.status}): ${errText}`)
        }
        return { success: false, rateLimited, error: errText }
    }

    return { success: true, data: await res.json() }
}

/**
 * Send a text message via WhatsApp Cloud API.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<WhatsAppResult> {
    try {
        const recipient = normalizePhoneNumber(to)
        return await whatsappApiCall({
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'text',
            text: { body },
        })
    } catch (error) {
        console.error('Error sending WhatsApp message:', error)
        return { success: false, rateLimited: false, error: String(error) }
    }
}

/**
 * Send an audio message via WhatsApp Cloud API.
 * The mediaUrl must be a publicly accessible HTTPS URL.
 */
export async function sendWhatsAppAudio(to: string, mediaUrl: string): Promise<WhatsAppResult> {
    try {
        const recipient = normalizePhoneNumber(to)
        return await whatsappApiCall({
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'audio',
            audio: { link: mediaUrl },
        })
    } catch (error) {
        console.error('Error sending WhatsApp audio:', error)
        return { success: false, rateLimited: false, error: String(error) }
    }
}

/**
 * Verify the X-Hub-Signature-256 header from Meta webhook payloads.
 * Uses HMAC-SHA256 with the app secret to verify the raw request body.
 * Returns true if the signature is valid.
 */
export function verifyWebhookSignature(signature: string | null, rawBody: string): boolean {
    if (!appSecret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('[WhatsApp] WHATSAPP_APP_SECRET is required in production')
            return false
        }
        console.warn('[WhatsApp] No WHATSAPP_APP_SECRET - skipping signature verification (dev only)')
        return true
    }

    if (!signature) {
        console.warn('[WhatsApp] Missing X-Hub-Signature-256 header')
        return false
    }

    try {
        const expectedSignature = 'sha256=' + crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex')

        // Use timing-safe comparison to prevent timing attacks
        const sigBuffer = Buffer.from(signature)
        const expectedBuffer = Buffer.from(expectedSignature)

        if (sigBuffer.length !== expectedBuffer.length) {
            console.warn('[WhatsApp] Signature length mismatch')
            return false
        }

        const valid = crypto.timingSafeEqual(sigBuffer, expectedBuffer)
        if (!valid) {
            console.warn('[WhatsApp] Signature mismatch')
        }
        return valid
    } catch (e) {
        console.error('[WhatsApp] Signature verification error:', e)
        return false
    }
}

/**
 * Download media from the Meta WhatsApp Cloud API.
 * First retrieves the media URL using the media ID, then downloads the actual file.
 * Returns the file buffer and MIME type.
 */
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
        // Step 1: Get the media URL from Meta
        const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
            headers: {
                'Authorization': `Bearer ${whatsappToken}`,
            },
        })

        if (!metaRes.ok) {
            const errText = await metaRes.text()
            console.error(`[WhatsApp] Failed to get media URL (${metaRes.status}): ${errText}`)
            return null
        }

        const metaData = await metaRes.json()
        const mediaUrl: string = metaData.url
        const mimeType: string = metaData.mime_type || 'application/octet-stream'

        if (!mediaUrl) {
            console.error('[WhatsApp] No URL in media response')
            return null
        }

        // SSRF protection: only allow Meta media URLs
        const parsedUrl = new URL(mediaUrl)
        const hostname = parsedUrl.hostname.toLowerCase()

        // Require HTTPS
        if (parsedUrl.protocol !== 'https:') {
            console.error(`[WhatsApp] Blocked non-HTTPS media URL: ${parsedUrl.protocol}`)
            return null
        }

        // Validate hostname with exact match or subdomain check (dot prefix prevents suffix attacks)
        const isAllowedHost =
            hostname === 'graph.facebook.com' ||
            hostname.endsWith('.fbsbx.com') && (hostname === 'fbsbx.com' || hostname[hostname.length - '.fbsbx.com'.length - 1] === '.') ||
            hostname.endsWith('.facebook.com') && hostname[hostname.length - '.facebook.com'.length - 1] === '.' ||
            hostname.endsWith('.whatsapp.net') && (hostname === 'whatsapp.net' || hostname[hostname.length - '.whatsapp.net'.length - 1] === '.')

        if (!isAllowedHost) {
            console.error(`[WhatsApp] Blocked non-Meta media URL: ${hostname}`)
            return null
        }

        // Step 2: Download the actual media file
        const fileRes = await fetch(mediaUrl, {
            headers: {
                'Authorization': `Bearer ${whatsappToken}`,
            },
        })

        if (!fileRes.ok) {
            console.error(`[WhatsApp] Failed to download media (${fileRes.status})`)
            return null
        }

        const arrayBuffer = await fileRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        return { buffer, mimeType }
    } catch (error) {
        console.error('[WhatsApp] Media download error:', error)
        return null
    }
}
