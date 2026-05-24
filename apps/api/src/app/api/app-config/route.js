import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * Public app config endpoint — Stage A.
 *
 * Returns dynamic configuration values (pricing + unlock thresholds)
 * that are editable via admin without redeploying the app.
 *
 * Source of truth: Supabase `app_config` table (key/value/updated_by/updated_at).
 *   - printed_book_price   (number)  USD, 2-decimal
 *   - wisdom_cards_price   (number)  USD, 2-decimal
 *   - shipping_fee         (number)  USD
 *   - book_unlock_words    (integer) total recorded words to unlock book
 *   - cards_unlock_count   (integer) unique keywords collected to unlock cards
 *
 * Mobile client policy (per design Q3 = a + c):
 *   - Cache the response in MMKV with a 1-hour TTL.
 *   - Use cached values for display.
 *   - Server-side endpoints (book-payment, orders) re-read from DB on
 *     every request — they ARE the source of truth for charge amounts.
 *
 * CORS open (`*`) because the mobile bundle and the admin web app both
 * call this endpoint; no auth required since values are not sensitive.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const CONFIG_KEYS = [
  'printed_book_price',
  'wisdom_cards_price',
  'shipping_fee',
  'book_unlock_words',
  'cards_unlock_count',
]

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value, updated_at')
      .in('key', CONFIG_KEYS)

    if (error) {
      console.error('[app-config] DB error:', error.message)
      return NextResponse.json(
        { success: false, error: 'Failed to load config' },
        { status: 500, headers: CORS_HEADERS },
      )
    }

    // Build config object; parseFloat all values so mobile gets numbers.
    // Missing keys default to null so the client can decide whether to
    // fall back to a hardcoded default (e.g. in case of partial DB seed).
    const config = {}
    let latestUpdatedAt = null
    for (const key of CONFIG_KEYS) {
      const row = (data || []).find((r) => r.key === key)
      if (row) {
        const parsed = parseFloat(row.value)
        config[key] = Number.isFinite(parsed) ? parsed : null
        if (!latestUpdatedAt || row.updated_at > latestUpdatedAt) {
          latestUpdatedAt = row.updated_at
        }
      } else {
        config[key] = null
      }
    }

    return NextResponse.json(
      { success: true, config, updatedAt: latestUpdatedAt },
      { headers: CORS_HEADERS },
    )
  } catch (e) {
    console.error('[app-config] unexpected error:', e.message)
    return NextResponse.json(
      { success: false, error: e.message || 'Internal error' },
      { status: 500, headers: CORS_HEADERS },
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
