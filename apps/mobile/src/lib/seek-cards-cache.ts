/**
 * SWR-style MMKV cache for the Seek (Discover) question -> wisdom-cards
 * list. Mirrors the me-stats cache pattern: synchronous MMKV read/write
 * plus a fetchedAtMs timestamp for TTL freshness.
 *
 * Why: seek-question previously re-fetched /api/seek-questions on every
 * focus, so revisiting a question always showed a full-screen spinner
 * while the (round-trip-bound) request resolved. With this cache the
 * second visit renders the previous snapshot immediately and only hits
 * the network when the snapshot is older than TTL_MS (or a force refresh
 * is requested, e.g. after the user offers their own wisdom).
 *
 * Key includes userId because the server filters out cards THIS user has
 * blocked; a shared key could leak a blocked card across accounts.
 */
import { storage } from '@/lib/storage';
import type { SeekCard, SeekQuestion } from '@/lib/seek-types';

const PREFIX = 'novame_seek_cards_';

/** Freshness window. Within this, a cache hit skips the network entirely. */
export const TTL_MS = 60_000;

export type CachedSeekCards = {
  cards: SeekCard[];
  question: SeekQuestion | null;
  fetchedAtMs: number;
};

function keyFor(questionId: string, userId: string | null): string {
  return `${PREFIX}${questionId}_${userId ?? 'anon'}`;
}

export function getCachedSeekCards(
  questionId: string,
  userId: string | null,
): CachedSeekCards | null {
  const raw = storage.getString(keyFor(questionId, userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSeekCards;
  } catch {
    return null;
  }
}

export function setCachedSeekCards(
  questionId: string,
  userId: string | null,
  cards: SeekCard[],
  question: SeekQuestion | null,
): void {
  const entry: CachedSeekCards = { cards, question, fetchedAtMs: Date.now() };
  storage.set(keyFor(questionId, userId), JSON.stringify(entry));
}

export function invalidateSeekCards(
  questionId: string,
  userId: string | null,
): void {
  storage.remove(keyFor(questionId, userId));
}

/** True if the cached snapshot is still within the TTL freshness window. */
export function isFresh(cached: CachedSeekCards): boolean {
  return Date.now() - cached.fetchedAtMs < TTL_MS;
}
