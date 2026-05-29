import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/**
 * GET /api/ai-consent?userId=xxx
 *
 * Returns: { success: true, aiConsentAt: string|null }
 *
 * aiConsentAt is the ISO timestamp of when the user agreed to AI
 * processing via the in-app consent modal. NULL means the user has
 * NOT yet agreed (or the row was created before this feature shipped).
 *
 * The mobile client typically does NOT call this directly -- it reads
 * aiConsentAt from the character-state GET response, which already
 * fetches profiles. This standalone endpoint exists for cases where
 * the client needs to recheck consent without paying the cost of the
 * full character-state computation (e.g. before kicking off a record
 * session on a stale cache).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[ai-consent GET] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[ai-consent GET] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[ai-consent GET] rejected: token user', _authUser.id, '!= userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('profiles')
      .select('ai_consent_at')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('GET ai-consent error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      aiConsentAt: data?.ai_consent_at ?? null,
    })
  } catch (error) {
    console.error('GET ai-consent caught:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/ai-consent
 * Body: { userId: string }
 *
 * Marks the user as having consented to AI processing. Sets
 * profiles.ai_consent_at to NOW() if it was previously NULL.
 * Idempotent: re-calling on an already-consented profile is a no-op
 * (we do NOT overwrite the original timestamp -- preserving the
 * audit-trail moment the user first agreed).
 *
 * Returns: { success: true, aiConsentAt: string }
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { userId } = body
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[ai-consent POST] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[ai-consent POST] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[ai-consent POST] rejected: token user', _authUser.id, '!= userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()

    // Read current state first so we can preserve an existing timestamp.
    const { data: existing, error: readErr } = await supabase
      .from('profiles')
      .select('ai_consent_at')
      .eq('id', userId)
      .single()

    if (readErr) {
      console.error('POST ai-consent read error:', readErr)
      return NextResponse.json({ error: readErr.message }, { status: 500 })
    }

    if (existing?.ai_consent_at) {
      // Already consented previously -- idempotent return.
      return NextResponse.json({
        success: true,
        aiConsentAt: existing.ai_consent_at,
      })
    }

    const now = new Date().toISOString()
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ ai_consent_at: now })
      .eq('id', userId)

    if (updateErr) {
      console.error('POST ai-consent update error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, aiConsentAt: now })
  } catch (error) {
    console.error('POST ai-consent caught:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
