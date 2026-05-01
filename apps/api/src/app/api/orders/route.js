import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * POST: Create a new order
 */
export async function POST(request) {
  try {
    const body = await request.json()
    // 新增：接收前端传来的 status (用于支持 pending_payment)
    const { userId, productType, amount, shipping, paymentIntentId, selectedCardIds, status } = body

    if (!userId || !productType || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = getSupabase()
    const { data: profile } = await supabase.from('profiles').select('display_name, email').eq('id', userId).single()

    const { data: order, error } = await supabase.from('orders').insert({
      user_id: userId,
      product_type: productType,
      // 修改：如果前端传了 status 就用前端的，否则默认
      status: status || (productType === 'wisdom_cards' ? 'pending_selection' : 'paid'),
      amount: parseFloat(amount),
      currency: 'USD',
      payment_intent_id: paymentIntentId || null,
      customer_name: profile?.display_name || '',
      customer_email: profile?.email || '',
      shipping_name: shipping?.name || '',
      shipping_address: shipping?.address || '',
      shipping_city: shipping?.city || '',
      shipping_state: shipping?.state || '',
      shipping_zip: shipping?.zip || '',
      shipping_country: shipping?.country || 'US',
      shipping_phone: shipping?.phone || '',
      selected_card_ids: selectedCardIds || null,
    }).select().single()

    if (error) {
      console.error('Order creation error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, order })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * GET: Fetch orders (admin or user-specific)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const status = searchParams.get('status')
    const orderId = searchParams.get('orderId')
    const download = searchParams.get('download')

    const supabase = getSupabase()

    if (orderId && download) {
      const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single()
      if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

      if (download === 'book') {
        const { data: wisdoms } = await supabase.from('wisdoms')
          .select('*, wisdom_cards(keyword_id, quote_short, insight_full, card_b, card_c, wisdom_score)')
          .eq('user_id', order.user_id)
          .order('created_at', { ascending: true })

        return NextResponse.json({
          success: true, type: 'book', customerName: order.customer_name,
          wisdoms: (wisdoms || []).map(w => ({ text: w.text, created_at: w.created_at, card: w.wisdom_cards?.[0] || null })),
        })
      }

      if (download === 'cards') {
        const cardIds = order.selected_card_ids || []
        if (cardIds.length === 0) return NextResponse.json({ success: true, type: 'cards', cards: [] })
        const { data: cards } = await supabase.from('wisdom_cards').select('keyword_id, quote_short, insight_full').in('id', cardIds)
        return NextResponse.json({ success: true, type: 'cards', customerName: order.customer_name, cards: cards || [] })
      }
    }

    let query = supabase.from('orders').select('*').order('created_at', { ascending: false })
    if (userId) query = query.eq('user_id', userId)
    if (status && status !== 'all') query = query.eq('status', status)

    const { data: orders, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, orders: orders || [] })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH: Update order status
 */
export async function PATCH(request) {
  try {
    const body = await request.json()
    // 新增：接收 paymentIntentId
    const { orderId, status, trackingNumber, notes, selectedCardIds, paymentIntentId } = body

    if (!orderId || !status) return NextResponse.json({ error: 'Missing orderId or status' }, { status: 400 })

    // 修改：将 pending_payment 加入合法白名单
    const validStatuses = ['pending_payment', 'pending_selection', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']
    if (!validStatuses.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

    const supabase = getSupabase()
    const updates = { status, updated_at: new Date().toISOString() }
    
    if (trackingNumber) updates.tracking_number = trackingNumber
    if (notes) updates.notes = notes
    if (selectedCardIds) updates.selected_card_ids = selectedCardIds
    if (paymentIntentId) updates.payment_intent_id = paymentIntentId // 新增：保存支付单号
    if (status === 'shipped') updates.shipped_at = new Date().toISOString()
    if (status === 'delivered') updates.delivered_at = new Date().toISOString()

    const { data, error } = await supabase.from('orders').update(updates).eq('id', orderId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, order: data })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}