import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const COOLDOWN_MS = 72 * 60 * 60 * 1000 // 72h

/**
 * GET /api/master/status?userId=xxx
 *
 * Visit Master gate + history. Paid-only: free users get a paywall prompt, no
 * forest. Access is a 72h cooldown derived from the latest visit's created_at
 * -- after a visit the Master is "away travelling" until 72h pass. Also returns
 * the visit history (date + question excerpt) for the history screen.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Paid?
    const { data: profile } = await supabase
      .from('profiles').select('subscription_tier').eq('id', userId).maybeSingle()
    const isPaid = (profile?.subscription_tier ?? 'free') !== 'free'

    // Latest visit -> cooldown.
    const { data: latest } = await supabase
      .from('master_visits')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let available = true
    let nextAvailableAt = null
    if (latest) {
      const readyAt = new Date(latest.created_at).getTime() + COOLDOWN_MS
      if (Date.now() < readyAt) {
        available = false
        nextAvailableAt = new Date(readyAt).toISOString()
      }
    }

    // History (date + question, most recent first).
    const { data: history } = await supabase
      .from('master_visits')
      .select('id, question, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)

    return NextResponse.json({
      success: true,
      isPaid,
      available: isPaid && available,
      nextAvailableAt,
      history: (history || []).map((h) => ({ id: h.id, question: h.question, createdAt: h.created_at })),
    })
  } catch (err) {
    console.error('[master/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
