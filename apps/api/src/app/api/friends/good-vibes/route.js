import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const MESSAGES = [
  'Love you to bits!',
  'So grateful for you.',
  'Always by your side.',
  'You mean the world.',
  'Rooting for you always!',
  'Good things are coming.',
  "You've got this!",
  'Keep shining your light.',
  'Ride or Die, No Cap',
  'Proud of you, always.',
  'Sending a big hug!',
  'Thinking of you today.',
  "Tomorrow's a fresh start.",
  'Delulu is the Solulu.',
  "Don't Let Idiots Ruin Your Day.",
  'Main Character Energy Only!',
  'More Espresso, Less Depresso.',
  'In My Rest & Healing Era.',
  'Slay the Day, Then Take a Nap.',
  'Kindness is Cool, Drama is Not.',
  'Overthinking, but Make it Cute.',
  'Every day counts, truly.',
  'Big wins ahead today!',
  'Forever on Your Team!',
  'My Favorite Notification Is You.',
]

function client() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function viewer(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return verifyToken(token)
}

export async function GET(request) {
  try {
    const verified = await viewer(request)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = new URL(request.url).searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = client()
    const { data: vibe } = await supabase.from('good_vibes')
      .select('id, sender_user_id, message_index, message, created_at')
      .eq('recipient_user_id', userId).is('read_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!vibe) return NextResponse.json({ success: true, vibe: null })
    const { data: sender } = await supabase.from('profiles')
      .select('display_name, avatar_url, is_default_avatar').eq('id', vibe.sender_user_id).maybeSingle()
    return NextResponse.json({ success: true, vibe: {
      id: vibe.id, senderUserId: vibe.sender_user_id, senderName: sender?.display_name || 'Your paired',
      senderAvatarUrl: sender?.avatar_url || '', senderIsDefaultAvatar: sender?.is_default_avatar !== false,
      messageIndex: vibe.message_index, message: vibe.message, createdAt: vibe.created_at,
    } })
  } catch (err) {
    console.error('[good-vibes] GET:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const verified = await viewer(request)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, action, vibeId, messageIndex, localDate } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = client()
    if (action === 'read') {
      const { error } = await supabase.from('good_vibes').update({ read_at: new Date().toISOString() })
        .eq('id', vibeId).eq('recipient_user_id', userId)
      return error ? NextResponse.json({ error: 'Failed' }, { status: 500 }) : NextResponse.json({ success: true })
    }
    if (!Number.isInteger(messageIndex) || !MESSAGES[messageIndex]) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 })
    }
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(localDate || '') ? localDate : new Date().toISOString().slice(0, 10)
    const { data: pairing } = await supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle()
    if (!pairing) return NextResponse.json({ error: 'not_paired' }, { status: 409 })
    const { error } = await supabase.from('good_vibes').insert({
      sender_user_id: userId, recipient_user_id: pairing.partner_user_id,
      message_index: messageIndex, message: MESSAGES[messageIndex], sender_local_date: safeDate,
    })
    if (error?.code === '23505') return NextResponse.json({ error: 'daily_limit' }, { status: 409 })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[good-vibes] POST:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
