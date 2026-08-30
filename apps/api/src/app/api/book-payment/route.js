import { NextResponse } from 'next/server'
import { secureRandomInt } from '@/lib/secure-random'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * Stage A: PRINTED_BOOK_PRICE / WISDOM_CARDS_PRICE / SHIPPING_FEE now
 * live in Supabase `app_config` and are editable via admin. Server
 * fetches the latest price for the relevant product on every request
 * to enforce the canonical charge amount — never trusts the mobile
 * client's `amount` parameter blindly (cache-staleness or tampering).
 *
 * Pricing-display policy (c): mobile force-refreshes /api/app-config
 * when entering the payment-stub screen, so the displayed price is
 * always the same as what the server will charge here. No diff-
 * detection needed in the response.
 */
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getServerPrice(product) {
  // product: 'wisdom_book' | 'wisdom_cards'
  const key = product === 'wisdom_cards' ? 'wisdom_cards_price' : 'printed_book_price'
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .single()
  if (error || !data) {
    // DB lookup failed -- fall back to safe hardcoded defaults so the
    // payment flow never completely breaks. Same numbers as the initial
    // app_config seed so behavior is continuous.
    console.warn('[book-payment] app_config fetch failed, using fallback:', error?.message)
    return product === 'wisdom_cards' ? 59.99 : 99.99
  }
  const parsed = parseFloat(data.value)
  return Number.isFinite(parsed) ? parsed : (product === 'wisdom_cards' ? 59.99 : 99.99)
}

const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID
const AIRWALLEX_ENV = process.env.AIRWALLEX_ENV || 'prod'
const AIRWALLEX_BASE_URL = AIRWALLEX_ENV === 'prod' ? 'https://api.airwallex.com' : 'https://api-demo.airwallex.com'

// === 新增：定义全局复用的跨域头对象 ===
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // 允许所有来源（包括 Capacitor 的 localhost）
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-id, x-api-key',
}

async function getAccessToken() {
  const res = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': AIRWALLEX_CLIENT_ID, 'x-api-key': AIRWALLEX_API_KEY },
  })
  if (!res.ok) throw new Error(`Airwallex auth failed: ${(await res.text()).substring(0, 200)}`)
  return (await res.json()).token
}

export async function POST(request) {
  try {
    const body = await request.json()
    const action = body.action || 'create'

    if (action === 'create') {
      const { userId, userEmail, amount, orderType, originalOrderId, product } = body
      // 修改：加上 headers: corsHeaders
      if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400, headers: corsHeaders })

      // ============================================================
      // SECURITY (Module 6 #6 Step 2 batch 5): require Bearer token
      // matching body.userId. Without this guard, an anon caller could
      // POST a paymentIntent creation with any userId, which means the
      // resulting Airwallex PaymentIntent metadata would carry that
      // target user as user_id -- and when the webhook fires it would
      // mutate the target user's order/profile state. Mobile attaches
      // the token via apiClient.post (airwallex-api.ts line 61);
      // payment-stub.tsx requires an active session before reaching
      // here, so the gate has zero impact on legitimate paths.
      //
      // Note: we shadow the outer `const token = await getAccessToken()`
      // (Airwallex access token, used several lines below) with a
      // separate `_authToken` to avoid name collision. Variable scope
      // is the same try-block.
      // ============================================================
      const _authHeader = request.headers.get('authorization') || ''
      const _authToken = _authHeader.replace(/^Bearer\s+/i, '').trim()
      if (!_authToken) {
        console.warn('[book-payment] rejected: no bearer token')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
      }
      const _authSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const _authUser = await verifyToken(_authToken); const _authErr = _authUser ? null : new Error('invalid token')
      if (_authErr || !_authUser) {
        console.warn('[book-payment] rejected: token verify failed', _authErr && _authErr.message)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
      }
      if (_authUser.id !== userId) {
        console.warn('[book-payment] rejected: token user', _authUser.id, '!= body userId', userId)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
      }

      const token = await getAccessToken()
      // Stage A: server-side price as source of truth. The mobile client
      // sends `product` ('wisdom_book' | 'wisdom_cards'); we look up
      // the canonical price from app_config and use that. The legacy
      // `amount` field from the client is ignored entirely.
      // Back-compat: when `product` is missing (old client builds before
      // the A3 mobile update), default to 'wisdom_book' to preserve the
      // pre-Stage-A behavior (former PRINTED_BOOK_PRICE constant default).
      const resolvedProduct = product === 'wisdom_cards' ? 'wisdom_cards' : 'wisdom_book'
      const paymentAmount = await getServerPrice(resolvedProduct)
      const currency = 'USD'

      let customerId = null
      if (userEmail) {
        try {
          const searchRes = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/customers?email=${encodeURIComponent(userEmail)}`, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } })
          if (searchRes.ok) { const { items } = await searchRes.json(); if (items?.length > 0) customerId = items[0].id }
        } catch (e) { console.warn('Customer search failed:', e.message) }
      }

      if (!customerId) {
        try {
          const customerRes = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/customers/create`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail || `${userId}@app.local`, merchant_customer_id: userId, request_id: `cust-${Date.now()}-${crypto.randomUUID()}`, metadata: { user_id: userId } }),
          })
          if (customerRes.ok) customerId = (await customerRes.json()).id
        } catch (e) { console.warn('Customer create failed:', e.message) }
      }

      const safeAmount = Math.round(paymentAmount * 100) / 100;
      const safeOrderId = `${Date.now()}${String(secureRandomInt(100)).padStart(2, '0')}`;

      const piBody = {
        amount: safeAmount, 
        currency,
        merchant_order_id: safeOrderId,
        request_id: `req-${safeOrderId}`,
        metadata: { user_id: userId, order_type: orderType || 'printed_book', original_order_id: originalOrderId || null, product: resolvedProduct },
      }
      
      if (customerId) piBody.customer_id = customerId

      const piRes = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(piBody),
      })
      
      // 修改：加上 headers: corsHeaders
      if (!piRes.ok) { 
        const errText = await piRes.text(); 
        return NextResponse.json({ error: `Payment intent failed: ${errText.substring(0, 300)}` }, { status: 500, headers: corsHeaders }) 
      }

      const pi = await piRes.json()
      
      // 修改：加上 headers: corsHeaders
      // Stage A: chosen pricing-display policy is (c) -- mobile force-
      // refreshes app-config when entering the payment-stub screen, so
      // mobile-displayed price and server-charged price are guaranteed
      // to match. No diff-detection fields needed in this response.
      return NextResponse.json(
        {
          success: true,
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
          amount: safeAmount,
          currency,
        },
        { headers: corsHeaders }
      )
    }

    // 修改：加上 headers: corsHeaders
    return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders })
  } catch (error) {
    console.error('Book payment error:', error)
    // 修改：加上 headers: corsHeaders
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500, headers: corsHeaders })
  }
}

// === 处理浏览器的 CORS 预检请求 (Preflight) ===
export async function OPTIONS(request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders, // 直接复用上面定义的跨域头
  })
}
