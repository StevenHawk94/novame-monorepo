import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * GET /api/card-saves?userId=xxx — Get user's saved cards + quota info
 * POST /api/card-saves — Save a card (checks quota)
 * DELETE /api/card-saves — Unsave a card
 */

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    // Get saved cards with card details
    const { data: saves } = await supabase
      .from('card_saves')
      .select('*, wisdom_cards(*, card_keywords(keyword, category, front_image, back_image))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    // Get quota: total created cards by user
    const { count: createdCount } = await supabase
      .from('wisdom_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    // Get total saved count
    const { count: savedCount } = await supabase
      .from('card_saves')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    const availableQuota = Math.max(0, (createdCount || 0) - (savedCount || 0))

    return NextResponse.json({
      success: true,
      saves: saves || [],
      quota: {
        created: createdCount || 0,
        saved: savedCount || 0,
        available: availableQuota,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { userId, cardId } = await request.json()
    if (!userId || !cardId) return NextResponse.json({ error: 'Missing userId or cardId' }, { status: 400 })

    const supabase = getSupabase()

    // Check quota
    const { count: createdCount } = await supabase
      .from('wisdom_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    const { count: savedCount } = await supabase
      .from('card_saves')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if ((savedCount || 0) >= (createdCount || 0)) {
      return NextResponse.json({
        success: false,
        error: 'Save quota exceeded. Create more wisdom cards to save others\' cards!',
        quota: { created: createdCount || 0, saved: savedCount || 0, available: 0 },
      }, { status: 403 })
    }

    // Check not saving own card
    const { data: card } = await supabase
      .from('wisdom_cards')
      .select('user_id')
      .eq('id', cardId)
      .single()

    if (card?.user_id === userId) {
      return NextResponse.json({ success: false, error: 'Cannot save your own card' }, { status: 400 })
    }

    // Save
    const { error } = await supabase
      .from('card_saves')
      .insert({ user_id: userId, card_id: cardId })

    if (error?.code === '23505') {
      return NextResponse.json({ success: false, error: 'Already saved' }, { status: 409 })
    }
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { userId, cardId } = await request.json()
    if (!userId || !cardId) return NextResponse.json({ error: 'Missing userId or cardId' }, { status: 400 })

    const supabase = getSupabase()
    await supabase.from('card_saves').delete().eq('user_id', userId).eq('card_id', cardId)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
