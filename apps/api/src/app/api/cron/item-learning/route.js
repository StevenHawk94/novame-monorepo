import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getMergedDictionary } from '@/lib/remote-items'
import { recordItemLearningConcepts } from '@/lib/item-learning'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { data: jobs, error } = await supabase.from('item_learning_jobs')
    .select('id, concepts, matched_item_ids, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  if (!jobs?.length) return NextResponse.json({ ok: true, processed: 0 })

  const dictionary = await getMergedDictionary(supabase)
  let processed = 0
  for (const job of jobs) {
    await supabase.from('item_learning_jobs').update({
      status: 'processing', attempts: Number(job.attempts || 0) + 1,
    }).eq('id', job.id)
    try {
      const matched = (Array.isArray(job.matched_item_ids) ? job.matched_item_ids : [])
        .map((itemId) => ({ itemId }))
      await recordItemLearningConcepts(supabase, job.concepts, dictionary, matched)
      await supabase.from('item_learning_jobs').update({
        status: 'completed', error: null, processed_at: new Date().toISOString(),
      }).eq('id', job.id)
      processed++
    } catch (err) {
      await supabase.from('item_learning_jobs').update({
        status: 'failed', error: String(err?.message || err).slice(0, 500),
      }).eq('id', job.id)
    }
  }
  return NextResponse.json({ ok: true, processed })
}

