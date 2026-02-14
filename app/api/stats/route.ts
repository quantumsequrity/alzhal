import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

    // Fetch stats from Supabase in parallel
    const [productResult, ingredientResult, toxicResult, scanResult, topProductsResult, topConcernsResult] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('ingredients').select('*', { count: 'exact', head: true }),
      supabase.from('ingredients').select('*', { count: 'exact', head: true }).or('category.ilike.%Banned%,category.ilike.%AVOID%'),
      supabase.from('scans').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('product_name, brand, scanned_count, category').order('scanned_count', { ascending: false }).limit(5),
      supabase.from('ingredients').select('name, category, analyzed_count').or('category.ilike.%Banned%,category.ilike.%AVOID%,category.ilike.%CAUTION%').order('analyzed_count', { ascending: false }).limit(5),
    ])

    const stats = {
      productsChecked: productResult.count || 0,
      ingredientsAnalyzed: ingredientResult.count || 0,
      toxicFound: toxicResult.count || 0,
      totalScans: scanResult.count || 0,
      sourcesChecked: 6, // BIS, FSSAI, EU CosIng, FDA, EPA, WHO
      topProducts: topProductsResult.data || [],
      topConcerns: topConcernsResult.data || [],
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
