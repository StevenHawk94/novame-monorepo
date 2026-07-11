/**
 * Reflect submission + local cache.
 *
 * submitReflect posts to /api/reflect, which computes the numbers with the
 * engine and writes them through the submit_reflect RPC, then returns a
 * complete snapshot. We adopt that snapshot as-is (server authority): the cache
 * is a read-only shadow of what the server returned, never a local computation.
 *
 * The cache (kReflectState) holds today's count so the screen can show
 * "N left today" and block a fourth attempt before a round-trip. It is only a
 * fast-path for the UI -- the real limit is the RPC's daily gate, which checks
 * the database under a lock. A stale cache at worst mis-renders for one submit,
 * which the next server response corrects.
 */
import { ApiError } from '@novame/api-client';

import { apiClient } from './api';

import { kReflectState } from '../shared/storage/keys';
import { storage } from './storage';
import { supabase } from './supabase';

const DAILY_LIMIT = 3;

export interface DimensionHit {
  dimension: string;
  gems: number;
}

/** The snapshot /api/reflect returns; the client renders it directly. */
export interface ReflectSnapshot {
  reflectId: string;
  xpAwarded: number;
  dimensionHits: DimensionHit[];
  companionXp: number;
  reflectsToday: number;
  reflectsRemaining: number;
}

export type ReflectError =
  | 'daily_limit' // already reflected 3 times today
  | 'companion_not_ready' // no companion row (should not happen post-onboarding)
  | 'too_long' // body over 5000 chars
  | 'empty' // nothing typed
  | 'network'; // request failed / server error

export type SubmitResult =
  | { ok: true; snapshot: ReflectSnapshot }
  | { ok: false; error: ReflectError };

interface CachedState {
  date: string; // YYYY-MM-DD (device-local) this count belongs to
  reflectsToday: number;
  lastSnapshot?: ReflectSnapshot;
}

/** Device-local YYYY-MM-DD. The daily boundary follows the user's own day. */
function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readCache(): CachedState | null {
  const raw = storage.getString(kReflectState.name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedState;
  } catch {
    return null;
  }
}

function writeCache(state: CachedState): void {
  storage.set(kReflectState.name, JSON.stringify(state));
}

/**
 * Today's reflect count for the UI. Resets across a day boundary: a cache from
 * a previous date reads as zero today, so the screen re-opens fresh each day
 * without any server call.
 */
export function getReflectStateToday(): {
  reflectsToday: number;
  reflectsRemaining: number;
} {
  const cache = readCache();
  const today = localDateStr();
  const count = cache && cache.date === today ? cache.reflectsToday : 0;
  return {
    reflectsToday: count,
    reflectsRemaining: Math.max(0, DAILY_LIMIT - count),
  };
}

/** Wire shape from /api/reflect (snake_case from the RPC snapshot). */
interface WireSnapshot {
  success?: boolean;
  error?: string;
  reflect_id?: string;
  xp_awarded?: number;
  dimension_hits?: DimensionHit[];
  companion_xp?: number;
  reflects_today?: number;
  reflects_remaining?: number;
}

function toSnapshot(w: WireSnapshot): ReflectSnapshot {
  return {
    reflectId: w.reflect_id ?? '',
    xpAwarded: w.xp_awarded ?? 0,
    dimensionHits: w.dimension_hits ?? [],
    companionXp: w.companion_xp ?? 0,
    reflectsToday: w.reflects_today ?? 0,
    reflectsRemaining: w.reflects_remaining ?? 0,
  };
}

/**
 * Submit one Reflect. Returns the server snapshot on success, or a typed error
 * the screen maps to a message. Refreshes the local count cache from whichever
 * the server reports -- success or daily_limit both carry the true count.
 */
export async function submitReflect(params: {
  promptId: number;
  body: string;
  /** New Lens routes here with the theme's dimension + a source tag. */
  presetDimension?: string;
  sourceKit?: 'new_lens';
}): Promise<SubmitResult> {
  const body = params.body.trim();
  if (body.length === 0) return { ok: false, error: 'empty' };
  if (body.length > 5000) return { ok: false, error: 'too_long' };

  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };

  const today = localDateStr();

  try {
    const data = await apiClient.post<WireSnapshot>('/api/reflect', {
      userId,
      promptId: params.promptId,
      body,
      localDate: today,
      presetDimension: params.presetDimension,
      sourceKit: params.sourceKit,
    });

    if (data.error === 'daily_limit_reached') {
      writeCache({ date: today, reflectsToday: DAILY_LIMIT });
      return { ok: false, error: 'daily_limit' };
    }
    if (data.error === 'companion_not_initialized') {
      return { ok: false, error: 'companion_not_ready' };
    }
    if (data.error || !data.success) {
      return { ok: false, error: 'network' };
    }

    const snapshot = toSnapshot(data);
    writeCache({
      date: today,
      reflectsToday: snapshot.reflectsToday,
      lastSnapshot: snapshot,
    });
    return { ok: true, snapshot };
  } catch (e) {
    // ApiError with a 409 carries the daily-limit body; other codes are network.
    if (e instanceof ApiError && e.status === 409) {
      writeCache({ date: today, reflectsToday: DAILY_LIMIT });
      return { ok: false, error: 'daily_limit' };
    }
    return { ok: false, error: 'network' };
  }
}
