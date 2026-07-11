import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { DIMENSION_IDS } from '@novame/domain'

export const runtime = 'edge'

/**
 * GET /api/lens/next?userId=xxx&theme=expression
 *
 * The next New Lens card for the user in a theme, by cursor (next_lens_card
 * RPC): the first active card past what they last saw, wrapping to the start
 * when the theme is exhausted. Read-only -- the cursor advances on completion,
 * not here.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const theme = searchParams.get('theme')
    if (!userId || !theme) {
      return NextResponse.json({ error: 'Missing userId or theme' }, { status: 400 })
    }
    if (!DIMENSION_IDS.includes(theme)) {
      return NextResponse.json({ error: 'Invalid theme' }, { status: 400 })
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data, error } = await supabase.rpc('next_lens_card', {
      p_user_id: userId,
      p_theme: theme,
    })
    if (error) {
      console.error('[lens/next] rpc error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (!data?.found) {
      return NextResponse.json({ success: true, card: null })
    }

    return NextResponse.json({
      success: true,
      card: {
        cardId: data.card_id,
        theme: data.theme,
        sortOrder: data.sort_order,
        headline: data.headline,
        body: data.body,
      },
    })
  } catch (err) {
    console.error('[lens/next] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
