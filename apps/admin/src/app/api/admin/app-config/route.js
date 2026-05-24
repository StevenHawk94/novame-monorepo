import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

/**
 * Admin app-config endpoint — Stage A4.1.
 *
 * Manages the 5 dynamic config values stored in Supabase app_config:
 *   - printed_book_price   (USD, 2-decimal)
 *   - wisdom_cards_price   (USD, 2-decimal)
 *   - shipping_fee         (USD, 2-decimal)
 *   - book_unlock_words    (integer, >= 0)
 *   - cards_unlock_count   (integer, 1..48 -- 48 is the total keyword pool)
 *
 * GET  -- returns all 5 rows with value/updated_by/updated_at.
 * POST -- accepts { updates: { key: value, ... } }, validates each
 *         field, writes with updated_by = admin email, updated_at = now.
 *
 * Auth: requireAdmin() — fails closed with 401/403.
 *
 * Note on consistency: SUPABASE_SERVICE_ROLE_KEY bypasses RLS. The 5
 * UPDATEs run sequentially; a network drop mid-batch could leave the
 * table in a half-applied state. Acceptable for admin-only operations
 * (admin will see the partial save in the next GET and re-save). If we
 * ever need true atomicity, wrap in a stored procedure -- not worth
 * the complexity for this surface.
 */

const ALLOWED_KEYS = new Set([
  'printed_book_price',
  'wisdom_cards_price',
  'shipping_fee',
  'book_unlock_words',
  'cards_unlock_count',
])

const PRICE_KEYS = new Set([
  'printed_book_price',
  'wisdom_cards_price',
  'shipping_fee',
])

const INTEGER_KEYS = new Set([
  'book_unlock_words',
  'cards_unlock_count',
])

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * Validate a single (key, rawValue) pair. Returns either a normalized
 * string ready for DB write, or an error message.
 */
function validateValue(key, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { error: `${key}: value is required` }
  }
  // Accept both number and string inputs from JSON body.
  const num = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue)
  if (!Number.isFinite(num)) {
    return { error: `${key}: value must be a finite number, got ${rawValue}` }
  }
  if (num < 0) {
    return { error: `${key}: value must be >= 0, got ${num}` }
  }
  if (INTEGER_KEYS.has(key)) {
    if (!Number.isInteger(num)) {
      return { error: `${key}: value must be an integer, got ${num}` }
    }
    if (key === 'cards_unlock_count' && (num < 1 || num > 48)) {
      return { error: `cards_unlock_count: must be 1..48, got ${num}` }
    }
    return { value: String(num) }
  }
  if (PRICE_KEYS.has(key)) {
    // Round to 2 decimals to avoid float drift (e.g. 99.999 -> '99.999').
    const rounded = Math.round(num * 100) / 100
    return { value: rounded.toFixed(2) }
  }
  // Fallback: should be unreachable given ALLOWED_KEYS partition above.
  return { value: String(num) }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value, updated_by, updated_at')
      .in('key', Array.from(ALLOWED_KEYS))

    if (error) {
      console.error('[admin app-config] GET DB error:', error.message)
      return NextResponse.json(
        { success: false, error: 'Failed to load config' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, rows: data || [] })
  } catch (e) {
    console.error('[admin app-config] GET unexpected:', e.message)
    return NextResponse.json(
      { success: false, error: e.message || 'Internal error' },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const updates = body?.updates
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid `updates` object' },
        { status: 400 },
      )
    }

    // Validate every key+value before any DB write, so a single bad
    // field rejects the whole batch (atomicity-of-validation, even
    // though writes themselves are sequential).
    const validated = []
    for (const [key, rawValue] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json(
          { success: false, error: `Unknown key: ${key}` },
          { status: 400 },
        )
      }
      const v = validateValue(key, rawValue)
      if (v.error) {
        return NextResponse.json(
          { success: false, error: v.error },
          { status: 400 },
        )
      }
      validated.push({ key, value: v.value })
    }

    if (validated.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No updates provided' },
        { status: 400 },
      )
    }

    const supabase = getSupabase()
    const updatedBy = auth.user.email || 'unknown-admin'
    const now = new Date().toISOString()

    // Sequential UPDATEs. Each row uses ON CONFLICT-ish semantics via
    // upsert so a missing key (shouldn't happen post-A1, but defensive)
    // gets created instead of silently failing.
    const results = []
    for (const { key, value } of validated) {
      const { error } = await supabase
        .from('app_config')
        .upsert(
          { key, value, updated_by: updatedBy, updated_at: now },
          { onConflict: 'key' },
        )
      if (error) {
        console.error(`[admin app-config] UPSERT ${key} failed:`, error.message)
        return NextResponse.json(
          {
            success: false,
            error: `Failed to update ${key}: ${error.message}`,
            partialResults: results,
          },
          { status: 500 },
        )
      }
      results.push({ key, value })
    }

    return NextResponse.json({
      success: true,
      updated: results,
      updatedBy,
      updatedAt: now,
    })
  } catch (e) {
    console.error('[admin app-config] POST unexpected:', e.message)
    return NextResponse.json(
      { success: false, error: e.message || 'Internal error' },
      { status: 500 },
    )
  }
}
