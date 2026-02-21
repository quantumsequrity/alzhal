// D1 database helpers for the Sage Insight app tables.
// Follows the same pattern as lib/product-data.ts D1 access.

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
}

/** Get the APP_DB D1 binding from Cloudflare context. */
export function getAppDb(): D1Database {
  const { getCloudflareContext } = require('@opennextjs/cloudflare')
  const { env } = getCloudflareContext()
  return env.APP_DB
}

/** Run a query and return all matching rows. */
export async function query<T = Record<string, unknown>>(sql: string, params: any[] = []): Promise<T[]> {
  const db = getAppDb()
  const stmt = params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql)
  const result = await stmt.all<T>()
  return result.results
}

/** Run a query and return the first matching row, or null. */
export async function queryOne<T = Record<string, unknown>>(sql: string, params: any[] = []): Promise<T | null> {
  const db = getAppDb()
  const stmt = params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql)
  return stmt.first<T>()
}

/** Execute a write statement (INSERT/UPDATE/DELETE). */
export async function execute(sql: string, params: any[] = []): Promise<{ success: boolean; changes: number }> {
  const db = getAppDb()
  const stmt = params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql)
  const result = await stmt.run()
  return { success: result.success, changes: result.meta.changes }
}

/** Generate a new UUID for use as a primary key. */
export function generateId(): string {
  return crypto.randomUUID()
}

/** Safely parse a D1 JSON text column (arrays stored as TEXT). Returns fallback on error. */
export function parseJsonColumn<T = any[]>(value: unknown, fallback: T = [] as T): T {
  if (Array.isArray(value)) return value as T
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return fallback
}
