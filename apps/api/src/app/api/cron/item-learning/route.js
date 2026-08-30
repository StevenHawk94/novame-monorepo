import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyItemRules } from '@novame/engine'
import { getLatestMergedDictionary } from '@/lib/remote-items'
import { readItemRules } from '@/lib/item-rule-store'
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
  const { data: jobs, error } = await supabase.rpc('claim_item_learning_jobs')
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  if (!jobs?.length) return NextResponse.json({ ok: true, processed: 0 })

  const dictionary = applyItemRules(await getLatestMergedDictionary(), (await readItemRules(supabase)).rules)
  let processed = 0
  for (const job of jobs) {
    try {
      const { data: reflect, error: reflectError } = await supabase.from('reflects').select('user_id').eq('id', job.reflect_id).maybeSingle()
      if (reflectError) throw reflectError
      const { data: profile, error: profileError } = await supabase.from('profiles').select('subscription_tier,ai_consent_at').eq('id', reflect?.user_id).maybeSingle()
      if (profileError) throw profileError
      const matched = (Array.isArray(job.matched_item_ids) ? job.matched_item_ids : [])
        .map((itemId) => ({ itemId }))
      if (profile?.ai_consent_at && profile.subscription_tier !== 'free') {
        await recordItemLearningConcepts(supabase, job.concepts, dictionary, matched, { reflectId: job.reflect_id, userId: reflect.user_id })
      }
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
