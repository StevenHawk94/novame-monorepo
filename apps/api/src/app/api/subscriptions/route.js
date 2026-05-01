import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/**
 * GET /api/subscriptions?userId=xxx
 * Returns current subscription info + billing history for display in Plan & Billing
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    // Get current subscription row
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!sub) return NextResponse.json({ history: [], subscription: null })

    // Build billing history from subscription data
    const history = []

    if (sub.plan && sub.plan !== 'free' && sub.current_period_start) {
      const PLAN_NAMES = { basic: 'Basic', pro: 'Pro', ultra: 'Ultra' }
      const PLAN_PRICES = {
        'basic_monthly': 4.99, 'basic_yearly': 39.99,
        'pro_monthly': 9.99,   'pro_yearly': 79.99,
        'ultra_monthly': 16.99,'ultra_yearly': 129.99,
      }
      const priceKey = `${sub.plan}_${sub.billing_cycle || 'monthly'}`
      const price = PLAN_PRICES[priceKey] || 0

      history.push({
        id: sub.apple_transaction_id || sub.id || Date.now(),
        date: new Date(sub.current_period_start).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric'
        }),
        plan: `${PLAN_NAMES[sub.plan] || sub.plan} (${sub.billing_cycle === 'yearly' ? 'Annual' : 'Monthly'})`,
        amount: `$${price.toFixed(2)}`,
        status: sub.status === 'active' ? 'Paid' : sub.status,
      })
    }

    return NextResponse.json({
      success: true,
      subscription: sub,
      history,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
