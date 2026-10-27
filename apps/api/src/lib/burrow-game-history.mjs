import { scoreGameRoomRound } from './burrow-game-room.mjs'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const PAGE_SIZE = 30

export function parseGameHistoryCursor(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 200) throw Error('invalid_request')
  let cursor
  try { cursor = JSON.parse(value) } catch { throw Error('invalid_request') }
  if (!uuid(cursor?.id) || typeof cursor.createdAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)
    || !Number.isFinite(Date.parse(cursor.createdAt))) throw Error('invalid_request')
  return { id: cursor.id, createdAt: cursor.createdAt }
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args)
  if (error) throw error
  return data
}

/** Current relationship only, never client-selected partners or former pairs. */
export async function gameHistoryPage(db, userId, cursor = null) {
  const partnerId = await rpc(db, 'lock_burrow_pair', { p_user: userId })
  if (!partnerId) return { paired: false, rounds: [], nextCursor: null }
  const pairArgs = { p_user_id: userId, p_partner_id: partnerId }
  const version = await rpc(db, 'burrow_pair_version_v1', pairArgs)
  if (!version) throw Error('pair_changed')
  const [low, high] = [userId, partnerId].sort()
  let query = db.from('burrow_game_sessions')
    .select('id,game_id,created_at,completed_at,viewer:burrow_game_progress!inner(user_id,result_viewed_at),burrow_game_progress(user_id,own_answers,guesses)')
    .eq('pair_low', low).eq('pair_high', high).eq('pair_version', version)
    .not('completed_at', 'is', null)
    .eq('viewer.user_id',userId).not('viewer.result_viewed_at','is',null)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(PAGE_SIZE + 1)
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
  const { data, error } = await query
  if (error) throw error
  // Reads span multiple DB calls: discard an in-flight former-pair response.
  const currentPartner = await rpc(db, 'lock_burrow_pair', { p_user: userId })
  if (currentPartner !== partnerId || await rpc(db, 'burrow_pair_version_v1', pairArgs) !== version)
    throw Error('pair_changed')
  const rows = (data ?? []).slice(0, PAGE_SIZE)
  const rounds = rows.map(row => {
    const me = row.burrow_game_progress?.find(progress => progress.user_id === userId)
    const them = row.burrow_game_progress?.find(progress => progress.user_id === partnerId)
    return { id: row.id, gameId: row.game_id, createdAt: row.created_at, completedAt: row.completed_at,
      resultViewedAt:row.viewer?.find(progress=>progress.user_id===userId)?.result_viewed_at??null,
      result: scoreGameRoomRound({ completedAt: row.completed_at, ownAnswers: me?.own_answers,
        guesses: me?.guesses, partnerOwnAnswers: them?.own_answers, partnerGuesses: them?.guesses }) }
  })
  const last = rows.at(-1)
  return { paired: true, rounds, nextCursor: (data ?? []).length > PAGE_SIZE && last
    ? JSON.stringify({ createdAt: last.created_at, id: last.id }) : null }
}
