import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const [{ data: profiles, error }, { data: pairings, error: pairingsError }] = await Promise.all([
      supabase.from('profiles')
        .select('id, email, display_name, avatar_url, created_at, subscription_tier')
        .order('created_at', { ascending: false }),
      supabase.from('pairings').select('user_id'),
    ])

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (pairingsError) return NextResponse.json({ error: pairingsError.message }, { status: 500 })

    const pairedUserIds = new Set((pairings || []).map((row) => row.user_id))
    const users = (profiles || []).map((profile) => ({
      ...profile,
      paired: pairedUserIds.has(profile.id),
    }))

    // Backfill missing emails from auth.users
    const missingEmails = users.filter(u => !u.email)
    if (missingEmails.length > 0) {
      for (const u of missingEmails) {
        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(u.id)
          if (authUser?.user?.email) u.email = authUser.user.email
        } catch (e) {}
      }
    }

    return NextResponse.json({ success: true, users })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
