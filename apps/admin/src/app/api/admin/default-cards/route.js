import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Admin Default Cards API
 *
 * GET: List all default cards (user_id IS NULL)
 * POST: Add single or bulk default cards
 * DELETE: Remove a default card (accepts { id } in request body OR ?id= query param)
 */

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data, error } = await supabase
      .from('wisdom_cards')
      .select('*')
      .is('user_id', null)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ success: true, cards: data || [] })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Bulk upload: array of cards
    if (body.cards && Array.isArray(body.cards)) {
      const rows = body.cards.map(c => ({
        wisdom_id: null,
        user_id: null,
        keyword_id: c.keyword_id || null,
        quote_short: c.quote_short || '',
        insight_full: c.insight_full || '',
        card_a: c.card_text || c.card_a || c.quote_short || '',
        card_b: c.card_b || '',
        card_c: c.card_c || '',
        card_number: null,
        likes: 0,
        saves_count: 0,
        creator_name: c.creator_name || c.user_name || 'Default User',
        creator_avatar: c.creator_avatar || null,
      }))

      const { data, error } = await supabase
        .from('wisdom_cards')
        .insert(rows)
        .select()

      if (error) throw error

      return NextResponse.json({ success: true, count: data?.length || 0 })
    }

    // Single card
    const { data, error } = await supabase
      .from('wisdom_cards')
      .insert({
        wisdom_id: null,
        user_id: null,
        keyword_id: body.keyword_id || null,
        quote_short: body.quote_short || '',
        insight_full: body.insight_full || '',
        card_a: body.card_text || body.card_a || body.quote_short || '',
        card_b: body.card_b || '',
        card_c: body.card_c || '',
        card_number: null,
        likes: 0,
        saves_count: 0,
        creator_name: body.creator_name || body.user_name || 'Default User',
        creator_avatar: body.creator_avatar || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, card: data })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Accept id from request body (admin UI sends JSON body)
    // or fall back to query param for backwards compat
    let id
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await request.json()
      id = body.id
    } else {
      const { searchParams } = new URL(request.url)
      id = searchParams.get('id')
    }

    if (!id) return NextResponse.json({ success: false, error: 'Missing id' })

    const { error } = await supabase
      .from('wisdom_cards')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
