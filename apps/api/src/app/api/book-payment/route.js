import { NextResponse } from 'next/server'
import { PRINTED_BOOK_PRICE } from '@/lib/constants'

export const runtime = 'edge'

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
      const { userId, userEmail, amount, orderType, originalOrderId } = body
      // 修改：加上 headers: corsHeaders
      if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400, headers: corsHeaders })

      const token = await getAccessToken()
      const paymentAmount = amount || PRINTED_BOOK_PRICE
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
            body: JSON.stringify({ email: userEmail || `${userId}@app.local`, merchant_customer_id: userId, request_id: `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, metadata: { user_id: userId } }),
          })
          if (customerRes.ok) customerId = (await customerRes.json()).id
        } catch (e) { console.warn('Customer create failed:', e.message) }
      }

      const safeAmount = Math.round(paymentAmount * 100) / 100;
      const safeOrderId = `${Date.now()}${Math.floor(Math.random() * 100)}`.padEnd(15, '0');

      const piBody = {
        amount: safeAmount, 
        currency,
        merchant_order_id: safeOrderId,
        request_id: `req-${safeOrderId}`,
        metadata: { user_id: userId, order_type: orderType || 'printed_book', original_order_id: originalOrderId || null, product: 'wisdom_book' },
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
      return NextResponse.json(
        { success: true, clientSecret: pi.client_secret, paymentIntentId: pi.id, amount: safeAmount, currency }, 
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