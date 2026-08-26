import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { generateBrief } from '@/lib/connection-brief'

export const runtime = 'edge'

const MODULE_KEYS = [
  'worth_knowing', 'recent_vibe', 'what_theyre_into', 'how_to_show_up',
  'talk_about', 'try_together', 'shared_rhythm',
]

function publicInsights(payload) {
  if (payload?.schemaVersion !== 2 || !payload.modules) return null
  const modules = {}
  for (const key of MODULE_KEYS) {
    modules[key] = (Array.isArray(payload.modules[key]) ? payload.modules[key] : [])
      .filter((card) => !card?.expiresAt || Date.parse(card.expiresAt) > Date.now())
      .map((card) => ({
      label: typeof card?.label === 'string' ? card.label : 'Worth Noticing',
      headline: typeof card?.headline === 'string' ? card.headline : null,
      body: typeof card?.body === 'string' ? card.body : '',
      supportingText: typeof card?.supportingText === 'string' ? card.supportingText : null,
      action: typeof card?.action === 'string' ? card.action : null,
      })).filter((card) => card.body)
  }
  return { schemaVersion: 2, modules, updatedAt: payload.updatedAt || null }
}

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
    const forceResume = searchParams.get('resume') === '1'
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: me, error: meError } = await supabase.from('profiles')
      .select('subscription_tier, connection_resume_required')
      .eq('id', userId).maybeSingle()
    if (meError) throw meError
    if ((me?.subscription_tier || 'free') === 'free') return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    if (intentView) {
      const { error: activityError } = await supabase.from('profiles')
        .update({ last_active_at: new Date().toISOString() }).eq('id', userId)
      if (activityError) throw activityError
    }

    const { data: pairing, error: pairingError } = await supabase.from('pairings')
      .select('partner_user_id, created_at').eq('user_id', userId).maybeSingle()
    if (pairingError) throw pairingError
    if (!pairing) return NextResponse.json({ success: true, paired: false, insights: null })
    const partnerId = pairing.partner_user_id
    const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
    const { data: partner, error: partnerError } = await supabase.from('profiles')
      .select('share_memory_details, memory_details_mode, ai_consent_at')
      .eq('id', partnerId).maybeSingle()
    if (partnerError) throw partnerError
    const mode = partner?.memory_details_mode || (partner?.share_memory_details === false ? 'none' : 'custom')
    // Connection copy is derived from the partner's reflections. The viewer's
    // own AI choice is irrelevant to reading already-authorized partner data.
    if (mode === 'none' || !partner?.ai_consent_at) {
      return NextResponse.json({ success: true, paired: true, insights: null, reason: 'unavailable' })
    }

    const { data: cached, error: cachedError } = await supabase.from('connection_insights').select('payload, for_date, created_at')
      .eq('user_a', ua).eq('user_b', ub).eq('for_user', userId)
      .order('for_date', { ascending: false }).limit(1).maybeSingle()
    if (cachedError) throw cachedError
    const cachedInsights = publicInsights(cached?.payload)
    const needsRecovery = !cachedInsights
    if (!intentView || (me?.connection_resume_required !== true && !forceResume && !needsRecovery)) {
      return NextResponse.json({
        success: true, paired: true, insights: cachedInsights, cached: true,
      })
    }
    const result = await generateBrief(supabase, {
      forUser: userId,
      partnerId,
      date,
      cachedPayload: cached?.payload || null,
      pairedSince: pairing.created_at || null,
    })
    if (!result.ok) {
      return NextResponse.json({
        success: true, paired: true, insights: cachedInsights,
        cached: true, refreshPending: true,
      })
    }
    return NextResponse.json({
      success: true, paired: true, insights: publicInsights(result.insights),
      cached: false, resumed: true,
    })
  } catch (err) {
    console.error('[friends/insights] unexpected:', err?.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
