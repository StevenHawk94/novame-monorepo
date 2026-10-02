import type { GameOverview, GameSession } from './burrow-game-room-api';
import { subscribeSessionIdentity } from './session-lifecycle';

// Catalogue art/questions barely change; active rounds can change on the
// partner's phone, so they get a shorter background revalidation window.
const OVERVIEW_IDLE_TTL_MS = 2 * 60_000;
const OVERVIEW_ACTIVE_TTL_MS = 30_000;
const SESSION_TTL_MS = 10_000;
type Cached<T> = { value: T; savedAt: number };

let overview: Cached<GameOverview> | null = null;
const sessions = new Map<string, Cached<GameSession>>();
subscribeSessionIdentity(() => { overview = null; sessions.clear(); });

export function getCachedGameOverview(): GameOverview | null { return overview?.value ?? null; }
export function gameOverviewNeedsRefresh(now = Date.now()): boolean {
  if (!overview) return true;
  const ttl = overview.value.sessions.some(session => !session.completedAt)
    ? OVERVIEW_ACTIVE_TTL_MS : OVERVIEW_IDLE_TTL_MS;
  return now - overview.savedAt >= ttl;
}
export function cacheGameOverview(value: GameOverview, now = Date.now()): void {
  overview = { value, savedAt: now };
}
export function getCachedGameSession(id: string): GameSession | null { return sessions.get(id)?.value ?? null; }
export function gameSessionNeedsRefresh(id: string, now = Date.now()): boolean {
  const cached = sessions.get(id);
  return !cached || now - cached.savedAt >= SESSION_TTL_MS;
}
export function cacheGameSession(value: GameSession, now = Date.now()): void {
  sessions.set(value.id, { value, savedAt: now });
}
