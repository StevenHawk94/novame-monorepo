import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const VALID_COMPANIONS = ['pet1', 'pet2', 'pet3']

/**
 * POST /api/onboarding-complete
 *
 * Body: { userId, companionId }
 *
 * Ends onboarding: creates the companion the user picked before signing up
 * (chosen locally, synced here on first sign-in) and stamps the profile. Wraps
 * complete_onboarding, which is idempotent -- a retried sync creates nothing
 * new -- so this is safe to call on every sign-in; it no-ops once done.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, companionId } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!VALID_COMPANIONS.includes(companionId)) {
      return NextResponse.json({ error: 'Invalid companionId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data, error } = await supabase.rpc('complete_onboarding', {
      p_user_id: userId,
      p_companion_id: companionId,
    })
    if (error) {
      console.error('[onboarding-complete] rpc error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, ...data })
  } catch (err) {
    console.error('[onboarding-complete] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
