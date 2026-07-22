/**
 * Home memory bubbles (PRD §3.5). Friends' items collected today float over
 * the Home scene as soap bubbles; tapping pops one. Public items then show a
 * small memory card (item + friend attribution).
 *
 * Data source: /api/friends/status via fetchFriends() — the same feed the
 * Friends tab renders, so no new endpoint is needed for the visual layer.
 * What is deliberately NOT here yet:
 *   - the +5 currency grant (server-authoritative; lands with the P1 economy
 *     rework as an idempotent per-bubble RPC — the client never self-credits)
 *   - per-item public/private flags and real memory excerpts (P4 privacy
 *     model; until then every bubble is treated as public and the card shows
 *     the item name as its text)
 *
 * Selection is deterministic per (localDate, friend, item): a stable hash
 * orders all candidates and the first MAX_BUBBLES win. Recomputing on every
 * mount therefore yields the same set all day — only the popped ids need
 * persisting (kHomeBubblesState, user scope).
 */
import { ITEM_DICTIONARY } from '@novame/engine';

import { apiClient } from './api';
import { fetchFriends } from './friends-api';
import { storage } from './storage';
import { supabase } from './supabase';
import { kHomeBubblesState } from '../shared/storage/keys';

export const MAX_BUBBLES = 5;

export interface MemoryBubble {
  id: string; // `${friendUserId}:${itemId}` — stable for the day
  friendUserId: string;
  friendName: string;
  itemId: string;
  emoji: string;
  itemName: string;
  /** P4 will wire the real per-item privacy flag; treat all as public until then. */
  isPublic: boolean;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** djb2 — tiny, stable, good enough to order a handful of bubbles. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

interface PoppedState {
  date: string;
  popped: string[];
}

function readPopped(): PoppedState {
  const today = localDateStr();
  try {
    const raw = storage.getString(kHomeBubblesState.name);
    if (raw) {
      const parsed = JSON.parse(raw) as PoppedState;
      if (parsed.date === today && Array.isArray(parsed.popped)) return parsed;
    }
  } catch {
    // corrupt state → start fresh; worst case a popped bubble reappears once
  }
  return { date: today, popped: [] };
}

export function isPopped(bubbleId: string): boolean {
  return readPopped().popped.includes(bubbleId);
}

export function markPopped(bubbleId: string): void {
  const state = readPopped();
  if (!state.popped.includes(bubbleId)) state.popped.push(bubbleId);
  storage.set(kHomeBubblesState.name, JSON.stringify(state));
}

/**
 * Claim the +5 pop reward server-side (pop_bubble RPC: friendship check,
 * per-bubble idempotency, 5-a-day cap all live there). Fire-and-forget from
 * the pop animation — a failed claim costs the reward, never the visual.
 * Returns the awarded amount (0 on any rejection) so the caller may toast it.
 */
export async function submitBubblePop(bubble: MemoryBubble): Promise<number> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return 0;
    const data = await apiClient.post<{ success?: boolean; xp_awarded?: number }>(
      '/api/bubbles/pop',
      {
        userId,
        friendUserId: bubble.friendUserId,
        itemId: bubble.itemId,
        localDate: localDateStr(),
      },
    );
    return data.success ? data.xp_awarded ?? 0 : 0;
  } catch {
    return 0; // already_popped / cap / offline — all fine, purely cosmetic
  }
}

/**
 * Today's bubble set: every (friend, today-item) pair, deterministically
 * ordered, capped at MAX_BUBBLES, minus the ones already popped. Network
 * failure or zero friends simply yields [] — Home renders nothing extra.
 */
export async function loadTodayBubbles(): Promise<MemoryBubble[]> {
  try {
    const status = await fetchFriends();
    const date = localDateStr();
    const candidates: MemoryBubble[] = [];
    for (const f of status.friends) {
      for (const itemId of f.todayItemIds) {
        const entry = ITEM_DICTIONARY.items[itemId];
        candidates.push({
          id: `${f.userId}:${itemId}`,
          friendUserId: f.userId,
          friendName: f.displayName,
          itemId,
          emoji: entry?.emoji ?? '✨',
          itemName: entry?.displayName ?? 'A little memory',
          isPublic: true,
        });
      }
    }
    candidates.sort(
      (a, b) => hash(`${date}|${a.id}`) - hash(`${date}|${b.id}`),
    );
    return candidates.slice(0, MAX_BUBBLES).filter((b) => !isPopped(b.id));
  } catch {
    return [];
  }
}
