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

    // Get all profiles with wisdom counts
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, avatar_url, created_at, subscription_tier, active_character_id, wp')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Get wisdom counts per user
    const userIds = (profiles || []).map(p => p.id)
    let wisdomCounts = {}
    
    if (userIds.length > 0) {
      const { data: wisdoms } = await supabase
        .from('wisdoms')
        .select('user_id')
        .in('user_id', userIds)

      if (wisdoms) {
        wisdoms.forEach(w => {
          wisdomCounts[w.user_id] = (wisdomCounts[w.user_id] || 0) + 1
        })
      }
    }

    // Get card counts per user
    let cardCounts = {}
    if (userIds.length > 0) {
      const { data: cards } = await supabase
        .from('wisdom_cards')
        .select('user_id')
        .in('user_id', userIds)

      if (cards) {
        cards.forEach(c => {
          cardCounts[c.user_id] = (cardCounts[c.user_id] || 0) + 1
        })
      }
    }

    const users = (profiles || []).map(p => ({
      ...p,
      wisdoms_count: wisdomCounts[p.id] || 0,
      cards_count: cardCounts[p.id] || 0,
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
