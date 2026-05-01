import { NextResponse } from 'next/server'
import { PRICING_TIERS } from '@/lib/constants'

export const runtime = 'edge'

// Airwallex configuration
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID
const AIRWALLEX_ENV = process.env.AIRWALLEX_ENV || 'prod' // 'demo' or 'prod'

const AIRWALLEX_BASE_URL = AIRWALLEX_ENV === 'prod'
  ? 'https://api.airwallex.com'
  : 'https://api-demo.airwallex.com'

export async function POST(request) {
  try {
    const { userId, userEmail, plan, billingCycle } = await request.json()

    if (!userId || !plan) {
      return NextResponse.json(
        { error: 'Missing userId or plan' },
        { status: 400 }
      )
    }

    // Get pricing info
    const tier = PRICING_TIERS[plan]
    if (!tier || plan === 'free') {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      )
    }

    const isYearly = billingCycle === 'yearly'
    const amount = isYearly ? tier.yearlyPrice : tier.monthlyPrice
    const currency = 'USD'

    // Step 1: Get Airwallex access token
    const tokenResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': AIRWALLEX_CLIENT_ID,
        'x-api-key': AIRWALLEX_API_KEY,
      },
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      console.error('Airwallex auth error:', error)
      return NextResponse.json(
        { error: 'Payment service authentication failed' },
        { status: 500 }
      )
    }

    const { token } = await tokenResponse.json()

    // Step 2: Create or get customer
    let customerId = null
    
    // Try to find existing customer by email
    if (userEmail) {
      const searchResponse = await fetch(
        `${AIRWALLEX_BASE_URL}/api/v1/pa/customers?email=${encodeURIComponent(userEmail)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (searchResponse.ok) {
        const { items } = await searchResponse.json()
        if (items && items.length > 0) {
          customerId = items[0].id
        }
      }
    }

    // Create new customer if not found
    if (!customerId) {
      const customerResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/customers/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          merchant_customer_id: userId,
          metadata: {
            user_id: userId,
          },
        }),
      })

      if (customerResponse.ok) {
        const customer = await customerResponse.json()
        customerId = customer.id
      }
    }

    // Step 3: Create Payment Intent
    const paymentIntentResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount,
        currency: currency,
        merchant_order_id: `${userId}-${plan}-${Date.now()}`,
        customer_id: customerId,
        metadata: {
          user_id: userId,
          plan: plan,
          billing_cycle: billingCycle,
        },
        request_id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/payment/success`,
      }),
    })

    if (!paymentIntentResponse.ok) {
      const error = await paymentIntentResponse.text()
      console.error('Airwallex payment intent error:', error)
      return NextResponse.json(
        { error: 'Failed to create payment session' },
        { status: 500 }
      )
    }

    const paymentIntent = await paymentIntentResponse.json()

    return NextResponse.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
      currency,
    })

  } catch (error) {
    console.error('Create payment error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
