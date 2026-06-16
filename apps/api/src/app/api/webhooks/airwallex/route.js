import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// ============================================================
// SECURITY (A3): Airwallex webhook signature verification.
// Airwallex signs each webhook with HMAC-SHA256 over
// `${x-timestamp}${raw body}`, keyed by this subscription's secret
// (AIRWALLEX_WEBHOOK_SECRET), hex-encoded, in the `x-signature` header.
// We verify BEFORE parsing (a parsed+reserialized body changes bytes and
// breaks the signature). Edge runtime has no Node `crypto`, so we use
// Web Crypto (crypto.subtle), same pattern as the iap routes.
//
// Fail-closed: missing secret / missing header / mismatch -> caller
// returns 401 (Airwallex retries; harmless for a forgery, and the only
// DB side effect here -- marking an order paid -- is idempotent).
//
// Timestamp freshness is LOG-ONLY, never a rejection: Airwallex RETRIES
// failed deliveries and a legit retry can arrive long after the original,
// so rejecting on age would drop valid retries. The HMAC is the gate;
// replay of a validly-signed event is harmless (mark-paid is idempotent).
// x-timestamp unit is not pinned in the docs, so we detect by magnitude
// (>=1e12 = ms else seconds) for the log only.
// ============================================================
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  const bytes = new Uint8Array(sigBuf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifyAirwallexSignature(request, rawBody) {
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET
  if (!secret) return 'AIRWALLEX_WEBHOOK_SECRET not configured'
  const timestamp = request.headers.get('x-timestamp')
  const signature = request.headers.get('x-signature')
  if (!timestamp || !signature) return 'missing x-timestamp or x-signature'
  const expected = await hmacSha256Hex(secret, `${timestamp}${rawBody}`)
  if (!timingSafeEqualHex(expected, signature.trim().toLowerCase())) return 'signature mismatch'
  const tsNum = Number(timestamp)
  if (Number.isFinite(tsNum)) {
    const tsMs = tsNum >= 1e12 ? tsNum : tsNum * 1000
    const ageMs = Date.now() - tsMs
    if (ageMs > 300000 || ageMs < -300000) {
      console.warn(`[Airwallex webhook] signature OK but timestamp age ${Math.round(ageMs / 1000)}s outside +/-5min (retry or clock skew; not rejected)`)
    }
  }
  return null
}

export async function POST(request) {
  try {
    const body = await request.text()

    // SECURITY (A3): verify Airwallex signature BEFORE parsing. Fail-closed.
    const sigError = await verifyAirwallexSignature(request, body)
    if (sigError) {
      console.warn('[Airwallex webhook] rejected:', sigError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      // P2-b① idempotency: a retried/duplicate succeeded event must not
      // re-apply the word-progress deduction below. Skip if already paid.
      const { data: existingBook } = await supabase.from('book_orders').select('status').eq('id', orderId).single()
      if (existingBook?.status === 'paid') {
        console.log(`[Webhook] Book Order ${orderId} already paid — skipping (idempotent)`)
        return
      }
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
      // P2-b① only-advance: a retried/out-of-order succeeded event must not
      // reset an order that already moved past pending_payment (e.g. the user
      // already selected cards -> 'paid'). Only advance the initial
      // pending_payment order; otherwise skip.
      const { data: existingOrder } = await supabase.from('orders').select('status').eq('id', orderId).single()
      if (existingOrder && existingOrder.status !== 'pending_payment') {
        console.log(`[Webhook] Assets Order ${orderId} already advanced (status=${existingOrder.status}) — skipping`)
        return
      }
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
}

async function handlePaymentFailed(supabase, paymentIntent) {
  const userId = paymentIntent.metadata?.user_id
  if (userId && paymentIntent.metadata?.plan) {
    await supabase.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('user_id', userId)
  }
}