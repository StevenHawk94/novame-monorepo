import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

export function appMajorUpdateServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function authenticatedUserId(request) {
  const token = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  if (!token) return null
  const verified = await verifyToken(token)
  return verified?.id || null
}

export function commandStatus(error) {
  if (!error) return 200
  if (error === 'memory_conflict' || error === 'sharing_conflict' || error === 'pair_changed') return 409
  if (error === 'client_upgrade_required') return 409
  if (error === 'photo_conflict' || error === 'upload_expired') return 409
  if (error === 'not_found') return 404
  if (error === 'not_paired' || error === 'plus_required' || error === 'feature_disabled') return 403
  if (error === 'insufficient_balance') return 402
  if (error === 'cooldown_active' || error === 'daily_adventure_used'
      || error === 'already_full' || error === 'not_completed'
      || error === 'already_owned' || error === 'not_ready'
      || error === 'not_claimable' || error === 'no_eligible_reward'
      || error === 'result_not_ready' || error === 'interaction_not_ready'
      || error === 'reward_no_longer_eligible' || error === 'adventure_pending'
      || error === 'record_already_used' || error === 'idempotency_conflict'
      || error === 'game_locked' || error === 'answer_conflict' || error === 'answer_out_of_order'
      || error === 'battle_required' || error === 'already_done' || error === 'daily_limit_reached') return 409
  if (error === 'invalid_request' || error === 'invalid_amount'
      || error === 'quest_not_assigned' || error === 'not_in_progress'
      || error === 'not_for_sale' || error === 'not_tradable'
      || error === 'record_required' || error === 'invalid_loadout'
      || error === 'invalid_response' || error === 'item_not_owned') return 400
  return 500
}

export function projectedNeed(value, updatedAt, now = Date.now()) {
  const safeValue = Math.max(0, Math.min(100, Math.trunc(Number(value) || 0)))
  const updatedMs = new Date(updatedAt).getTime()
  if (!Number.isFinite(updatedMs) || now <= updatedMs) return safeValue
  return Math.max(0, safeValue - Math.floor((now - updatedMs) / (5 * 60 * 1000)))
}

export async function majorUpdateEnabled(supabase) {
  const { data, error } = await supabase.from('app_config').select('value')
    .eq('key', 'app_major_update_enabled').maybeSingle()
  if (error) throw error
  return ['true', '1'].includes(data?.value)
}
