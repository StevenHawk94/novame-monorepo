import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const COSMETIC_PRICE = 500

// Plus-exclusive cosmetics: still cost clovers, but require an active paid tier.
// First pass: the last two pet1 skins are Plus-only.
const PLUS_ONLY = new Set(['pet1-skin5', 'pet1-skin6'])

// Outfit catalog source of truth: R2's video-manifest.json (the same file the
// app reads). Prices/plus flags are looked up server-side so a tampered client
// can't buy below list price. Cached briefly per lambda instance.
const MANIFEST_URL = 'https://media.novameapp.com/video-manifest.json'
const MANIFEST_TTL_MS = 60_000
let manifestCache = { at: 0, outfits: null }

async function getOutfitCatalog() {
  const now = Date.now()
  if (manifestCache.outfits && now - manifestCache.at < MANIFEST_TTL_MS) {
    return manifestCache.outfits
  }
  const res = await fetch(`${MANIFEST_URL}?t=${now}`)
  if (!res.ok) throw new Error(`manifest fetch ${res.status}`)
  const manifest = await res.json()
  const outfits = Array.isArray(manifest.outfits) ? manifest.outfits : []
  manifestCache = { at: now, outfits }
  return outfits
}

/**
 * POST /api/cosmetics/purchase
 *
 * Body: { userId, cosmeticType: 'skin'|'scene'|'outfit', cosmeticId: string }
 *
 * Spend clovers to unlock a skin, scene, or outfit. Server is the authority:
 * it checks the balance (companions.xp - clovers_spent), that the item isn't
 * already owned, and -- for Plus-only items -- that the user is subscribed.
 * Outfit prices/plus flags come from the R2 manifest; skins/scenes keep the
 * flat legacy price. On success it bumps clovers_spent and inserts the unlock
 * (unique constraint makes the insert idempotent against double-taps).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { userId, cosmeticType, cosmeticId } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (cosmeticType !== 'skin' && cosmeticType !== 'scene' && cosmeticType !== 'outfit') {
      return NextResponse.json({ error: 'bad_type' }, { status: 400 })
    }
    if (!cosmeticId || typeof cosmeticId !== 'string') {
      return NextResponse.json({ error: 'bad_id' }, { status: 400 })
    }

    // Resolve price + Plus requirement.
    let price = COSMETIC_PRICE
    let plusRequired = PLUS_ONLY.has(cosmeticId)
    if (cosmeticType === 'outfit') {
      let outfits
      try {
        outfits = await getOutfitCatalog()
      } catch (e) {
        console.error('[cosmetics/purchase] manifest error:', e && e.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      const outfit = outfits.find((o) => o.key === cosmeticId)
      if (!outfit) return NextResponse.json({ error: 'bad_id' }, { status: 400 })
      price = Number(outfit.price) || 0
      plusRequired = !!outfit.plusOnly
      if (price <= 0) return NextResponse.json({ error: 'bad_id' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Already owned? (idempotent success)
    const { data: existing } = await supabase
      .from('cosmetic_unlocks')
      .select('id')
      .eq('user_id', userId)
      .eq('cosmetic_type', cosmeticType)
      .eq('cosmetic_id', cosmeticId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'already_owned' }, { status: 409 })
    }

    // Plus-only gate. profiles.subscription_tier is the tier source every
    // other route uses (was subscriptions.plan here — aligned 2026-07-30 so
    // the dev tier toggle and IAP sync both gate consistently).
    if (plusRequired) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('id', userId)
        .maybeSingle()
      const isPaid = (prof?.subscription_tier || 'free') !== 'free'
      if (!isPaid) return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    }

    // Balance check.
    const { data: comp, error: compErr } = await supabase
      .from('companions')
      .select('xp, clovers_spent')
      .eq('user_id', userId)
      .maybeSingle()
    if (compErr || !comp) {
      return NextResponse.json({ error: 'no_companion' }, { status: 400 })
    }
    const earned = Number(comp.xp) || 0
    const spent = Number(comp.clovers_spent) || 0
    const balance = earned - spent
    if (balance < price) {
      return NextResponse.json({ error: 'insufficient', balance }, { status: 402 })
    }

    // Spend + unlock. Bump spend first; the unique constraint on the insert
    // guards against a concurrent double-purchase.
    const { error: spendErr } = await supabase
      .from('companions')
      .update({ clovers_spent: spent + price })
      .eq('user_id', userId)
    if (spendErr) {
      console.error('[cosmetics/purchase] spend error:', spendErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    const { error: insErr } = await supabase
      .from('cosmetic_unlocks')
      .insert({ user_id: userId, cosmetic_type: cosmeticType, cosmetic_id: cosmeticId })
    if (insErr) {
      // Roll back the spend if the unlock insert failed (e.g. race).
      await supabase
        .from('companions')
        .update({ clovers_spent: spent })
        .eq('user_id', userId)
      console.error('[cosmetics/purchase] insert error:', insErr.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, balance: balance - price })
  } catch (err) {
    console.error('[cosmetics/purchase] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
