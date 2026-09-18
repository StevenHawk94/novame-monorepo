import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

export const runtime = 'edge'

const CAMPAIGN = 'partner_reflect'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function authenticate(request, expectedUserId) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const user = await verifyToken(token)
  return user && user.id === expectedUserId ? user : null
}

function stableFraction(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

function chooseVariant(variants, key) {
  const available = variants.filter((variant) => Number(variant.weight) > 0)
  const total = available.reduce((sum, variant) => sum + Number(variant.weight), 0)
  if (!available.length || total <= 0) return null
  let cursor = stableFraction(key) * total
  for (const variant of available) {
    cursor -= Number(variant.weight)
    if (cursor < 0) return variant
  }
  return available[available.length - 1]
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const reflectId = searchParams.get('reflectId')
    const action = searchParams.get('action')
    if (!userId || (!reflectId && action !== 'pending')) return NextResponse.json({ error: 'missing_parameters' }, { status: 400 })
    if (!await authenticate(request, userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = serviceClient()
    if (action === 'pending') {
      const { data: profile } = await supabase.from('profiles')
        .select('subscription_tier').eq('id', userId).maybeSingle()
      if ((profile?.subscription_tier || 'free') !== 'free') {
        return NextResponse.json({ success: true, reflectIds: [] })
      }
      const { data: triggers, error: triggerError } = await supabase
        .from('marketing_paywall_triggers').select('trigger_key')
        .eq('user_id', userId).eq('campaign', CAMPAIGN)
        .order('created_at', { ascending: false }).limit(20)
      if (triggerError) throw triggerError
      const keys = (triggers || []).map((row) => row.trigger_key)
      if (!keys.length) return NextResponse.json({ success: true, reflectIds: [] })
      const { data: impressions, error: impressionError } = await supabase
        .from('marketing_paywall_events').select('trigger_key')
        .eq('user_id', userId).eq('campaign', CAMPAIGN)
        .eq('event_type', 'impression').in('trigger_key', keys)
      if (impressionError) throw impressionError
      const seen = new Set((impressions || []).map((row) => row.trigger_key))
      const pending = keys.find((key) => !seen.has(key))
      return NextResponse.json({ success: true, reflectIds: pending ? [pending] : [] })
    }
    const [{ data: profile }, { data: pairing }, { data: reflection }] = await Promise.all([
      supabase.from('profiles').select('subscription_tier').eq('id', userId).maybeSingle(),
      supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle(),
      supabase.from('reflects').select('id,user_id').eq('id', reflectId).maybeSingle(),
    ])
    if ((profile?.subscription_tier || 'free') !== 'free'
      || !pairing?.partner_user_id
      || reflection?.user_id !== pairing.partner_user_id) {
      return NextResponse.json({ success: true, eligible: false })
    }

    const [{ data: prior }, { data: variants, error: variantsError }] = await Promise.all([
      supabase.from('marketing_paywall_events').select('id').eq('user_id', userId)
        .eq('campaign', CAMPAIGN).eq('trigger_key', reflectId).eq('event_type', 'impression').maybeSingle(),
      supabase.from('marketing_paywall_variants').select('*').eq('campaign', CAMPAIGN)
        .eq('is_active', true).eq('is_archived', false).order('sort_order', { ascending: true }),
    ])
    if (variantsError) throw variantsError
    if (prior) return NextResponse.json({ success: true, eligible: false })

    const variant = chooseVariant(variants || [], `${userId}:${reflectId}`)
    if (!variant) return NextResponse.json({ success: true, eligible: false })
    const { error: eventError } = await supabase.from('marketing_paywall_events').insert({
      user_id: userId,
      variant_id: variant.id,
      campaign: CAMPAIGN,
      trigger_key: reflectId,
      event_type: 'impression',
    })
    if (eventError) {
      if (eventError.code === '23505') return NextResponse.json({ success: true, eligible: false })
      throw eventError
    }
    return NextResponse.json({
      success: true,
      eligible: true,
      assignment: {
        reflectId,
        variantId: variant.id,
        variantKey: variant.variant_key,
        headline: variant.headline,
        subheadline: variant.subheadline,
        ctaHeading: variant.cta_heading,
        benefits: Array.isArray(variant.benefits) ? variant.benefits : [],
      },
    })
  } catch (error) {
    console.error('[partner-reflect-paywall] claim:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { userId, reflectId, variantId } = await request.json()
    if (!userId || !reflectId || !variantId) return NextResponse.json({ error: 'missing_parameters' }, { status: 400 })
    if (!await authenticate(request, userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = serviceClient()
    const { data: impression } = await supabase.from('marketing_paywall_events').select('id')
      .eq('user_id', userId).eq('variant_id', variantId).eq('campaign', CAMPAIGN)
      .eq('trigger_key', reflectId).eq('event_type', 'impression').maybeSingle()
    if (!impression) return NextResponse.json({ error: 'impression_not_found' }, { status: 400 })
    const { error } = await supabase.from('marketing_paywall_events').upsert({
      user_id: userId,
      variant_id: variantId,
      campaign: CAMPAIGN,
      trigger_key: reflectId,
      event_type: 'click',
    }, { onConflict: 'user_id,campaign,trigger_key,event_type', ignoreDuplicates: true })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[partner-reflect-paywall] click:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
