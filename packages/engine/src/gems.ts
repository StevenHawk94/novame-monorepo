/**
 * Gems: the eight-dimension collection that drives the Me-tab portrait through
 * five stages. Decision record D3a / D3c / B3.
 *
 * A Reflect awards gems by matching its text to dimensions. Free users match
 * one dimension per Reflect, paid up to two -- but the award per dimension is
 * identical (+10). Paid buys breadth, not a better rate (D3a, a deliberate
 * fairness choice). The system only adds; it never subtracts (no decay).
 */
import type { DimensionId } from '@novame/domain';

export const GEMS_PER_DIMENSION = 10;
export const MIN_CHARS_FOR_GEMS = 20;
export const SAME_DIMENSION_DAILY_CAP = 2;
export const MAX_DIMENSIONS_FREE = 1;
export const MAX_DIMENSIONS_PAID = 2;

// Upper bound of each stage. Stage 5 is unbounded -- the portrait caps visually
// but the number keeps climbing. Decision record B3 (lines 99-104).
export const GEM_STAGE_BOUNDS = [600, 2000, 4500, 9000] as const;
export const GEM_STAGE_COUNT = 5;

/** Which of the five portrait stages a gem total sits in (1..5). */
export function gemStage(totalGems: number): number {
  let stage = 1;
  for (const bound of GEM_STAGE_BOUNDS) {
    if (totalGems >= bound) stage++;
  }
  return Math.min(stage, GEM_STAGE_COUNT);
}

/**
 * Gems awarded for one Reflect, given the dimensions it matched and how many
 * times each was already credited today.
 *
 *   - text under MIN_CHARS_FOR_GEMS earns nothing (D3c anti-spam)
 *   - a dimension already at SAME_DIMENSION_DAILY_CAP today earns nothing (D3c)
 *   - matched dimensions are truncated to the tier's breadth (D3a)
 */
export function gemsForReflect(params: {
  charCount: number;
  matchedDimensions: DimensionId[];
  isPaid: boolean;
  priorCountsToday: Partial<Record<DimensionId, number>>;
}): { total: number; credited: DimensionId[] } {
  const { charCount, matchedDimensions, isPaid, priorCountsToday } = params;
  if (charCount < MIN_CHARS_FOR_GEMS) return { total: 0, credited: [] };

  const breadth = isPaid ? MAX_DIMENSIONS_PAID : MAX_DIMENSIONS_FREE;
  const eligible = matchedDimensions.slice(0, breadth);

  const credited: DimensionId[] = [];
  for (const dim of eligible) {
    const prior = priorCountsToday[dim] ?? 0;
    if (prior < SAME_DIMENSION_DAILY_CAP) credited.push(dim);
  }
  return { total: credited.length * GEMS_PER_DIMENSION, credited };
}
