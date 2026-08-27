import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { MAX_REFLECT_ITEMS } from '@novame/engine'
import { serviceClient } from '@/lib/reflect-draft'
import { sanitizeSettlementMemories } from '@/lib/reflect-settlement'

export const runtime = 'edge'
async function owner(request) {
  return verifyToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
}

export async function GET(request) {
  const user = await owner(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await serviceClient().from('reflect_drafts')
    .select('id, saved_reflect_id, settlement_revision, settlement_memories, local_date')
    .eq('user_id', user.id).not('saved_reflect_id', 'is', null).is('finalized_reflect_id', null)
    .order('created_at').limit(50)
  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  return NextResponse.json({ success: true, pending: data || [] })
}

export async function POST(request) {
  try {
    const user = await owner(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await request.json()
    if (input.userId !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!Array.isArray(input.memories) || input.memories.length > MAX_REFLECT_ITEMS
      || !Number.isSafeInteger(input.revision) || input.revision < 1) {
      return NextResponse.json({ error: 'invalid_checkpoint' }, { status: 400 })
    }
    const { data, error } = await serviceClient().rpc('checkpoint_reflect_settlement', {
      p_user_id: user.id, p_draft_id: input.draftId,
      p_memories: sanitizeSettlementMemories(input.memories), p_revision: input.revision,
    })
    if (error || data?.error) return NextResponse.json({ error: data?.error || 'checkpoint_failed' }, { status: 500 })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'checkpoint_failed' }, { status: 500 })
  }
}
