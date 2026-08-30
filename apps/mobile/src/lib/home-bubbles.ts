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
import { apiClient } from './api';
import { fetchFriendFeed } from './friends-api';
import { storage } from './storage';
import { supabase } from './supabase';
import { kHomeBubblesState } from '../shared/storage/keys';
import { mergedItemDictionary } from './remote-items';

export const MAX_BUBBLES = 6;

export interface MemoryBubble {
  id: string; // `${friendUserId}:${itemId}` — stable for the day
  friendUserId: string;
  friendName: string;
  itemId: string;
  emoji: string;
  itemName: string;
  /** The written/AI memory text for this item — null when the friend shared
   *  nothing (no permission, or nothing written): pop only, no card. */
  memoryText: string | null;
  /** @deprecated kept for the card gate; true iff memoryText exists. */
  isPublic: boolean;
  /** Fixed on-screen slot (assigned at load) — popping neighbors never
   *  reshuffles the survivors. */
  slot: number;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
    // Feed-based (2026-08-08): newest publishes win — fresh reflects replace
    // older bubbles — and each item carries its memory text when the friend
    // shares one (the card shows only then; otherwise a pop is just a pop).
    const feed = await fetchFriendFeed();
    const newestFirst = [...feed].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const candidates: MemoryBubble[] = [];
    const seen = new Set<string>();
    for (const e of newestFirst) {
      for (const itemId of e.itemIds) {
        const id = `${e.friendUserId}:${itemId}`;
        if (seen.has(id)) continue; // newest occurrence of an item wins
        seen.add(id);
        const entry = mergedItemDictionary().items[itemId];
        const name = entry?.displayName ?? 'A little memory';
        // A REAL memory only: item-pick reflects store the item's own name as
        // the description — that's not a written memory, so no card for it.
        const raw = e.details?.find((d) => d.itemId === itemId && d.text?.trim())?.text ?? null;
        const norm = (v: string) => v.trim().toLowerCase();
        const text = raw && norm(raw) !== norm(name) && norm(raw) !== norm(itemId) ? raw : null;
        candidates.push({
          id,
          friendUserId: e.friendUserId,
          friendName: e.friendName,
          itemId,
          emoji: entry?.emoji ?? '✨',
          itemName: name,
          memoryText: text,
          isPublic: !!text,
          slot: 0, // assigned after the newest-first cap below
        });
      }
    }
    return candidates
      .slice(0, MAX_BUBBLES)
      .map((b, i) => ({ ...b, slot: i }))
      .filter((b) => !isPopped(b.id));
  } catch {
    return [];
  }
}
