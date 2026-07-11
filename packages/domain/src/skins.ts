/**
 * Companion skin unlock thresholds. Six forms per companion:
 *
 *   index 0  default ("none")   -- always available, the bare adult form
 *   index 1  400 xp
 *   index 2  1,300 xp
 *   index 3  3,000 xp
 *   index 4  5,600 xp
 *   index 5  subscription       -- granted on subscribe, no xp gate
 *
 * The four xp thresholds land on levels 4 / 8 / 14 / 20 under the engine's
 * A-curve; that alignment is asserted in @novame/engine's level.test.ts.
 *
 * Filenames are not here. Whether it is `deer-none-sleep.mp4` or
 * `deer-skin0-sleep.mp4` is decided by the art delivery, and assetName() (a
 * later commit) will map a skin index to whatever the R2 manifest contains.
 */

export const SKIN_XP_THRESHOLDS = [400, 1300, 3000, 5600] as const;
export const SKIN_COUNT = 6;

export type SkinUnlock =
  | { kind: 'default' }
  | { kind: 'xp'; xp: number }
  | { kind: 'subscription' };

export const SKIN_UNLOCKS: readonly SkinUnlock[] = [
  { kind: 'default' },
  { kind: 'xp', xp: 400 },
  { kind: 'xp', xp: 1300 },
  { kind: 'xp', xp: 3000 },
  { kind: 'xp', xp: 5600 },
  { kind: 'subscription' },
];

/** How many of the six forms a companion has unlocked. */
export function unlockedSkinCount(xp: number, isSubscribed: boolean): number {
  let n = 1; // default form
  for (const t of SKIN_XP_THRESHOLDS) if (xp >= t) n++;
  if (isSubscribed) n++;
  return Math.min(n, SKIN_COUNT);
}
