import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'
import { resolveUserLocalDate } from '@/lib/user-local-date'

export const runtime = 'edge'

const JOURNAL_KINDS = ['write_freely', 'tap_your_day', 'remember_together']

export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = new URL(request.url).searchParams.get('userId')
    if (!userId || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = serviceClient()
    const localDate = await resolveUserLocalDate(supabase, userId)
    const [
      { data: slots, error: slotError },
      { count, error: countError },
      { data: profile, error: profileError },
      { count: plusAiUsed, error: allowanceError },
    ] = await Promise.all([
      supabase.from('daily_journal_slots')
        .select('journal_kind,status,draft_id,reflect_id')
        .eq('user_id', userId).eq('local_date', localDate),
      supabase.from('reflects').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('local_date', localDate),
      supabase.from('profiles').select('subscription_tier').eq('id', userId).maybeSingle(),
      supabase.from('plus_journal_ai_credits').select('reflect_id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('local_date', localDate),
    ])
    if (slotError || countError || profileError || allowanceError) {
      throw slotError || countError || profileError || allowanceError
    }
    const isPaid = (profile?.subscription_tier || 'free') !== 'free'
    const byKind = Object.fromEntries(JOURNAL_KINDS.map((kind) => [kind, 'available']))
    for (const slot of slots || []) {
      if (JOURNAL_KINDS.includes(slot.journal_kind)) byKind[slot.journal_kind] = slot.status
    }
    if (isPaid) byKind.write_freely = 'available'
    return NextResponse.json({
      success: true,
      localDate,
      reflectsToday: count || 0,
      reflectsRemaining: Math.max(0, 3 - (count || 0)),
      plusAiRemaining: isPaid ? Math.max(0, 2 - (plusAiUsed || 0)) : 0,
      entries: byKind,
    })
  } catch (error) {
    console.error('[reflect/status] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
