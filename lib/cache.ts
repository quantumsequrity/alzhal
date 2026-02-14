// Simple in-memory cache with TTL
// In production, use Redis or similar

// Sentinel value to distinguish cached null from cache miss
const NULL_SENTINEL = '__NULL__' as const
type SentinelType = typeof NULL_SENTINEL

interface CacheEntry<T> {
  data: T | SentinelType
  expiresAt: number
  createdAt: number
}

const MAX_CACHE_SIZE = 10000

class MemoryCache {
  private store: Map<string, CacheEntry<any>>
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor() {
    this.store = new Map()
    // Clean expired entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000)
    // Ensure the timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
    this.store.clear()
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Evict oldest 20% if at capacity
    if (this.store.size >= MAX_CACHE_SIZE && !this.store.has(key)) {
      this.evictOldest()
    }

    this.store.set(key, {
      data: value === null ? NULL_SENTINEL : value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    })
  }

  get<T>(key: string): T | null | undefined {
    const entry = this.store.get(key)

    if (!entry) {
      return undefined
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }

    if (entry.data === NULL_SENTINEL) {
      return null
    }

    return entry.data as T
  }

  has(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return false
    }
    return true
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  private evictOldest(): void {
    const entriesToEvict = Math.ceil(MAX_CACHE_SIZE * 0.2)
    const entries = Array.from(this.store.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, entriesToEvict)

    for (const [key] of entries) {
      this.store.delete(key)
    }

    console.log(`[Cache] Evicted ${entries.length} oldest entries (size was ${MAX_CACHE_SIZE})`)
  }

  private cleanup(): void {
    const now = Date.now()
    const keysToDelete: string[] = []

    this.store.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach((key) => this.store.delete(key))

    if (keysToDelete.length > 0) {
      console.log(`[Cache] Cleaned up ${keysToDelete.length} expired entries`)
    }
  }

  size(): number {
    return this.store.size
  }
}

// Singleton instance
export const cache = new MemoryCache()

// Cache TTLs
export const CACHE_TTL = {
  INGREDIENT: 7 * 24 * 60 * 60 * 1000, // 7 days
  PRODUCT: 24 * 60 * 60 * 1000, // 1 day
  EXTERNAL_API: 12 * 60 * 60 * 1000, // 12 hours
  STATS: 5 * 60 * 1000, // 5 minutes
}

// Helper functions
export function getCacheKey(type: string, identifier: string): string {
  return `${type}:${identifier.toLowerCase()}`
}

export function cacheIngredient(name: string, data: any): void {
  const key = getCacheKey('ingredient', name)
  cache.set(key, data, CACHE_TTL.INGREDIENT)
}

export function getCachedIngredient(name: string): any | undefined {
  const key = getCacheKey('ingredient', name)
  const result = cache.get(key)
  return result === undefined ? undefined : result
}

export function cacheProduct(name: string, data: any): void {
  const key = getCacheKey('product', name)
  cache.set(key, data, CACHE_TTL.PRODUCT)
}

export function getCachedProduct(name: string): any | undefined {
  const key = getCacheKey('product', name)
  const result = cache.get(key)
  return result === undefined ? undefined : result
}

export function cacheExternalData(identifier: string, data: any): void {
  const key = getCacheKey('external', identifier)
  cache.set(key, data, CACHE_TTL.EXTERNAL_API)
}

export function getCachedExternalData(identifier: string): any | undefined {
  const key = getCacheKey('external', identifier)
  const result = cache.get(key)
  return result === undefined ? undefined : result
}

export function cacheStats(data: any): void {
  cache.set('stats:current', data, CACHE_TTL.STATS)
}

export function getCachedStats(): any | undefined {
  const result = cache.get('stats:current')
  return result === undefined ? undefined : result
}
