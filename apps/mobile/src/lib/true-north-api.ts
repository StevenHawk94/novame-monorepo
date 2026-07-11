/**
 * True North: weekly ranking status, submission, and the reveal comparison.
 *
 * Unlike the daily Kits, True North's entry is permanent -- it doesn't hide
 * when done. Instead, a done week shows last result instead of re-ranking, so
 * the client needs to know doneThisWeek and the recent rankings. Those come
 * from /api/kit/true-north/status and are cached for an instant entry state.
 *
 * The weekly gate is server-side (submit_kit, keyed on the ISO week); the cache
 * is a shadow. A stale "not done" only lets the user open the ranking, which
 * the RPC then rejects with already_done_this_period.
 */
import { ApiError } from '@novame/api-client';
import type { DimensionId } from '@novame/domain';

import { kTrueNorthState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface TrueNorthStatus {
  weekKey: string;
  doneThisWeek: boolean;
  thisWeekRanking: DimensionId[] | null;
  lastRanking: DimensionId[] | null;
}

export type TrueNorthError = 'already_done' | 'companion_not_ready' | 'network';

export type TrueNorthSubmitResult =
  | { ok: true; companionXp: number; gemHits: { dimension: string; gems: number }[] }
  | { ok: false; error: TrueNorthError };

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EMPTY: TrueNorthStatus = {
  weekKey: '',
  doneThisWeek: false,
  thisWeekRanking: null,
  lastRanking: null,
};

export function getCachedStatus(): TrueNorthStatus {
  const raw = storage.getString(kTrueNorthState.name);
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<TrueNorthStatus>) };
  } catch {
    return EMPTY;
  }
}

function cacheStatus(s: TrueNorthStatus): void {
  storage.set(kTrueNorthState.name, JSON.stringify(s));
}

/** Fetch this week's status from the server, refreshing the cache. */
export async function fetchStatus(): Promise<TrueNorthStatus> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedStatus();

  try {
    const data = await apiClient.get<{
      success?: boolean;
      weekKey?: string;
      doneThisWeek?: boolean;
      thisWeekRanking?: DimensionId[] | null;
      lastRanking?: DimensionId[] | null;
    }>(`/api/kit/true-north/status?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`);

    if (!data.success) return getCachedStatus();
    const status: TrueNorthStatus = {
      weekKey: data.weekKey ?? '',
      doneThisWeek: data.doneThisWeek ?? false,
      thisWeekRanking: data.thisWeekRanking ?? null,
      lastRanking: data.lastRanking ?? null,
    };
    cacheStatus(status);
    return status;
  } catch {
    return getCachedStatus();
  }
}

/** Submit this week's ranking (8 dimensions, best first). */
export async function submitTrueNorth(
  ranking: DimensionId[],
): Promise<TrueNorthSubmitResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };

  try {
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      companion_xp?: number;
      gem_hits?: { dimension: string; gems: number }[];
    }>('/api/kit/true-north', { userId, ranking, localDate: localDateStr() });

    if (data.error === 'already_done_this_period') {
      return { ok: false, error: 'already_done' };
    }
    if (data.error === 'companion_not_initialized') {
      return { ok: false, error: 'companion_not_ready' };
    }
    if (data.error || !data.success) {
      return { ok: false, error: 'network' };
    }

    // Refresh cached status so the entry flips to "done this week".
    void fetchStatus();

    return {
      ok: true,
      companionXp: data.companion_xp ?? 0,
      gemHits: data.gem_hits ?? [],
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      return { ok: false, error: 'already_done' };
    }
    return { ok: false, error: 'network' };
  }
}
