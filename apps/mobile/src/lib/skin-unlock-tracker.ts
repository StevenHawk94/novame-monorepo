/**
 * Skin unlock tracker (Stage 5.WR.2, Bug 3).
 *
 * Tracks which outfit-unlock thresholds the user has already been
 * notified about, so we don't show the same SkinUnlockModal repeatedly
 * across renders / refresh cycles.
 *
 * Persistence is MMKV (per-device, scoped to current user by being
 * cleared on SIGNED_OUT — see _layout.tsx).
 *
 * Trigger model:
 *   1. fetchCharacterState() pulls current level from server.
 *   2. This lib computes which OUTFIT_UNLOCK_LEVELS thresholds were
 *      crossed between `lastShownLevel` (in MMKV) and `currentLevel`.
 *   3. If newly-crossed thresholds exist, the lib *immediately* writes
 *      `currentLevel` to MMKV — BEFORE the modal renders. This prevents
 *      the next refresh cycle (60s setInterval / focus refetch) from
 *      detecting the same delta a second time.
 *      Worst case if the user crashes mid-render: they lose the modal
 *      for that one cross, but don't get a repeat loop on relaunch.
 *   4. The caller (skin-unlock-store) reads the returned outfit numbers
 *      and enqueues SkinUnlockModal renders.
 *
 * Race-safety: if two fetchCharacterState calls happen back-to-back
 * (e.g., focus + 60s tick), the second one sees the updated
 * lastShownLevel via getString() and returns [].
 */

import { OUTFIT_UNLOCK_LEVELS } from './constants';
import { storage } from './storage';

const MMKV_KEY = 'novame_last_skin_unlock_shown_level';

/**
 * Reads the highest level for which an unlock modal has already shown.
 * Default 0 = brand-new account, no modal has ever fired.
 */
function getLastShownLevel(): number {
  try {
    const raw = storage.getString(MMKV_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Internal writer — called by detectNewlyUnlockedOutfits when newly-
 * unlocked outfits are found. Not exposed to callers.
 */
function setLastShownLevel(level: number): void {
  try {
    storage.set(MMKV_KEY, String(level));
  } catch {
    // best-effort; if MMKV is unavailable the user will see a repeat
    // modal next refresh — annoying but not broken.
  }
}

/**
 * Clears the tracker. Called by _layout.tsx on SIGNED_OUT so the next
 * user starting fresh on the same device doesn't inherit prior state.
 */
export function clearSkinUnlockTracker(): void {
  try {
    storage.remove(MMKV_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Given the user's current level, returns the list of outfit numbers
 * (1-6) that have newly unlocked since the last shown level.
 *
 * Side effect: writes `currentLevel` to MMKV if newly-unlocked outfits
 * are found, so subsequent calls return [] until level advances again.
 *
 * Example:
 *   - lastShownLevel = 4
 *   - currentLevel = 22
 *   - OUTFIT_UNLOCK_LEVELS = [1, 5, 10, 20, 30, 50]
 *   - Crossed thresholds: 5 (outfit 2), 10 (outfit 3), 20 (outfit 4)
 *   - Returns: [2, 3, 4]
 *   - MMKV now stores "22"
 *
 * Returns [] (and writes nothing) if no new outfits unlocked.
 */
export function detectNewlyUnlockedOutfits(currentLevel: number): number[] {
  const lastShown = getLastShownLevel();
  if (currentLevel <= lastShown) return [];

  const newOutfits: number[] = [];
  // Stage 5.WR.2 (Bug A fix): start from i=1, not i=0.
  // OUTFIT_UNLOCK_LEVELS[0] = 1 corresponds to outfit 1, which is the
  // default character every new user starts with. There is no unlock
  // event for it — modal should only fire for outfits 2-6.
  for (let i = 1; i < OUTFIT_UNLOCK_LEVELS.length; i++) {
    const threshold = OUTFIT_UNLOCK_LEVELS[i];
    // Outfit (i+1) unlocks at threshold. Newly unlocked iff strictly
    // greater than lastShown AND <= currentLevel.
    if (threshold > lastShown && threshold <= currentLevel) {
      newOutfits.push(i + 1);
    }
  }

  if (newOutfits.length > 0) {
    setLastShownLevel(currentLevel);
  }
  return newOutfits;
}
