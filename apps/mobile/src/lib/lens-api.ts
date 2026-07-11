/**
 * New Lens: fetch the next card, submit a run, and cache tomorrow's card.
 *
 * B-strategy (cache-next-on-completion): when a run completes, the server
 * cursor has advanced, so we immediately fetch what's now "next" for that theme
 * and stash it. Tomorrow's open is instant -- getNextCard returns the cached
 * card without a round-trip. If the cache is empty or was cleared, we fall back
 * to a live fetch (100-300ms, imperceptible). The server cursor is always
 * authoritative; the cache is a convenience shadow that can't cause a wrong or
 * repeated card, since completion re-derives "next" from the server cursor.
 *
 * The daily done-flag hides the Home entry once used and resets next day.
 */
import { ApiError } from '@novame/api-client';

import { kNewLensState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface LensCard {
  cardId: string;
  theme: string;
  sortOrder: number;
  headline: string;
  body: string;
}

export type LensError = 'already_done' | 'companion_not_ready' | 'network';

export type LensSubmitResult =
  | { ok: true; response: 'resonates' | 'different'; companionXp: number }
  | { ok: false; error: LensError };

interface CachedState {
  date: string; // YYYY-MM-DD the done flag belongs to
  done: boolean;
  nextCards: Record<string, LensCard>; // theme -> pre-fetched next card
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readState(): CachedState {
  const raw = storage.getString(kNewLensState.name);
  if (!raw) return { date: '', done: false, nextCards: {} };
  try {
    const s = JSON.parse(raw) as Partial<CachedState>;
    return {
      date: s.date ?? '',
      done: s.done ?? false,
      nextCards: s.nextCards ?? {},
    };
  } catch {
    return { date: '', done: false, nextCards: {} };
  }
}

function writeState(s: CachedState): void {
  storage.set(kNewLensState.name, JSON.stringify(s));
}

/** Whether New Lens is done for today (resets across a day boundary). */
export function isNewLensDoneToday(): boolean {
  const s = readState();
  return s.date === localDateStr() && s.done === true;
}

/** __DEV__ helper: clear local New Lens state (done flag + cached next cards). */
export function clearNewLensLocal(): void {
  storage.remove(kNewLensState.name);
}

interface WireCard {
  cardId: string;
  theme: string;
  sortOrder: number;
  headline: string;
  body: string;
}

async function fetchNextCard(userId: string, theme: string): Promise<LensCard | null> {
  const data = await apiClient.get<{ success?: boolean; card?: WireCard | null }>(
    `/api/lens/next?userId=${encodeURIComponent(userId)}&theme=${encodeURIComponent(theme)}`,
  );
  return data.card ?? null;
}

/**
 * The next card for a theme. Returns the cached one instantly if present
 * (stashed when the last run completed), else fetches live. The cache is only
 * ever a card the server told us was next; it can't produce a stale or repeated
 * card because it's cleared and re-populated on each completion.
 */
export async function getNextCard(theme: string): Promise<LensCard | null> {
  const s = readState();
  const cached = s.nextCards[theme];
  if (cached) return cached;

  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return null;
  try {
    return await fetchNextCard(userId, theme);
  } catch {
    return null;
  }
}

/**
 * Complete today's New Lens on a card. On success advances the server cursor
 * (in submit_lens), marks today done, and pre-fetches the now-next card for
 * this theme into the cache for tomorrow. response 'different' is surfaced so
 * the screen can route into Reflect.
 */
export async function submitLens(
  theme: string,
  card: LensCard,
  response: 'resonates' | 'different',
): Promise<LensSubmitResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };

  const today = localDateStr();
  try {
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      companion_xp?: number;
    }>('/api/lens/complete', {
      userId,
      theme,
      cardId: card.cardId,
      cardOrder: card.sortOrder,
      response,
      localDate: today,
    });

    if (data.error === 'already_done_this_period') {
      markDoneToday();
      return { ok: false, error: 'already_done' };
    }
    if (data.error === 'companion_not_initialized') {
      return { ok: false, error: 'companion_not_ready' };
    }
    if (data.error || !data.success) {
      return { ok: false, error: 'network' };
    }

    // Success: mark done, and pre-fetch the now-next card for tomorrow.
    markDoneToday();
    void prefetchNext(userId, theme);

    return { ok: true, response, companionXp: data.companion_xp ?? 0 };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      markDoneToday();
      return { ok: false, error: 'already_done' };
    }
    return { ok: false, error: 'network' };
  }
}

function markDoneToday(): void {
  const s = readState();
  const today = localDateStr();
  // Reset nextCards if crossing a day boundary; keep otherwise.
  const nextCards = s.date === today ? s.nextCards : {};
  writeState({ date: today, done: true, nextCards });
}

/** Fetch the now-next card after a completion and stash it for tomorrow. */
async function prefetchNext(userId: string, theme: string): Promise<void> {
  try {
    const next = await fetchNextCard(userId, theme);
    const s = readState();
    if (next) {
      s.nextCards[theme] = next;
    } else {
      delete s.nextCards[theme];
    }
    writeState(s);
  } catch {
    // Non-fatal: tomorrow's open just falls back to a live fetch.
  }
}
