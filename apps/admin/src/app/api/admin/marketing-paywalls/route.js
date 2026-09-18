import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'
const CAMPAIGN = 'partner_reflect'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function normalize(body) {
  const benefits = Array.isArray(body.benefits)
    ? body.benefits.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
    : []
  return {
    variant_key: String(body.variant_key || '').trim().slice(0, 24),
    headline: String(body.headline || '').trim().slice(0, 180),
    subheadline: String(body.subheadline || '').trim().slice(0, 300),
    cta_heading: String(body.cta_heading || '').trim().slice(0, 120),
    benefits,
    weight: Math.max(0, Math.min(10000, Number.parseInt(body.weight, 10) || 0)),
    sort_order: Math.max(0, Number.parseInt(body.sort_order, 10) || 0),
    is_active: body.is_active !== false,
  }
}

function invalid(value) {
  return !value.variant_key || !value.headline || !value.subheadline || !value.cta_heading || value.benefits.length === 0
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const supabase = getSupabase()
    const { data: variants, error } = await supabase.from('marketing_paywall_variants')
      .select('*').eq('campaign', CAMPAIGN).eq('is_archived', false)
      .order('sort_order', { ascending: true })
    if (error) throw error
    const enriched = await Promise.all((variants || []).map(async (variant) => {
      const [impressions, clicks] = await Promise.all([
        supabase.from('marketing_paywall_events').select('id', { count: 'exact', head: true })
          .eq('variant_id', variant.id).eq('event_type', 'impression'),
        supabase.from('marketing_paywall_events').select('id', { count: 'exact', head: true })
          .eq('variant_id', variant.id).eq('event_type', 'click'),
      ])
      const impressionCount = impressions.count || 0
      const clickCount = clicks.count || 0
      return {
        ...variant,
        impressions: impressionCount,
        clicks: clickCount,
        ctr: impressionCount ? clickCount / impressionCount : 0,
      }
    }))
    return Response.json({ success: true, variants: enriched })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const value = normalize(await request.json())
    if (invalid(value)) return Response.json({ error: 'All copy fields and at least one benefit are required.' }, { status: 400 })
    const supabase = getSupabase()
    const { data, error } = await supabase.from('marketing_paywall_variants')
      .insert({ ...value, campaign: CAMPAIGN }).select().single()
    if (error) throw error
    return Response.json({ success: true, variant: data })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    if (!body.id) return Response.json({ error: 'Missing id.' }, { status: 400 })
    const value = normalize(body)
    if (invalid(value)) return Response.json({ error: 'All copy fields and at least one benefit are required.' }, { status: 400 })
    const supabase = getSupabase()
    const { error } = await supabase.from('marketing_paywall_variants')
      .update({ ...value, updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('campaign', CAMPAIGN).eq('is_archived', false)
    if (error) throw error
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'Missing id.' }, { status: 400 })
    const supabase = getSupabase()
    const { error } = await supabase.from('marketing_paywall_variants')
      .update({ is_active: false, is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id).eq('campaign', CAMPAIGN)
    if (error) throw error
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
