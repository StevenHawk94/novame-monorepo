import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// GET: Check if there's an active force update
export async function GET() {
  try {
    const supabase = getSupabase()
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
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
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

// POST: Create a new force update notification (admin)
export async function POST(request) {
  try {
    const supabase = getSupabase()
    const authError = await checkAdminAuth(request, supabase)
    if (authError) return authError

    const { version, message } = await request.json()
    if (!version || !message) return NextResponse.json({ error: 'Missing version or message' }, { status: 400 })
    // Deactivate all existing
    await supabase.from('force_updates').update({ is_active: false }).eq('is_active', true)
    // Create new
    const { data, error } = await supabase.from('force_updates').insert({ version, message, is_active: true }).select().single()
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

    await supabase.from('force_updates').update({ is_active: false }).eq('is_active', true)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
