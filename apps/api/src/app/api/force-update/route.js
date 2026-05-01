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

// POST: Create a new force update notification (admin)
export async function POST(request) {
  try {
    const { version, message } = await request.json()
    if (!version || !message) return NextResponse.json({ error: 'Missing version or message' }, { status: 400 })
    const supabase = getSupabase()
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
export async function DELETE() {
  try {
    const supabase = getSupabase()
    await supabase.from('force_updates').update({ is_active: false }).eq('is_active', true)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
