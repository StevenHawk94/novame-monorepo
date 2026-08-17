import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { generateBrief } from '@/lib/connection-brief'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'edge'

export async function GET(request) {
  try {
    const verified = await verifyToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') || '')
      ? searchParams.get('date') : new Date().toISOString().slice(0, 10)
    const intentView = searchParams.get('intent') === 'view'
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: me } = await supabase.from('profiles').select('subscription_tier, ai_consent_at').eq('id', userId).maybeSingle()
    if ((me?.subscription_tier || 'free') === 'free') return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    if (!me?.ai_consent_at) return NextResponse.json({ error: 'consent_required' }, { status: 403 })
    if (intentView) await supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', userId)

    const { data: pairing } = await supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle()
    if (!pairing) return NextResponse.json({ success: true, paired: false, insights: null })
    const partnerId = pairing.partner_user_id
    const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
    const { data: partner } = await supabase.from('profiles').select('share_memory_details, memory_details_mode').eq('id', partnerId).maybeSingle()
    const mode = partner?.memory_details_mode || (partner?.share_memory_details === false ? 'none' : 'custom')
    if (mode === 'none') return NextResponse.json({ success: true, paired: true, insights: null, reason: 'unavailable' })

    const { data: cached } = await supabase.from('connection_insights').select('payload, for_date, created_at')
      .eq('user_a', ua).eq('user_b', ub).eq('for_user', userId)
      .order('for_date', { ascending: false }).limit(1).maybeSingle()
    const { data: inactive } = await supabase.from('reflect_ai_analyses').select('reflect_id')
      .eq('user_id', partnerId).eq('connection_mode', 'inactive')
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).limit(1).maybeSingle()

    if (!intentView || !inactive) {
      return NextResponse.json({ success: true, paired: true, insights: cached?.payload || null, cached: true })
    }
    const gate = await rateLimit(supabase, `insights-catchup:${ua}:${ub}:${userId}`, 1, 86400)
    if (!gate.allowed) return NextResponse.json({ success: true, paired: true, insights: cached?.payload || null, cached: true })
    const result = await generateBrief(supabase, {
      ua, ub, forUser: userId, partnerId, date, cachedPayload: cached?.payload || null, markCaughtUp: true,
    })
    if (!result.ok) return NextResponse.json({ success: true, paired: true, insights: cached?.payload || null, cached: true })
    return NextResponse.json({ success: true, paired: true, insights: result.insights, cached: false })
  } catch (err) {
    console.error('[friends/insights] unexpected:', err?.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
