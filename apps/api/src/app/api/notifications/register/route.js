import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'

export const runtime = 'edge'

const validToken = (value) => typeof value === 'string'
  && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(value)

export async function POST(request) {
  try {
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(bearer)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, token, platform,notificationVersion,dailyReminderEnabled,adventureVersion,plushieTouchVersion } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!validToken(token) || !['ios', 'android'].includes(platform)) {
      return NextResponse.json({ error: 'invalid_registration' }, { status: 400 })
    }
    const { error } = await serviceClient().from('device_push_tokens').upsert({
      user_id: userId, expo_push_token: token, platform, enabled: true,
      last_seen_at: new Date().toISOString(),
      ...(notificationVersion===2?{notification_version:2,adventure_reminder_enabled:dailyReminderEnabled===true}:{}),
      adventure_version:adventureVersion===5?5:4,
      plushie_touch_version:plushieTouchVersion===2?2:plushieTouchVersion===1?1:0,
    }, { onConflict: 'expo_push_token' })
    if (error) throw error
    return NextResponse.json({ success: true,notificationVersion:notificationVersion===2?2:1 })
  } catch (error) {
    console.error('[notifications/register] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
