const botToken = process.env.TELEGRAM_BOT_TOKEN

if (!botToken) {
    if (process.env.NODE_ENV === 'production') {
        console.error(
            'Missing TELEGRAM_BOT_TOKEN environment variable. ' +
            'Telegram bot will not work.'
        )
    } else {
        console.warn('Missing TELEGRAM_BOT_TOKEN - Telegram operations will fail')
    }
}

export type TelegramResult = { success: true; data: any } | { success: false; error: string }

const TELEGRAM_API = `https://api.telegram.org/bot${botToken}`

/**
 * Make a Telegram Bot API call.
 */
async function telegramApiCall(method: string, payload: Record<string, any>): Promise<TelegramResult> {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })

    if (!res.ok) {
        const errText = await res.text()
        console.error(`[Telegram] API error (${res.status}) on ${method}: ${errText}`)
        return { success: false, error: errText }
    }

    return { success: true, data: await res.json() }
}

/**
 * Send a text message to a Telegram chat.
 * Supports Markdown formatting.
 */
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<TelegramResult> {
    try {
        // Telegram has a 4096 char limit per message
        const truncated = text.slice(0, 4096)
        return await telegramApiCall('sendMessage', {
            chat_id: chatId,
            text: truncated,
            parse_mode: 'Markdown',
        })
    } catch (error) {
        console.error('[Telegram] Error sending message:', error)
        // Retry without Markdown if parse_mode causes issues
        try {
            return await telegramApiCall('sendMessage', {
                chat_id: chatId,
                text: text.slice(0, 4096),
            })
        } catch (retryError) {
            return { success: false, error: String(retryError) }
        }
    }
}

/**
 * Send an audio file via URL to a Telegram chat.
 * Uses sendVoice for voice-like TTS audio (plays inline in Telegram).
 */
export async function sendTelegramAudio(chatId: number | string, audioUrl: string): Promise<TelegramResult> {
    try {
        return await telegramApiCall('sendVoice', {
            chat_id: chatId,
            voice: audioUrl,
        })
    } catch (error) {
        console.error('[Telegram] Error sending audio:', error)
        return { success: false, error: String(error) }
    }
}

/**
 * Download a file from Telegram servers.
 * First gets the file path via getFile, then downloads the actual file.
 * Returns the buffer and a guessed MIME type.
 */
export async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
        // Step 1: Get file path from Telegram
        const fileInfoRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${encodeURIComponent(fileId)}`)
        if (!fileInfoRes.ok) {
            console.error(`[Telegram] getFile failed (${fileInfoRes.status})`)
            return null
        }

        const fileInfo = await fileInfoRes.json()
        const filePath: string | undefined = fileInfo.result?.file_path
        if (!filePath) {
            console.error('[Telegram] No file_path in getFile response')
            return null
        }

        // Step 2: Download the file
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`

        // SSRF protection: only allow Telegram file URLs
        const parsedUrl = new URL(fileUrl)
        if (parsedUrl.hostname !== 'api.telegram.org') {
            console.error(`[Telegram] Blocked non-Telegram file URL: ${parsedUrl.hostname}`)
            return null
        }

        const fileRes = await fetch(fileUrl)
        if (!fileRes.ok) {
            console.error(`[Telegram] File download failed (${fileRes.status})`)
            return null
        }

        const arrayBuffer = await fileRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Guess MIME type from file extension
        const ext = filePath.split('.').pop()?.toLowerCase() || ''
        const mimeMap: Record<string, string> = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            gif: 'image/gif',
            ogg: 'audio/ogg',
            oga: 'audio/ogg',
            mp3: 'audio/mpeg',
            m4a: 'audio/mp4',
            wav: 'audio/wav',
        }
        const mimeType = mimeMap[ext] || 'application/octet-stream'

        return { buffer, mimeType }
    } catch (error) {
        console.error('[Telegram] File download error:', error)
        return null
    }
}

/**
 * Set the webhook URL for the Telegram bot.
 * Call this once to register your webhook endpoint.
 */
export async function setWebhook(url: string): Promise<TelegramResult> {
    return telegramApiCall('setWebhook', { url })
}
