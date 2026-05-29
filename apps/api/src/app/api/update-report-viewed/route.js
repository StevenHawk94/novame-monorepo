import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

/**
 * POST: 更新用户最后查看报告的时间
 */
export async function POST(request) {
  try {
    const { userId } = await request.json()
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // Note: this file uses Response.json (not NextResponse).
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[update-report-viewed] rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[update-report-viewed] rejected: token verify failed', _authErr && _authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[update-report-viewed] rejected: token user', _authUser.id, '!= userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const supabase = getSupabaseAdmin()
    
    const { error } = await supabase
      .from('profiles')
      .update({ 
        last_report_viewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
    
    if (error) {
      console.error('Update report viewed error:', error)
      return Response.json({ error: 'Failed to update' }, { status: 500 })
    }
    
    return Response.json({ success: true })
    
  } catch (error) {
    console.error('Update report viewed error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
