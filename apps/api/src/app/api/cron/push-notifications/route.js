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
    return NextResponse.json({ ok: true, ...(await drainPushNotificationOutbox(serviceClient())) })
  } catch (error) {
    console.error('[cron/push-notifications] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'delivery_failed' }, { status: 500 })
  }
}
