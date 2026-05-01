import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function POST(request) {
  try {
    const body = await request.json()
    const {
      userId, userEmail, userName, orderType, totalMinutes, wisdomCount,
      shippingInfo, amount, paymentStatus, paymentIntentId, originalOrderId,
      status, // 新增：接收前端传来的整体订单状态
      resetProgress = true,
    } = body

    if (!userId || !orderType) return Response.json({ error: 'Missing required fields' }, { status: 400 })

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: profile } = await supabase.from('profiles').select('total_minutes_recorded, last_book_applied_minutes').eq('id', userId).single()
    const currentTotalMinutes = profile?.total_minutes_recorded || totalMinutes || 0

    const orderData = {
      user_id: userId, user_email: userEmail, user_name: userName, order_type: orderType,
      total_minutes: totalMinutes, wisdom_count: wisdomCount, amount: amount || 0,
      payment_status: paymentStatus || (orderType === 'ebook' ? 'free' : 'pending'),
      status: status || 'pending', // 默认或者使用前端传来的 pending_payment
      shipping_info: shippingInfo || null, original_order_id: originalOrderId || null,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.from('book_orders').insert(orderData).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (resetProgress) {
      await supabase.from('profiles').update({ last_book_applied_minutes: currentTotalMinutes, updated_at: new Date().toISOString() }).eq('id', userId)
    }
    return Response.json({ success: true, order: data, progressReset: resetProgress })
  } catch (error) { return Response.json({ error: 'Internal server error' }, { status: 500 }) }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId'), status = searchParams.get('status')
    const orderType = searchParams.get('orderType'), limit = parseInt(searchParams.get('limit') || '50')

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    let query = supabase.from('book_orders').select('*').order('created_at', { ascending: false }).limit(limit)
    if (userId) query = query.eq('user_id', userId)
    if (status && status !== 'all') query = query.eq('status', status)
    if (orderType && orderType !== 'all') query = query.eq('order_type', orderType)

    const { data, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (userId) {
      const activeStatuses = ['pending', 'processing', 'shipped', 'pending_selection']
      const activeOrder = data?.find(o => activeStatuses.includes(o.status)) || null
      return Response.json({ success: true, activeOrder, historyOrders: data || [], orders: data })
    }
    return Response.json({ success: true, orders: data })
  } catch (error) { return Response.json({ error: 'Internal server error' }, { status: 500 }) }
}

export async function PATCH(request) {
  try {
    const body = await request.json()
    // 新增：支持 paymentStatus, paymentIntentId, resetProgress
    const { orderId, status, trackingNumber, downloadUrl, notes, paymentStatus, paymentIntentId, resetProgress } = body

    if (!orderId) return Response.json({ error: 'Order ID is required' }, { status: 400 })

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const updateData = { updated_at: new Date().toISOString() }

    if (status) updateData.status = status
    if (trackingNumber !== undefined) updateData.tracking_number = trackingNumber
    if (downloadUrl !== undefined) updateData.download_url = downloadUrl
    if (notes !== undefined) updateData.notes = notes
    if (paymentStatus) updateData.payment_status = paymentStatus
    if (paymentIntentId) updateData.payment_intent_id = paymentIntentId

    // 1. 更新订单表
    const { data, error } = await supabase.from('book_orders').update(updateData).eq('id', orderId).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // 2. 如果要求重置进度（支付成功时），更新用户里程碑
    if (resetProgress && data.user_id) {
       const { data: profile } = await supabase.from('profiles').select('total_minutes_recorded').eq('id', data.user_id).single()
       if (profile) {
         await supabase.from('profiles').update({ last_book_applied_minutes: profile.total_minutes_recorded }).eq('id', data.user_id)
       }
    }

    return Response.json({ success: true, order: data })
  } catch (error) { return Response.json({ error: 'Internal server error' }, { status: 500 }) }
}