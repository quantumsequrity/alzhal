import { NextRequest, NextResponse } from 'next/server'
import { setWebhook } from '@/lib/telegram'
import { getSecurityHeaders } from '@/lib/security'

/**
 * GET /api/telegram/setup
 * One-time setup endpoint to register the Telegram webhook.
 * Requires ?secret= parameter matching TELEGRAM_BOT_TOKEN to prevent abuse.
 *
 * Usage: curl "https://your-domain.com/api/telegram/setup?secret=YOUR_BOT_TOKEN"
 */
export async function GET(req: NextRequest) {
    const secret = req.nextUrl.searchParams.get('secret')
    const botToken = process.env.TELEGRAM_BOT_TOKEN

    if (!botToken) {
        return NextResponse.json(
            { error: 'TELEGRAM_BOT_TOKEN not configured' },
            { status: 500, headers: getSecurityHeaders() }
        )
    }

    // Simple auth: the caller must know the bot token
    if (secret !== botToken) {
        return NextResponse.json(
            { error: 'Invalid secret' },
            { status: 403, headers: getSecurityHeaders() }
        )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
        return NextResponse.json(
            { error: 'NEXT_PUBLIC_APP_URL not configured' },
            { status: 500, headers: getSecurityHeaders() }
        )
    }

    const webhookUrl = `${appUrl}/api/telegram/webhook`
    const result = await setWebhook(webhookUrl)

    if (result.success) {
        return NextResponse.json(
            { ok: true, webhook_url: webhookUrl, telegram_response: result.data },
            { headers: getSecurityHeaders() }
        )
    }

    return NextResponse.json(
        { error: 'Failed to set webhook', details: result.error },
        { status: 500, headers: getSecurityHeaders() }
    )
}
