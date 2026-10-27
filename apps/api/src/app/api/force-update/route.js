import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// GET: Check if there's an active force update
export async function GET(request) {
  try {
    const supabase = getSupabase()

    // ?history=true: admin-only full history list (audit view of every
    // force-update ever created). Requires Bearer token in ADMIN_USER_IDS.
    // The default (no param) path stays PUBLIC -- mobile polls it on launch
    // to read the single active row, so it must not require auth.
    const { searchParams } = new URL(request.url)
    if (searchParams.get('history') === 'true') {
      const authError = await checkAdminAuth(request, supabase)
      if (authError) return authError
      const { data, error } = await supabase
        .from('force_updates')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, history: data || [] })
    }

    const { data } = await supabase.from('force_updates').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1)
    const active = data?.[0] || null
    return NextResponse.json({ success: true, forceUpdate: active })
  } catch (e) {
    return NextResponse.json({ success: true, forceUpdate: null })
  }
}

// Admin allowlist helper -- shared by POST and DELETE.
// Reads ADMIN_USER_IDS env var (comma-separated UUIDs), verifies the
// caller's Bearer token via auth.getUser, returns null on success or
// a NextResponse 401/403 on failure.
async function checkAdminAuth(request, supabase) {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    console.warn('[force-update] rejected: no bearer token')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await verifyToken(token); const authErr = user ? null : new Error('invalid token')
  if (authErr || !user) {
    console.warn('[force-update] rejected: token verify failed', authErr && authErr.message)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!adminIds.includes(user.id)) {
    console.warn('[force-update] rejected: user', user.id, 'not in ADMIN_USER_IDS allowlist')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null // success
}

// POST: Atomically save the minimum supported version; keep prior revisions for audit.
export async function POST(request) {
  try {
    const supabase = getSupabase()
    const authError = await checkAdminAuth(request, supabase)
    if (authError) return authError

    const { minVersion, message, platform } = await request.json()
    if (typeof minVersion!=='string'||typeof message!=='string'||!message.trim()||message.trim().length>2000) return NextResponse.json({ error: 'Missing or invalid minimum version/message' }, { status: 400 })
    // Validate semver shape (major.minor.patch, digits only). The mobile
    // client fails OPEN on anything it can't parse, but reject obviously
    // bad input here so admins get immediate feedback instead of silently
    // shipping a no-op force-update.
    if (!/^\d+\.\d+\.\d+$/.test(String(minVersion).trim())) {
      return NextResponse.json({ error: 'minVersion must be semver, e.g. 1.2.0' }, { status: 400 })
    }
    const normalizedPlatform = ['ios', 'android', 'all'].includes(platform) ? platform : 'all'
    const {data,error}=await supabase.rpc('save_minimum_app_version_v1',{
      p_min_version:minVersion.trim(),p_message:message.trim(),p_platform:normalizedPlatform,p_enabled:true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, forceUpdate: data })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: Deactivate force update (admin)
export async function DELETE(request) {
  try {
    const supabase = getSupabase()
    const authError = await checkAdminAuth(request, supabase)
    if (authError) return authError

    const {error}=await supabase.rpc('save_minimum_app_version_v1',{p_min_version:null,p_message:null,p_platform:null,p_enabled:false})
    if(error)return NextResponse.json({error:error.message},{status:500})
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
