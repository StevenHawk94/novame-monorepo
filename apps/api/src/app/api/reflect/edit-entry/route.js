import { NextResponse } from 'next/server'

import { verifyToken } from '@/lib/auth-guard'
import { MAX_BODY_CHARS, serviceClient } from '@/lib/reflect-draft'

export const runtime = 'edge'

function statusFor(error) {
  if (error === 'not_found') return 404
  if (error === 'empty' || error === 'invalid_body' || error === 'too_long') return 400
  return 500
}

/**
 * Editing a published Journal changes its written body only. Icons, Memories,
 * Item Learning evidence and Connection cards are immutable products of the
 * original save; users manage their visibility through the Memory editor.
 * Keeping this route AI-free also makes repeated text corrections cost-free.
 */
export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await request.json()
    if (verified.id !== input.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (typeof input.reflectId !== 'string' || typeof input.body !== 'string') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const body = input.body.trim()
    if (body.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'too_long' }, { status: 400 })
    }

    const supabase = serviceClient()
    const { data: result, error: editError } = await supabase.rpc('edit_journal_body', {
      p_user_id: input.userId,
      p_reflect_id: input.reflectId,
      p_body: body,
    })
    if (editError) {
      console.error('[reflect/edit-entry] rpc:', editError.message)
      return NextResponse.json({ error: 'edit_failed' }, { status: 500 })
    }
    if (!result) return NextResponse.json({ error: 'edit_failed' }, { status: 500 })
    if (result.error) {
      return NextResponse.json(result, { status: statusFor(result.error) })
    }

    await supabase.rpc('broadcast_reflect_feed_change', { p_user_id: input.userId })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[reflect/edit-entry] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'edit_failed' }, { status: 500 })
  }
}
