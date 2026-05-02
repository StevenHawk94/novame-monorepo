import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSB() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// GET — list all unique default users (from leaderboard_seeds)
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const sb = getSB()
  const { data, error } = await sb.from('leaderboard_seeds').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, users: data || [] })
}

// POST — create a new default user
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { name, avatarUrl, exp } = await request.json()
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  const sb = getSB()
  const { data, error } = await sb.from('leaderboard_seeds').insert({
    name,
    avatar_url: avatarUrl || '',
    total_mins: parseInt(exp) || 0,  // stored as total_mins, displayed as exp in admin
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, user: data })
}

// DELETE — remove a default user
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const sb = getSB()
  await sb.from('leaderboard_seeds').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
