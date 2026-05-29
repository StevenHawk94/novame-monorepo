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

    // ============================================================
    // SECURITY (Module 6 #6 Step 1): require Bearer token matching
    // ?userId. subscriptions GET returns the user's full billing row
    // (plan, status, period dates, Airwallex/Google/Apple identifiers).
    // Without this guard, any anon caller knowing a user UUID could
    // read another user's billing history. No live mobile caller as
    // of this commit (Plan & Billing modal in mobile uses a stub
    // Alert; real history lands in a future stage), but adding the
    // guard preserves the route for when that feature is wired up.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[subscriptions] GET rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authUser) {
      console.warn('[subscriptions] GET rejected: token verify failed', authErr && authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[subscriptions] GET rejected: token user', authUser.id, '!= query userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
