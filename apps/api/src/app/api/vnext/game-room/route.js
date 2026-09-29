import { NextResponse } from 'next/server'
import catalog from '@/data/burrow-game-room-v1.json'
import { appMajorUpdateServiceClient, authenticatedUserId, commandStatus, majorUpdateEnabled } from '@/lib/app-major-update'
import { scoreGameRoomRound } from '@/lib/burrow-game-room.mjs'

export const runtime = 'edge'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const gameById = new Map(catalog.games.map(game => [game.id, game]))
const gameSummary = catalog.games.map(({ questions, ...rest }) => ({ ...rest, questionCount: questions.length }))
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

async function context(request) {
  const userId = await authenticatedUserId(request)
  if (!userId) return { error: 'Unauthorized', status: 401 }
  const db = appMajorUpdateServiceClient()
  if (!await majorUpdateEnabled(db)) return { error: 'feature_disabled', status: 403 }
  return { userId, db }
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args)
  if (error) throw error
  return data
}

export async function GET(request) {
  try {
    const ctx = await context(request)
    if (ctx.error) return json({ error: ctx.error }, ctx.status)
    const params = new URL(request.url).searchParams
    if (params.get('mode') === 'overview') {
      const state = await rpc(ctx.db, 'burrow_game_overview_v1', { p_user_id: ctx.userId })
      if (state?.error) return json(state, commandStatus(state.error))
      return json({ success: true, version: catalog.version, categories: catalog.categories, games: gameSummary, ...state })
    }
    if (params.get('mode') === 'session' && uuid(params.get('id'))) {
      const state = await rpc(ctx.db, 'burrow_game_state_v1', { p_user_id: ctx.userId, p_session_id: params.get('id') })
      if (state?.error) return json(state, commandStatus(state.error))
      return json({ success: true, ...state, result: scoreGameRoomRound(state) })
    }
    return json({ error: 'invalid_request' }, 400)
  } catch (error) {
    console.error('[vnext/game-room GET]', error?.message || error)
    return json({ error: 'Internal error' }, 500)
  }
}

export async function POST(request) {
  try {
    const ctx = await context(request)
    if (ctx.error) return json({ error: ctx.error }, ctx.status)
    const raw = await request.text()
    if (raw.length > 2000) return json({ error: 'invalid_request' }, 400)
    let body
    try { body = JSON.parse(raw) } catch { return json({ error: 'invalid_request' }, 400) }
    if (!body || Array.isArray(body) || typeof body !== 'object') return json({ error: 'invalid_request' }, 400)
    let name, args
    if (body.action === 'unlock' && gameById.has(body.gameId) && uuid(body.key)) {
      name = 'burrow_game_unlock_v1'
      args = { p_user_id: ctx.userId, p_game_id: body.gameId, p_key: body.key }
    } else if (body.action === 'start' && gameById.has(body.gameId)) {
      name = 'burrow_game_start_v1'
      args = { p_user_id: ctx.userId, p_game_id: body.gameId, p_questions: gameById.get(body.gameId).questions }
    } else if (body.action === 'answer' && uuid(body.sessionId)
      && ['own', 'guess'].includes(body.phase) && Number.isInteger(body.index) && body.index >= 0 && body.index < 6
      && Number.isInteger(body.choice) && body.choice >= 0 && body.choice < 4) {
      name = 'burrow_game_answer_v1'
      args = { p_user_id: ctx.userId, p_session_id: body.sessionId, p_phase: body.phase, p_index: body.index, p_choice: body.choice }
    } else if (body.action === 'notify' && uuid(body.sessionId) && typeof body.enabled === 'boolean') {
      name = 'burrow_game_notify_v1'
      args = { p_user_id: ctx.userId, p_session_id: body.sessionId, p_enabled: body.enabled }
    } else return json({ error: 'invalid_request' }, 400)
    const result = await rpc(ctx.db, name, args)
    return json(result?.error ? result : { success: true, ...result }, commandStatus(result?.error))
  } catch (error) {
    console.error('[vnext/game-room POST]', error?.message || error)
    return json({ error: 'Internal error' }, 500)
  }
}
