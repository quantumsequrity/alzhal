import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { rateLimit, getClientIdentifier, getSecurityHeaders } from '@/lib/security'

const limiter = rateLimit({ windowMs: 60000, maxRequests: 20 })

export async function POST(req: NextRequest) {
  try {
    const clientId = getClientIdentifier(req)
    const { allowed } = limiter(clientId)
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: getSecurityHeaders() })
    }

    const body = await req.json()
    const { scan_id, method } = body

    if (!scan_id || typeof scan_id !== 'string') {
      return NextResponse.json({ error: 'scan_id is required' }, { status: 400, headers: getSecurityHeaders() })
    }

    if (method !== 'whatsapp' && method !== 'copy') {
      return NextResponse.json({ error: 'method must be "whatsapp" or "copy"' }, { status: 400, headers: getSecurityHeaders() })
    }

    // Atomic increment using RPC, with fallback to read-then-write
    const { error: rpcError } = await supabase.rpc('increment_share_count', { scan_uuid: scan_id })
    if (rpcError) {
      // Fallback if RPC doesn't exist: non-atomic but functional
      const { data: current } = await supabase
          .from('scans')
          .select('share_count')
          .eq('id', scan_id)
          .single()

      if (current) {
          await supabase
              .from('scans')
              .update({ share_count: (current.share_count || 0) + 1 })
              .eq('id', scan_id)
      }
    }

    return NextResponse.json({ success: true }, { headers: getSecurityHeaders() })
  } catch (error) {
    console.error('Share tracking error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: getSecurityHeaders() })
  }
}
