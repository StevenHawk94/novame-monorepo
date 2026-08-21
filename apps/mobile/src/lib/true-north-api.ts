/**
 * True North: rolling seven-day ranking status, submission, and reveal.
 *
 * Unlike the daily Kits, True North's entry is permanent. During its cooldown
 * it shows the latest result instead of re-ranking, so the client needs the
 * cooldown expiry and recent rankings. Those come
 * from /api/kit/true-north/status and are cached for an instant entry state.
 *
 * The rolling gate is server-side; the cache is only a display shadow.
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
  nextAvailableAt: string | null;
}

export type TrueNorthError = 'already_done' | 'companion_not_ready' | 'network';

export type TrueNorthSubmitResult =
  | { ok: true; companionXp: number; xpAwarded: number; gemHits: { dimension: string; gems: number }[] }
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
  nextAvailableAt: null,
};

export function getCachedStatus(): TrueNorthStatus {
  const raw = storage.getString(kTrueNorthState.name);
  if (!raw) return EMPTY;
  try {
    const parsed = { ...EMPTY, ...(JSON.parse(raw) as Partial<TrueNorthStatus>) };
    // Old ISO-week caches have no rolling expiry and must not keep the feature
    // locked. The screen will reconcile them from the server on entry.
    if (!parsed.nextAvailableAt || new Date(parsed.nextAvailableAt).getTime() <= Date.now()) {
      return {
        ...parsed,
        doneThisWeek: false,
        thisWeekRanking: null,
        lastRanking: parsed.thisWeekRanking ?? parsed.lastRanking,
        nextAvailableAt: null,
      };
    }
    return parsed;
  } catch {
    return EMPTY;
  }
}

function cacheStatus(s: TrueNorthStatus): void {
  storage.set(kTrueNorthState.name, JSON.stringify(s));
}

/** Fetch the rolling cooldown status from the server, refreshing the cache. */
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
      nextAvailableAt?: string | null;
    }>(`/api/kit/true-north/status?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`);

    if (!data.success) return getCachedStatus();
    const status: TrueNorthStatus = {
      weekKey: data.weekKey ?? '',
      doneThisWeek: data.doneThisWeek ?? false,
      thisWeekRanking: data.thisWeekRanking ?? null,
      lastRanking: data.lastRanking ?? null,
      nextAvailableAt: data.nextAvailableAt ?? null,
    };
    cacheStatus(status);
    return status;
  } catch {
    return getCachedStatus();
  }
}

/** Submit a ranking (8 dimensions, best first). */
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
      xp_awarded?: number;
      gem_hits?: { dimension: string; gems: number }[];
      nextAvailableAt?: string | null;
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

    // Confirm the rolling cooldown synchronously so the Companion entry is
    // correct even before the background verification returns.
    const previous = getCachedStatus();
    cacheStatus({
      weekKey: '',
      doneThisWeek: true,
      thisWeekRanking: ranking,
      lastRanking: previous.thisWeekRanking ?? previous.lastRanking,
      nextAvailableAt: data.nextAvailableAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    void fetchStatus();
    return {
      ok: true,
      companionXp: data.companion_xp ?? 0,
      xpAwarded: data.xp_awarded ?? 0,
      gemHits: data.gem_hits ?? [],
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      return { ok: false, error: 'already_done' };
    }
    return { ok: false, error: 'network' };
  }
}
