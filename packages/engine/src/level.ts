/**
 * Level is a pure function of accumulated XP. There is no level column and no
 * level event: given the same xp, every caller -- the Status screen, the
 * leaderboard, a server endpoint -- computes the same number, because they run
 * this same code. That is the whole point.
 *
 * v1 had no authoritative level at all. The mobile client derived one from a
 * curve in packages/core; the server sorted the leaderboard by the raw
 * total_exp integer and never computed a level. So "the player's level" had
 * two possible answers and no owner. This module is the owner.
 *
 * The XP argument is deliberately called `xp`, not `totalExp`: the v1 column
 * character_data.total_exp is not carried into v2.0 (decision D1), so binding
 * the function to that name would be a lie by Phase C.
 *
 * Curve (chosen for how cleanly it lands the skin unlocks on round levels):
 *
 *   xpToNext(lv) = 100 + 20 * (lv - 1)   for lv in 1..98
 *   xpToNext(99) = 0                      (cap)
 *
 * Skin thresholds 400 / 1300 / 3000 / 5600 fall on L4 / L8 / L14 / L20 --
 * asserted in level.test.ts, so a future curve change that knocks them out of
 * alignment fails a test rather than shipping a silent cosmetic mismatch.
 */

export const MAX_LEVEL = 99;

/** XP to advance FROM `level` to `level + 1`. Zero at the cap. */
export function xpToNext(level: number): number {
  if (level < 1) throw new RangeError(`level must be >= 1, got ${level}`);
  if (level >= MAX_LEVEL) return 0;
  return 100 + 20 * (level - 1);
}

/** Cumulative XP required to REACH `level` from zero. xpToReach(1) === 0. */
export function xpToReach(level: number): number {
  if (level < 1) throw new RangeError(`level must be >= 1, got ${level}`);
  let sum = 0;
  for (let lv = 1; lv < level && lv < MAX_LEVEL; lv++) sum += xpToNext(lv);
  return sum;
}

export interface LevelInfo {
  /** 1..99 */
  level: number;
  /** XP earned into the current level. */
  xpIntoLevel: number;
  /** XP needed to finish the current level. 0 at the cap. */
  xpForLevel: number;
  /** 0..1. Always 1 at the cap. */
  progress: number;
}

/** Resolve total accumulated XP into level + progress. Caps at 99. */
export function levelFromXp(xp: number): LevelInfo {
  if (!Number.isFinite(xp) || xp < 0) {
    return { level: 1, xpIntoLevel: 0, xpForLevel: xpToNext(1), progress: 0 };
  }
  let level = 1;
  let remaining = Math.floor(xp);
  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (remaining < need) {
      return { level, xpIntoLevel: remaining, xpForLevel: need, progress: remaining / need };
    }
    remaining -= need;
    level++;
  }
  return { level: MAX_LEVEL, xpIntoLevel: 0, xpForLevel: 0, progress: 1 };
}
