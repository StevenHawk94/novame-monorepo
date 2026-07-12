/**
 * Companion state for Home and the interaction sheet.
 *
 * Cache-first like the other reads: render the cached companion instantly,
 * refresh from /api/companion in the background. The server returns the
 * authoritative xp; level and progress are derived here with the shared engine
 * (levelFromXp), never stored -- same input, same result on client and server.
 */
import { levelFromXp, type LevelInfo } from '@novame/engine';

import { kCompanionState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export type CompanionId = 'pet1' | 'pet2' | 'pet3';

export interface CompanionState {
  companionId: CompanionId;
  name: string | null;
  stage: string; // 'juvenile' | 'adult'
  xp: number;
  activeSkin: string;
}

export function getCachedCompanion(): CompanionState | null {
  const raw = storage.getString(kCompanionState.name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CompanionState;
  } catch {
    return null;
  }
}

interface WireResponse {
  success?: boolean;
  found?: boolean;
  companion?: {
    companionId: CompanionId;
    name: string | null;
    stage: string;
    xp: number;
    activeSkin: string;
  };
}

/**
 * Fetch the companion from the server, refreshing the cache. Returns the fresh
 * state, the cached one on failure, or null if the user has no companion yet.
 */
export async function fetchCompanion(): Promise<CompanionState | null> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedCompanion();

  try {
    const data = await apiClient.get<WireResponse>(
      `/api/companion?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success || !data.found || !data.companion) return getCachedCompanion();

    const state: CompanionState = {
      companionId: data.companion.companionId,
      name: data.companion.name,
      stage: data.companion.stage,
      xp: data.companion.xp,
      activeSkin: data.companion.activeSkin,
    };
    storage.set(kCompanionState.name, JSON.stringify(state));
    return state;
  } catch {
    return getCachedCompanion();
  }
}

/** The companion's level + progress from its xp (pure, engine-derived). */
export function companionLevel(state: CompanionState): LevelInfo {
  return levelFromXp(state.xp);
}
