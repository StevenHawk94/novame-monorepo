import { storage } from './storage';
import { apiClient } from './api';
import { setAiConsentFromServer } from './ai-consent';
import { enqueueSkinUnlocks } from './skin-unlock-store';
import { getUnlockedOutfits } from '@novame/core';
import {
  type CharacterMode,
  type CharacterState,
  getCharacterState,
  WP_PLAY_DECAY_PER_HOUR,
  WP_STUDY_DECAY_PER_HOUR,
} from './constants';
import type { LevelInfo } from '@novame/core';

/**
 * Character state management for the Home tab (stage 3.6).
 *
 * Mirrors old Capacitor HomeView's pattern:
 *   1. On mount, read MMKV cached state for instant render.
 *   2. fetchCharacterState() in background to refresh from server.
 *   3. Local 30s WP decay tick for smooth visual without server hammering.
 *   4. Background refresh every 60s while Home is mounted.
 *
 * MMKV key: novame_character_state
 *
 * The server is the source of truth for level / EXP / outfits — local
 * mutations only apply to wp_visual (which the server overwrites on
 * the next fetch). This prevents the user from gaming the system by
 * tweaking local state.
 */

const STORAGE_KEY = 'novame_character_state';

// ---- defaults ----

/**
 * Default character state for a newly-signed-up user, used as an
 * instant placeholder by signing-in.tsx so the user can enter Home
 * with zero network wait. Mirrors the server's auto-created
 * character_data row (see /api/character-state ensureCharacterData):
 *   level=1, exp=0, current_outfit=1, unlocked_outfits=[1].
 *
 * `charName` is intentionally empty -- signing-in.tsx fills it from
 * MMKV onboarding state at write time (the user named the companion
 * during onboarding step 10).
 *
 * Stage 5.WR.2 (new-user instant-home pattern): replaces the prior
 * "show 'Loading...' speech bubble for 1-10s while character-state
 * round-trips" UX. New users see their real default values from frame
 * 1; the background fetch reconciles any server-side computed fields
 * (e.g. wp decay, AFK exp accumulation) within ~5s.
 */
export const DEFAULT_NEW_USER_CHARACTER_STATE: CachedCharacterState = {
  charId: 'char-1',
  charName: '',
  mode: 'play',
  wp: 0,
  wpLastFetchedAtMs: 0,
  outfit: 1,
  unlockedOutfits: [1],
  level: 1,
  expCurrent: 0,
  expNeeded: 20,
  totalExp: 0,
  afkStudySeconds: 0,
};

// ---- types matching apps/api/src/app/api/character-state/route.js GET shape ----

/**
 * Single row from character_data table augmented with computed fields
 * (level / exp / total_exp recomputed on the server during the GET).
 */
export type CharacterRow = {
  id: string;
  user_id: string;
  character_id: string;
  character_name: string;
  level: number;
  exp: number;
  total_exp: number;
  current_outfit: number;
  unlocked_outfits: number[];
  is_unlocked: boolean;
  total_recording_seconds: number;
  total_cards_created: number;
};

/**
 * Full payload from GET /api/character-state?userId=X.
 *
 * Field names match server response 1:1.
 */
export type CharacterStateResponse = {
  success: true;
  activeCharacterId: string;
  mode: CharacterMode;
  wp: number;
  character: CharacterRow | null;
  levelInfo: LevelInfo;
  allCharacters: CharacterRow[];
  /**
   * ISO timestamp when the user agreed to AI processing via the
   * in-app consent modal, or null if not yet agreed. Sourced from
   * profiles.ai_consent_at on the server. The mobile client mirrors
   * this into MMKV via setAiConsentFromServer so the gate check in
   * requireAiConsent is synchronous and survives offline use.
   */
  aiConsentAt: string | null;
  /**
   * Outfit numbers (2-6) whose unlock modal this user has already been
   * shown (DB-authoritative, from user_seen_skin_unlocks). Used to compute
   * which unlock modals still need to fire: getUnlockedOutfits(level) minus
   * this set minus outfit 1. Replaces the old MMKV lastShownLevel tracker.
   */
  seenSkinUnlocks: number[];
  /**
   * Accumulated WP>0 study seconds (profiles.afk_study_seconds) as of this
   * fetch — the exact counter study-claim settles as floor(secs/360) XP.
   * Lets the client compute the claim result locally for an instant modal,
   * reconciled by the authoritative postStudyClaim afterwards. 0 outside a
   * live/unsettled study session.
   */
  afkStudySeconds: number;
};

/**
 * Local cached subset used by Home tab render. Persisted to MMKV so
 * the next launch can render instantly without a network round-trip.
 *
 * The reason we don't cache the full server response: HomeView only
 * needs these fields, and a smaller blob means faster MMKV reads.
 */
export type CachedCharacterState = {
  /** Active character id, e.g. "char-1". */
  charId: string;
  /** Companion name set during onboarding step 10. */
  charName: string;
  /** Current mode driving the video state. */
  mode: CharacterMode;
  /** Last server-confirmed WP value (0-100). */
  wp: number;
  /** Server-side timestamp of the last WP write, used for local decay calc. */
  wpLastFetchedAtMs: number;
  /** Current outfit number 1-6. */
  outfit: number;
  /** Outfit numbers unlocked at the current level. */
  unlockedOutfits: number[];
  /** Current level. */
  level: number;
  /** EXP within the current level. */
  expCurrent: number;
  /** EXP needed to reach the next level. */
  expNeeded: number;
  /** Authoritative total lifetime EXP. Single source for optimistic math:
   * the client computes (level, expCurrent) via getLevelFromExp(totalExp),
   * the SAME function the server uses, so optimistic == server value. */
  totalExp: number;
  /** Accumulated WP>0 study seconds as of the last fetch. Mirrors
   * profiles.afk_study_seconds; used to compute the study-claim result
   * locally (floor(secs/360) XP). 0 outside a live/unsettled study session. */
  afkStudySeconds: number;
};

// ---- mmkv read / write ----

/**
 * Reads cached character state from MMKV. Returns null if no cache
 * exists (first launch after sign-in) or if the cached value is corrupt.
 */
/**
 * Computes the filename of the video the Home screen will play on its
 * FIRST frame, derived from the cached character state (charId / outfit
 * / mode / wp). Single source of truth shared by the Home tab's video
 * pick and the P0 asset gate (app/index.tsx), so the gate waits for the
 * exact clip the user is about to see — not a hard-coded default.
 *
 * Mirrors video-character.tsx's buildFilename + the Home tab's
 * getCharacterState(wpVisual, mode) logic.
 *
 * No cache (brand-new user / fresh install): defaults to
 * char1-outfit1-hungry.mp4 — outfit 1 + wp 0 -> 'hungry' — which is a
 * bucket-root P0 asset already guaranteed present, so the gate passes
 * instantly for new users.
 */
export function getHomeVideoFilename(): string {
  const cached = getCachedCharacterState();
  const charId = cached?.charId ?? 'char-1';
  const outfit = cached?.outfit ?? 1;
  const mode: CharacterMode = cached?.mode ?? 'play';
  const wp = cached?.wp ?? 0;
  const state: CharacterState = getCharacterState(wp, mode);
  const charNum = charId.replace('char-', '');
  return `char${charNum}-outfit${outfit}-${state}.mp4`;
}

export function getCachedCharacterState(): CachedCharacterState | null {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedCharacterState;
  } catch {
    return null;
  }
}

/**
 * Persists character state to MMKV cache.
 */
export function setCachedCharacterState(state: CachedCharacterState): void {
  storage.set(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Clears cached character state (sign-out, account switch, etc.).
 */
export function clearCachedCharacterState(): void {
  storage.remove(STORAGE_KEY);
}

// ---- server fetch ----

/**
 * Fetches the current character state from the server, persists it to
 * MMKV cache, and returns the resulting CachedCharacterState.
 *
 * Throws on network or HTTP errors. Caller is responsible for
 * surfacing the error to the user (typically a silent retry suffices
 * since stale cached state still works).
 */
export async function fetchCharacterState(
  userId: string,
): Promise<CachedCharacterState> {
  const data = await apiClient.get<CharacterStateResponse>(
    `/api/character-state?userId=${encodeURIComponent(userId)}`,
  );
  if (!data.success) {
    throw new Error('character-state GET returned non-success');
  }
  const next = mapResponseToCache(data);
  setCachedCharacterState(next);
  // Mirror server-side ai_consent_at into MMKV so the synchronous
  // requireAiConsent gate stays current across devices (user agrees
  // on iPhone -> next character-state fetch on iPad picks it up and
  // writes its own MMKV).
  setAiConsentFromServer(data.aiConsentAt);

    // Skin-unlock detection (DB-authoritative). The set of outfits that
    // SHOULD have an unlock modal = getUnlockedOutfits(level) minus outfit 1
    // (default skin, never notified). Subtract the server's seenSkinUnlocks
    // (already shown for this user, persisted in user_seen_skin_unlocks) to
    // get those still pending. This survives re-login / cache clear, fixing
    // the old MMKV-tracker bug that re-fired the whole backlog every login.
    try {
      const seen = new Set(data.seenSkinUnlocks ?? []);
      const pending = getUnlockedOutfits(next.level).filter(
        (n) => n !== 1 && !seen.has(n),
      );
      if (pending.length > 0) {
        enqueueSkinUnlocks(pending);
      }
    } catch (e) {
      // Non-fatal: a detection error must not break the data fetch.
      console.warn('[character-state] skin unlock detection failed:', e);
    }

  return next;
}

/**
 * Stage 6 publish-side prefetch (Wisdom Insight 3-bug series Layer 1).
 *
 * Combines clear + immediate fetch. Used by record.tsx publish success
 * path so Home tab's EXP banner / WP / level / outfit reflect the
 * post-publish character_data state immediately when the user returns.
 *
 * Note: fetchCharacterState already does write-through to MMKV, so the
 * "clear" step here is mostly defensive — it ensures a stale cache
 * doesn't briefly render between clear-then-fetch if a consumer reads
 * mid-flight (it won't, since this is fire-and-forget, but explicit
 * matches the pattern of other refresh* helpers).
 *
 * fire-and-forget safe: never throws.
 */
export async function refreshCharacterState(userId: string): Promise<void> {
  try {
    await fetchCharacterState(userId);
  } catch (e) {
    console.warn('[refreshCharacterState]', e);
  }
}

/**
 * Internal mapper from server response to local cache shape.
 */
function mapResponseToCache(data: CharacterStateResponse): CachedCharacterState {
  return {
    charId: data.activeCharacterId,
    charName: data.character?.character_name ?? '',
    mode: data.mode,
    wp: data.wp,
    wpLastFetchedAtMs: Date.now(),
    outfit: data.character?.current_outfit ?? 1,
    unlockedOutfits: data.character?.unlocked_outfits ?? [1],
    level: data.levelInfo.level,
    expCurrent: data.levelInfo.currentExp,
    expNeeded: data.levelInfo.expNeeded,
    totalExp: data.levelInfo.totalExp,
    afkStudySeconds: data.afkStudySeconds ?? 0,
  };
}

// ---- local WP decay (visual only) ----

/**
 * Computes the current visual WP value given the last-fetched WP plus
 * elapsed time since fetch. Used by Home tab to animate the WP bar
 * smoothly without polling the server every second.
 *
 * Returns the computed WP rounded to 1 decimal place (matching the
 * old HomeView behavior).
 *
 * The server overwrites this on the next /api/character-state call,
 * so any drift is corrected within ~60 seconds.
 */
export function applyLocalWPDecay(
  cachedWP: number,
  mode: CharacterMode,
  fetchedAtMs: number,
  nowMs: number = Date.now(),
): number {
  if (cachedWP <= 0) return 0;
  const elapsedHours = Math.max(0, (nowMs - fetchedAtMs) / 3600000);
  const decayPerHour =
    mode === 'study' ? WP_STUDY_DECAY_PER_HOUR : WP_PLAY_DECAY_PER_HOUR;
  const next = cachedWP - elapsedHours * decayPerHour;
  return Math.max(0, Math.round(next * 10) / 10);
}

// ---- POST actions ----

/**
 * Switches the active outfit. Server-side validates the outfit is
 * unlocked. Throws on rejection (e.g. trying to wear an unlocked
 * outfit, network error).
 *
 * On success, refetches state to update the local cache.
 */
export async function switchOutfit(
  userId: string,
  outfitNum: number,
): Promise<CachedCharacterState> {
  // NB: server destructures `const { outfitNum } = body` -- field name
  // must match exactly or the server silently writes undefined.
  await apiClient.post('/api/character-state', {
    userId,
    action: 'switch_outfit',
    outfitNum,
  });
  return fetchCharacterState(userId);
}

/**
 * Marks a skin-unlock modal as seen for this user so it never fires again
 * (persisted in user_seen_skin_unlocks; survives re-login / cache clear).
 * Fire-and-forget: errors are swallowed -- worst case the modal reappears on
 * a later fetch, which is the pre-fix behavior, not a regression.
 */
export async function markSkinSeen(
  userId: string,
  outfitNum: number,
): Promise<void> {
  try {
    await apiClient.post('/api/character-state', {
      userId,
      action: 'mark_skin_seen',
      outfitNum,
    });
  } catch (e) {
    console.warn('[character-state] markSkinSeen failed:', e);
  }
}

/**
 * Switches the character mode (play / study). Server enforces the
 * "WP must be > 0" constraint. Throws if the server rejects.
 *
 * On success, refetches state to update the local cache.
 */
export async function switchMode(
  userId: string,
  mode: CharacterMode,
): Promise<CachedCharacterState> {
  await apiClient.post('/api/character-state', {
    userId,
    action: 'switch_mode',
    mode,
  });
  return fetchCharacterState(userId);
}
