import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient } from '@/lib/app-major-update'

export const runtime = 'edge'
export const maxDuration = 60
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = appMajorUpdateServiceClient()
    const { data, error } = await db.rpc('collect_memory_photo_garbage_v1')
    if (error || !Array.isArray(data)) throw Error('cleanup_failed')
    let removed = 0
    for (const path of data) {
      // Accept only server-generated immutable keys in this bucket.
      if (typeof path !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/.test(path)) throw Error('cleanup_failed')
      const deletion = await db.storage.from('burrow-memory-photos').remove([path])
      if (deletion.error) throw deletion.error
      const ack = await db.from('memory_photo_garbage').delete().eq('private_path', path)
      if (ack.error) throw ack.error
      removed++
    }
    return NextResponse.json({ success: true, removed }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'cleanup_failed' }, { status: 503 }) }
}
