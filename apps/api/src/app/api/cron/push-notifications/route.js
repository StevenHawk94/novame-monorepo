import { NextResponse } from 'next/server'
import { serviceClient } from '@/lib/reflect-draft'
import { drainPushNotificationOutbox } from '@/lib/push-notifications'

export const runtime = 'edge'

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const db=serviceClient()
    const prepared=await db.rpc('prepare_system_notifications_v1')
    if(prepared.error)throw prepared.error
    return NextResponse.json({ ok: true, ...(await drainPushNotificationOutbox(db)) })
  } catch (error) {
    console.error('[cron/push-notifications] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'delivery_failed' }, { status: 500 })
  }
}
