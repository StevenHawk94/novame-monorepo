import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// SECURITY (audit follow-up): resolve the caller's Supabase identity from the
// Authorization: Bearer <jwt> header. /api/orders is dual-mode -- the admin web
// (token in ADMIN_USER_IDS) manages all orders, while mobile users (orders-api.ts)
// read/create/patch only their own. Returns { user, isAdmin } on success, or an
// { error: NextResponse } (401) the caller returns immediately on missing/invalid token.
async function resolveAuth(request, supabase) {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return { user: null, isAdmin: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return { user: null, isAdmin: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  return { user, isAdmin: adminIds.includes(user.id), error: null }
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

    const auth = await resolveAuth(request, supabase)
    if (auth.error) return auth.error
    if (!auth.isAdmin && auth.user.id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: profile } = await supabase.from('profiles').select('display_name, email').eq('id', userId).single()

    // SECURITY (#1 payment-bypass fix): a non-admin caller must NEVER create
    // an order already in a paid/fulfilled state. Reaching 'paid' is driven
    // only by the verified Airwallex webhook or an admin. Non-admins are
    // forced to 'pending_payment' regardless of the status they POST. Admins
    // keep the prior behavior (honor client status, else product default).
    const effectiveStatus = auth.isAdmin
      ? (status || (productType === 'wisdom_cards' ? 'pending_selection' : 'paid'))
      : 'pending_payment'

    const { data: order, error } = await supabase.from('orders').insert({
      user_id: userId,
      product_type: productType,
      status: effectiveStatus,
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

    const auth = await resolveAuth(request, supabase)
    if (auth.error) return auth.error
    const { user, isAdmin } = auth

    if (orderId && download) {
      const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single()
      if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      if (!isAdmin && order.user_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

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

    if (!isAdmin && userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    const auth = await resolveAuth(request, supabase)
    if (auth.error) return auth.error
    if (!auth.isAdmin) {
      const { data: existing } = await supabase.from('orders').select('user_id, status').eq('id', orderId).single()
      if (!existing || existing.user_id !== auth.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // SECURITY (#1 payment-bypass fix): non-admin status transitions are
      // tightly whitelisted. Reaching 'paid' is legitimate ONLY as the
      // cards-select finalization (pending_selection -> paid WITH
      // selectedCardIds); 'pending_selection' is set exclusively by the
      // verified Airwallex webhook, so a row in that state proves payment
      // cleared. The only other allowed non-admin write is payment-stub
      // attaching its paymentIntentId to its own still-pending order (status
      // unchanged). Everything else (pending_payment -> paid bypass, ->
      // pending_selection, -> processing/shipped/delivered/cancelled/refunded)
      // is admin/webhook-only.
      const cur = existing.status
      const isCardsFinalize =
        cur === 'pending_selection' &&
        status === 'paid' &&
        Array.isArray(selectedCardIds) &&
        selectedCardIds.length > 0
      const isPendingIntentAttach =
        cur === 'pending_payment' &&
        status === 'pending_payment'
      if (!isCardsFinalize && !isPendingIntentAttach) {
        console.warn('[orders] PATCH rejected: non-admin illegal transition', cur, '->', status, 'order', orderId)
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

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