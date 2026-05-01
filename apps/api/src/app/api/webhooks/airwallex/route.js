import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(request) {
  try {
    const body = await request.text()
    const event = JSON.parse(body)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Airwallex webhook event:', event.name, event.data?.object?.id)

    switch (event.name) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(supabase, event.data.object)
        break
      case 'payment_intent.failed':
        await handlePaymentFailed(supabase, event.data.object)
        break
      case 'subscription.created':
      case 'subscription.updated':
        await handleSubscriptionUpdate(supabase, event.data.object)
        break
      case 'subscription.cancelled':
      case 'subscription.expired':
        await handleSubscriptionEnd(supabase, event.data.object)
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function handlePaymentSuccess(supabase, paymentIntent) {
  const { metadata } = paymentIntent
  if (!metadata) return

  // ==========================================
  // 1. 处理电商订单 (智能分发表)
  // ==========================================
  if (metadata.original_order_id) {
    const orderId = metadata.original_order_id
    const orderType = metadata.order_type || metadata.product // 'printed', 'wisdom_cards', 'wisdom_book'
    const userId = metadata.user_id

    // 智能路由：根据 orderType 决定去更新哪张表
    if (orderType === 'printed' || orderType === 'ebook') {
      // 路由 A：WisdomBookOverlay 产生的订单 (写 book_orders 表)
      await supabase.from('book_orders').update({
        status: 'paid',
        payment_status: 'paid',
        payment_intent_id: paymentIntent.id,
        updated_at: new Date().toISOString()
      }).eq('id', orderId)

      // 扣除字数进度
      if (userId) {
        const { data: profile } = await supabase.from('profiles').select('total_minutes_recorded').eq('id', userId).single()
        if (profile) await supabase.from('profiles').update({ last_book_applied_minutes: profile.total_minutes_recorded }).eq('id', userId)
      }
      console.log(`[Webhook] Book Order ${orderId} marked as paid in book_orders`)
    } 
    else if (orderType === 'wisdom_cards' || orderType === 'wisdom_book') {
      // 路由 B：AssetsView 产生的订单 (写 orders 表)
      const nextStatus = (orderType === 'wisdom_cards') ? 'pending_selection' : 'paid'
      await supabase.from('orders').update({
        status: nextStatus,
        payment_intent_id: paymentIntent.id,
        updated_at: new Date().toISOString()
      }).eq('id', orderId)
      
      console.log(`[Webhook] Assets Order ${orderId} marked as ${nextStatus} in orders`)
    }
    return
  }

  // ==========================================
  // 2. 处理订阅 (Subscriptions)
  // ==========================================
  const userId = metadata.user_id
  const plan = metadata.plan
  if (userId && plan) {
    const isYearly = metadata.billing_cycle === 'yearly'
    const periodEnd = new Date()
    periodEnd.setMonth(periodEnd.getMonth() + (isYearly ? 12 : 1))

    await supabase.from('subscriptions').upsert({
      user_id: userId, plan: plan, status: 'active',
      billing_cycle: isYearly ? 'yearly' : 'monthly',
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    console.log(`[Webhook] Subscription activated for user ${userId}`)
  }
}

async function handlePaymentFailed(supabase, paymentIntent) {
  const userId = paymentIntent.metadata?.user_id
  if (userId && paymentIntent.metadata?.plan) {
    await supabase.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('user_id', userId)
  }
}

async function handleSubscriptionUpdate(supabase, subscription) {
  const userId = subscription.metadata?.user_id
  if (userId) {
    await supabase.from('subscriptions').upsert({
      user_id: userId, plan: subscription.metadata?.plan || 'premium',
      status: 'active', updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  }
}

async function handleSubscriptionEnd(supabase, subscription) {
  const userId = subscription.metadata?.user_id
  if (userId) {
    await supabase.from('subscriptions').update({ plan: 'free', status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId)
  }
}