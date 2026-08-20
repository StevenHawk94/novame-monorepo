import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'
import { r2BumpContentVersion, r2GetObjectBytes, r2HeadObject, r2PutObject } from '@/lib/r2-client'

export const runtime = 'nodejs'
const KEY = 'Items/items-manifest.json'

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2))

async function getManifest() {
  try { return JSON.parse(new TextDecoder().decode(await r2GetObjectBytes(KEY))) }
  catch { return { version: '0', items: [], keywordPatches: [], history: [] } }
}

async function publish(next, reason) {
  const current = await getManifest()
  if (current.version && current.version !== '0') {
    await r2PutObject({ key: `Items/versions/${current.version}.json`, body: bytes(current), contentType: 'application/json' })
  }
  const version = String(Date.now())
  const previous = current.version && current.version !== '0'
    ? [{ version: String(current.version), publishedAt: current.publishedAt || new Date().toISOString(), reason: 'Previous catalog' }]
    : []
  const history = [{ version, publishedAt: new Date().toISOString(), reason }, ...previous, ...(current.history || [])]
    .filter((entry, index, all) => all.findIndex((x) => x.version === entry.version) === index).slice(0, 30)
  const manifest = { ...next, version, publishedAt: new Date().toISOString(), history }
  await r2PutObject({ key: `Items/versions/${version}.json`, body: bytes(manifest), contentType: 'application/json' })
  await r2PutObject({ key: KEY, body: bytes(manifest), contentType: 'application/json' })
  await r2BumpContentVersion('items')
  return manifest
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const manifest = await getManifest()
  return NextResponse.json({ success: true, manifest })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const current = await getManifest()
    if (body.action === 'commitBatch') {
      const entries = Array.isArray(body.entries) ? body.entries.slice(0, 500) : []
      if (!entries.length) return NextResponse.json({ success: false, error: 'No entries' }, { status: 400 })
      for (let i = 0; i < entries.length; i += 20) {
        const chunk = entries.slice(i, i + 20)
        const heads = await Promise.all(chunk.map((entry) => r2HeadObject(entry.imageKey)))
        if (heads.some((head) => !head)) throw new Error('One or more image uploads are missing')
      }
      const byId = new Map((current.items || []).map((item) => [item.id, item]))
      const candidateIds = []
      for (const entry of entries) {
        if (!entry.id || !entry.name || !entry.imageKey) throw new Error('Invalid item metadata')
        byId.set(String(entry.id), {
          id: String(entry.id), name: String(entry.name).slice(0, 80), imageKey: String(entry.imageKey),
          bagsCategory: String(entry.bagsCategory || 'Stuff'), promptCategory: String(entry.promptCategory || 'Uncategorized'),
          keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String).filter(Boolean).slice(0, 200) : [],
        })
        if (typeof entry.candidateId === 'string' && entry.candidateId) candidateIds.push(entry.candidateId)
      }
      const manifest = await publish({ ...current, items: [...byId.values()] }, `Batch upload: ${entries.length} items`)
      if (candidateIds.length) {
        await db().from('item_learning_candidates').update({ status: 'published', published_version: manifest.version })
          .in('id', candidateIds)
      }
      return NextResponse.json({ success: true, version: manifest.version })
    }
    if (body.action === 'publishApproved') {
      const supabase = db()
      const { data: candidates, error } = await supabase.from('item_learning_candidates').select('*')
        .eq('status', 'approved').eq('kind', 'missing_keyword')
      if (error) throw error
      const patches = [...(current.keywordPatches || [])]
      const publishedIds = []
      for (const row of candidates || []) {
        if (!row.suggested_item_id || row.safety_mode === 'NEVER_AUTO') continue
        const patch = { keyword: row.normalized_concept, itemId: row.suggested_item_id,
          safetyMode: row.safety_mode, exclusions: row.exclusion_rules || [], candidateId: row.id }
        const at = patches.findIndex((existing) => existing.keyword === patch.keyword)
        if (at >= 0) patches[at] = patch
        else patches.push(patch)
        publishedIds.push(row.id)
      }
      if (!publishedIds.length) return NextResponse.json({ success: false, error: 'No approved keyword candidates' }, { status: 409 })
      const manifest = await publish({ ...current, keywordPatches: patches }, `Published ${publishedIds.length} keyword patches`)
      await supabase.from('item_learning_candidates').update({ status: 'published', published_version: manifest.version })
        .in('id', publishedIds)
      return NextResponse.json({ success: true, version: manifest.version, published: publishedIds.length })
    }
    if (body.action === 'rollback') {
      const version = String(body.version || '')
      if (!/^\d+$/.test(version)) return NextResponse.json({ success: false, error: 'Invalid version' }, { status: 400 })
      const snapshot = JSON.parse(new TextDecoder().decode(await r2GetObjectBytes(`Items/versions/${version}.json`)))
      const manifest = await publish(snapshot, `Rollback to ${version}`)
      return NextResponse.json({ success: true, version: manifest.version })
    }
    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[admin/items-cloud]', error)
    return NextResponse.json({ success: false, error: error?.message || 'Failed' }, { status: 500 })
  }
}
