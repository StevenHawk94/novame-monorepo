import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'

export const runtime = 'edge'

async function authenticate(request, userId) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const verified = await verifyToken(token)
  return !!verified && verified.id === userId
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const reflectId = searchParams.get('reflectId')
    if (!userId || !reflectId) return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    if (!(await authenticate(request, userId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = serviceClient()
    const { data: reflect } = await supabase.from('reflects')
      .select('id, shared_with_user_id').eq('id', reflectId).eq('user_id', userId).maybeSingle()
    if (!reflect) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [{ data: matched }, { data: memories }] = await Promise.all([
      supabase.from('reflect_items')
        .select('item_id, position, source_excerpt, visible_to_paired, items(display_name)')
        .eq('reflect_id', reflectId).eq('user_id', userId).order('position'),
      supabase.from('item_memories')
        .select('item_id, description, raw_excerpt, refined_desc, memory_source')
        .eq('reflect_id', reflectId).eq('user_id', userId),
    ])
    const memoryByItem = new Map((memories || []).map((memory) => [memory.item_id, memory]))
    return NextResponse.json({
      success: true,
      shared: !!reflect.shared_with_user_id,
      items: (matched || []).map((item) => {
        const memory = memoryByItem.get(item.item_id)
        return {
          itemId: item.item_id,
          displayName: item.items?.display_name || item.item_id,
          sourceExcerpt: item.source_excerpt || '',
          text: memory?.description || memory?.refined_desc || memory?.raw_excerpt || '',
          source: memory?.memory_source || 'manual',
          visible: item.visible_to_paired !== false,
        }
      }),
    })
  } catch (error) {
    console.error('[reflect/edit-memories] GET unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const input = await request.json()
    if (!(await authenticate(request, input.userId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!input.reflectId || !Array.isArray(input.edits)) {
      return NextResponse.json({ error: 'Missing reflectId or edits' }, { status: 400 })
    }
    const supabase = serviceClient()
    const edits = input.edits.slice(0, 100).map((edit) => ({
      itemId: typeof edit?.itemId === 'string' ? edit.itemId : '',
      text: typeof edit?.text === 'string' ? edit.text.trim().slice(0, 500) : '',
      source: ['manual', 'ai', 'use_my_words'].includes(edit?.source) ? edit.source : 'manual',
      visible: edit?.visible !== false,
    })).filter((edit) => edit.itemId)
    const { data: result, error } = await supabase.rpc('edit_reflect_item_memories', {
      p_user_id: input.userId,
      p_reflect_id: input.reflectId,
      p_edits: edits,
    })
    if (error) {
      console.error('[reflect/edit-memories] rpc:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (result?.error) return NextResponse.json(result, { status: 404 })
    await Promise.all([
      supabase.rpc('broadcast_reflect_feed_change', { p_user_id: input.userId }),
      result?.shared && Number(result?.shared_rows || 0) === 0
        ? supabase.rpc('broadcast_shared_box_change', { p_user_id: input.userId })
        : Promise.resolve(),
    ])
    return NextResponse.json({ success: true, updated: result?.updated || 0 })
  } catch (error) {
    console.error('[reflect/edit-memories] POST unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
