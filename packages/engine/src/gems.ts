/**
 * Gems: the eight-dimension collection that drives the Me-tab portrait through
 * five stages. Decision record D3a / D3c / B3.
 *
 * A Reflect credits the prompt's own dimension first and always -- choosing the
 * "expression" prompt guarantees an expression hit, for free and paid alike.
 * Paid users add up to two more dimensions from AI analysis of the body, so a
 * paid Reflect credits at most three (prompt + 2 AI, deduped). Free users get
 * only the prompt dimension. The free-form prompt has no dimension: a free user
 * earns nothing from it, a paid user still gets whatever the AI finds.
 *
 * The award per dimension is identical (+10) for both tiers. Paid buys breadth,
 * not a better rate (D3a, a deliberate fairness choice). The system only adds;
 * it never subtracts (no decay).
 */
import type { DimensionId } from '@novame/domain';

export const GEMS_PER_DIMENSION = 10;
export const MIN_CHARS_FOR_GEMS = 20;
export const SAME_DIMENSION_DAILY_CAP = 2;
export const MAX_DIMENSIONS_FREE = 1;
export const MAX_DIMENSIONS_PAID = 3;

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
 * Gems awarded for one Reflect.
 *
 *   - text under MIN_CHARS_FOR_GEMS earns nothing (D3c anti-spam)
 *   - the prompt dimension leads and is always credited first (both tiers)
 *   - paid adds AI dimensions, deduped against the prompt dimension
 *   - the combined list is capped at the tier's breadth (1 free, 3 paid)
 *   - a dimension already at SAME_DIMENSION_DAILY_CAP today is skipped (D3c)
 */
export function gemsForReflect(params: {
  charCount: number;
  promptDimension: DimensionId | null;   // null = the free-form prompt
  aiDimensions: DimensionId[];           // paid only; pass [] for free
  isPaid: boolean;
  priorCountsToday: Partial<Record<DimensionId, number>>;
}): { total: number; credited: DimensionId[] } {
  const { charCount, promptDimension, aiDimensions, isPaid, priorCountsToday } = params;
  if (charCount < MIN_CHARS_FOR_GEMS) return { total: 0, credited: [] };

  const breadth = isPaid ? MAX_DIMENSIONS_PAID : MAX_DIMENSIONS_FREE;

  // Prompt dimension leads; AI dimensions follow, deduped. Free users pass
  // aiDimensions: [] and get breadth 1, so this collapses to the prompt
  // dimension alone (or nothing, for the free-form prompt).
  const ordered: DimensionId[] = [];
  if (promptDimension) ordered.push(promptDimension);
  if (isPaid) {
    for (const d of aiDimensions) {
      if (d !== promptDimension && !ordered.includes(d)) ordered.push(d);
    }
  }

  const eligible = ordered.slice(0, breadth);
  const credited: DimensionId[] = [];
  for (const dim of eligible) {
    const prior = priorCountsToday[dim] ?? 0;
    if (prior < SAME_DIMENSION_DAILY_CAP) credited.push(dim);
  }
  return { total: credited.length * GEMS_PER_DIMENSION, credited };
}
