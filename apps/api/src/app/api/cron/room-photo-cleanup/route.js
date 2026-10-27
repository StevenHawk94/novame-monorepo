import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient } from '@/lib/app-major-update'
import { PHOTO_BUCKET, photoUUID } from '@/lib/burrow-photo.mjs'

export const runtime = 'edge'
export const maxDuration = 60

// Rollout-independent: turning the UI off must not strand private objects.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = appMajorUpdateServiceClient()
    let removed = 0
    const started = Date.now()
    for (let batch = 0; batch < 10 && Date.now() - started < 45000; batch++) {
      const { data, error } = await db.rpc('collect_room_photo_garbage_v1')
      if (error || !Array.isArray(data) || data.length > 100) throw Error('cleanup_failed')
      if (!data.length) break
      // Validate the complete batch before any deletion. Never accept a bucket,
      // folder, prefix or URL from a caller or an unchecked queue row.
      for (const path of data) {
        if (typeof path !== 'string') throw Error('cleanup_failed')
        const parts = path.split('/')
        if (parts.length !== 2 || !photoUUID(parts[0]) || !parts[1].endsWith('.jpg') || !photoUUID(parts[1].slice(0, -4)))
          throw Error('cleanup_failed')
      }
      const deletion = await db.storage.from(PHOTO_BUCKET).remove(data)
      if (deletion.error) throw deletion.error
      const ack = await db.from('room_photo_garbage').delete().in('private_path', data)
      if (ack.error) throw ack.error
      removed += data.length
    }
    return NextResponse.json({ success: true, removed }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'cleanup_failed' }, { status: 503 }) }
}
