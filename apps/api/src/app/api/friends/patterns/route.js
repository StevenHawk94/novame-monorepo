import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { loadWeeklyContext, weeklyResponse } from '@/lib/weekly-recap'

export const runtime = 'edge'
export async function GET(request) {
  try {
    const verified = await verifyToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
    const userId = new URL(request.url).searchParams.get('userId')
    if (!verified || verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: viewer } = await supabase.from('profiles').select('subscription_tier, ai_consent_at').eq('id', userId).maybeSingle()
    if ((viewer?.subscription_tier || 'free') === 'free') return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    if (!viewer?.ai_consent_at) return NextResponse.json({ error: 'consent_required' }, { status: 403 })
    return NextResponse.json(weeklyResponse(await loadWeeklyContext(supabase, userId)))
  } catch (err) {
    console.error('[friends/patterns]', err?.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
