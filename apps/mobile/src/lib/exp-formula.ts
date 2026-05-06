/**
 * EXP / level formula — mirrors apps/api/src/app/api/character-state/route.js
 * and apps/api/src/app/api/daily-tasks/route.js exactly.
 *
 * Used client-side for optimistic level-up animation after task complete
 * or study claim, so we know how much EXP fills the bar BEFORE the
 * server response lands. Server is still the source of truth.
 */

export function getExpNeeded(lv: number): number {
  if (lv <= 5) return 20 + (lv - 1) * 5;
  if (lv <= 15) return Math.round(50 + (lv - 6) * 4.44);
  if (lv <= 25) return Math.round(120 + (lv - 16) * 8.89);
  if (lv <= 40) return Math.round(220 + (lv - 26) * 12.86);
  if (lv <= 50) return Math.round(420 + (lv - 41) * 13.33);
  if (lv <= 90) return 800;
  return 1000;
}

export type LevelInfo = {
  level: number;
  currentExp: number;
  expNeeded: number;
  totalExp: number;
};

export function getLevelFromExp(totalExp: number): LevelInfo {
  let remaining = totalExp;
  for (let lv = 1; lv <= 99; lv++) {
    const needed = getExpNeeded(lv);
    if (remaining < needed) {
      return { level: lv, currentExp: remaining, expNeeded: needed, totalExp };
    }
    remaining -= needed;
  }
  return { level: 99, currentExp: 0, expNeeded: 0, totalExp };
}
