/**
 * Gems: the eight-dimension collection that drives the Me-tab portrait through
 * five stages. Decision record D3a / B3.
 *
 * Reflect no longer analyzes or credits growth dimensions. The remaining gem
 * constants and stage helper are retained for legacy Focus/kit features that
 * still store dimension-based rewards.
 */
export const GEMS_PER_DIMENSION = 10;

// Six stages per PRD §1.2 and the 2026-07 ruling (Q12): 探索 0-500, 成长
// 501-2000, 成熟 2001-4000, 自信 4001-6000, 超我 6001-9999, 完全体 10000+.
// A total sitting exactly on a bound belongs to the LOWER stage (0-500 is
// stage 1), so the comparison is strict. Stage 6 is the visual cap — the
// portrait stops changing but the number keeps climbing.
export const GEM_STAGE_BOUNDS = [500, 2000, 4000, 6000, 9999] as const;
export const GEM_STAGE_COUNT = 6;

/** Which of the six portrait stages a gem total sits in (1..6). */
export function gemStage(totalGems: number): number {
  let stage = 1;
  for (const bound of GEM_STAGE_BOUNDS) {
    if (totalGems > bound) stage++;
  }
  return Math.min(stage, GEM_STAGE_COUNT);
}
