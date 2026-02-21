import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/db'
import { getCachedStats, cacheStats } from '@/lib/cache'
import { getSecurityHeaders } from '@/lib/security'

export const maxDuration = 10

export async function GET(req: NextRequest) {
  try {
    // Check cache first (5 minute TTL)
    const cached = getCachedStats()
    if (cached) {
      return NextResponse.json(cached, { headers: getSecurityHeaders() })
    }

    // Fetch stats from D1 in parallel
    const [productCount, ingredientCount, toxicCount, scanCount, topProducts, topConcerns] = await Promise.all([
      queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM products'),
      queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM ingredients'),
      queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM ingredients WHERE category LIKE '%Banned%' OR category LIKE '%AVOID%'"),
      queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM scans'),
      query<{ product_name: string; brand: string; scanned_count: number; category: string }>(
        'SELECT product_name, brand, scanned_count, category FROM products ORDER BY scanned_count DESC LIMIT 5'
      ),
      query<{ name: string; category: string; analyzed_count: number }>(
        "SELECT name, category, analyzed_count FROM ingredients WHERE category LIKE '%Banned%' OR category LIKE '%AVOID%' OR category LIKE '%CAUTION%' ORDER BY analyzed_count DESC LIMIT 5"
      ),
    ])

    const stats = {
      productsChecked: productCount?.cnt || 0,
      ingredientsAnalyzed: ingredientCount?.cnt || 0,
      toxicFound: toxicCount?.cnt || 0,
      totalScans: scanCount?.cnt || 0,
      sourcesChecked: 6, // BIS, FSSAI, EU CosIng, FDA, EPA, WHO
      topProducts,
      topConcerns,
    }

    // Cache the result
    cacheStats(stats)

    return NextResponse.json(stats, { headers: getSecurityHeaders() })
  } catch (error: any) {
    console.error('Stats fetch failed:', error)
    return NextResponse.json({
      error: 'Failed to fetch statistics. Please try again.',
    }, { status: 500, headers: getSecurityHeaders() })
  }
}
