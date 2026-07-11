/**
 * Status gems state (Stage C3).
 *
 * Cache-first read of the eight-dimension gem totals, mirroring the
 * me-stats.ts / character-state.ts pattern: read MMKV synchronously for an
 * instant render, fetch from the server in the background, persist the result.
 *
 * Server authority: the API returns only the authoritative gem numbers. Stage
 * and the total are pure functions of those, computed here with the shared
 * engine (gemStage), so the same input always yields the same stage on client
 * and server -- no drift, no round-trip to "verify" a derived value.
 */
import type { DimensionId } from '@novame/domain';
import { DIMENSION_IDS } from '@novame/domain';

import { kStatusGems } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export type GemsByDimension = Record<DimensionId, number>;

function emptyGems(): GemsByDimension {
  const g = {} as GemsByDimension;
  for (const id of DIMENSION_IDS) g[id] = 0;
  return g;
}

/** Read the cached gems (all zeros if nothing cached yet). Synchronous. */
export function getCachedGems(): GemsByDimension {
  const raw = storage.getString(kStatusGems.name);
  if (!raw) return emptyGems();
  try {
    const parsed = JSON.parse(raw) as Partial<GemsByDimension>;
    const g = emptyGems();
    for (const id of DIMENSION_IDS) {
      if (typeof parsed[id] === 'number') g[id] = parsed[id] as number;
    }
    return g;
  } catch {
    return emptyGems();
  }
}

interface WireResponse {
  success?: boolean;
  dimensions?: Partial<Record<string, number>>;
  error?: string;
}

/**
 * Fetch the latest gems from the server and refresh the cache. Returns the
 * fresh gems, or the cached ones on failure (offline-tolerant). The screen
 * renders from cache first and swaps to this when it resolves.
 */
export async function fetchGems(): Promise<GemsByDimension> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedGems();

  try {
    const data = await apiClient.get<WireResponse>(
      `/api/status?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success || !data.dimensions) return getCachedGems();

    const fresh = emptyGems();
    for (const id of DIMENSION_IDS) {
      const v = data.dimensions[id];
      if (typeof v === 'number') fresh[id] = v;
    }
    storage.set(kStatusGems.name, JSON.stringify(fresh));
    return fresh;
  } catch {
    return getCachedGems();
  }
}

/** Total gems across all dimensions. */
export function totalGems(gems: GemsByDimension): number {
  let sum = 0;
  for (const id of DIMENSION_IDS) sum += gems[id];
  return sum;
}
