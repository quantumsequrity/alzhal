import crypto from 'crypto'

// R2 bucket type (from Cloudflare Workers runtime)
interface R2Bucket {
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<any>
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; size: number } | null>
  delete(key: string | string[]): Promise<void>
}

// In-memory fallback for local dev (not on Cloudflare Workers)
interface AudioEntry {
  buffer: Buffer
  mimeType: string
  expiresAt: number
}

const memStore = new Map<string, AudioEntry>()
const MAX_ENTRIES = 50
const TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get the R2 bucket binding if running on Cloudflare Workers.
 * Returns null in local dev.
 */
function getR2Bucket(): R2Bucket | null {
  try {
    // @opennextjs/cloudflare provides getCloudflareContext
    const { getCloudflareContext } = require('@opennextjs/cloudflare')
    const { env } = getCloudflareContext()
    return env?.AUDIO_BUCKET || null
  } catch {
    return null
  }
}

/**
 * Store audio data. Uses R2 on Cloudflare, in-memory locally.
 * Returns a unique ID.
 */
export async function storeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const id = crypto.randomBytes(16).toString('hex')
  const bucket = getR2Bucket()

  if (bucket) {
    // Cloudflare R2 storage
    await bucket.put(`tts/${id}.mp3`, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { createdAt: Date.now().toString() },
    })
  } else {
    // In-memory fallback for local dev
    if (memStore.size >= MAX_ENTRIES) {
      let oldestKey = ''
      let oldestTime = Infinity
      for (const [key, entry] of memStore) {
        if (entry.expiresAt < oldestTime) {
          oldestTime = entry.expiresAt
          oldestKey = key
        }
      }
      if (oldestKey) memStore.delete(oldestKey)
    }

    memStore.set(id, {
      buffer,
      mimeType,
      expiresAt: Date.now() + TTL_MS,
    })
  }

  return id
}

/**
 * Retrieve audio data by ID. Uses R2 on Cloudflare, in-memory locally.
 * Returns null if not found.
 */
export async function getAudio(id: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const bucket = getR2Bucket()

  if (bucket) {
    // Cloudflare R2 storage
    const object = await bucket.get(`tts/${id}.mp3`)
    if (!object) return null

    const arrayBuffer = await new Response(object.body).arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: object.httpMetadata?.contentType || 'audio/mpeg',
    }
  } else {
    // In-memory fallback
    const entry = memStore.get(id)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      memStore.delete(id)
      return null
    }
    return { buffer: entry.buffer, mimeType: entry.mimeType }
  }
}
