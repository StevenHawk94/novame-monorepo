/**
 * Gems: the eight-dimension collection that drives the Me-tab portrait through
 * five stages. Decision record D3a / B3.
 *
 * A Reflect credits the prompt's own dimension first and always -- choosing the
 * "expression" prompt guarantees an expression hit, for free and paid alike.
 * Paid users add up to two more dimensions from AI analysis of the body, so a
 * paid Reflect credits at most three (prompt + 2 AI, deduped). Free users get
 * only the prompt dimension. The free-form prompt has no dimension: a free user
 * earns nothing from it, a paid user still gets whatever the AI finds.
 *
 * There is no per-dimension daily cap. Reflect is already limited to three
 * submissions a day, so a separate cap on how often a dimension can be credited
 * would be a redundant second limit -- three reflects on the same dimension
 * credit it three times, by design. This makes the function pure: its output
 * depends only on its inputs, never on today's history.
 *
 * The award per dimension is identical (+10) for both tiers. Paid buys breadth,
 * not a better rate (D3a). The system only adds; it never subtracts (no decay).
 */
import type { DimensionId } from '@novame/domain';

export const GEMS_PER_DIMENSION = 10;
export const MIN_CHARS_FOR_GEMS = 20;
export const MAX_DIMENSIONS_FREE = 1;
export const MAX_DIMENSIONS_PAID = 3;

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

/**
 * Gems awarded for one Reflect. Pure: no daily history, no database lookup.
 *
 *   - text under MIN_CHARS_FOR_GEMS earns nothing (D3c anti-spam)
 *   - the prompt dimension leads and is always credited first (both tiers)
 *   - paid adds AI dimensions, deduped against the prompt dimension
 *   - the combined list is capped at the tier's breadth (1 free, 3 paid)
 */
export function gemsForReflect(params: {
  charCount: number;
  promptDimension: DimensionId | null;   // null = the free-form prompt
  aiDimensions: DimensionId[];           // paid only; pass [] for free
  isPaid: boolean;
}): { total: number; credited: DimensionId[] } {
  const { charCount, promptDimension, aiDimensions, isPaid } = params;
  if (charCount < MIN_CHARS_FOR_GEMS) return { total: 0, credited: [] };

  const breadth = isPaid ? MAX_DIMENSIONS_PAID : MAX_DIMENSIONS_FREE;

  const ordered: DimensionId[] = [];
  if (promptDimension) ordered.push(promptDimension);
  if (isPaid) {
    for (const d of aiDimensions) {
      if (d !== promptDimension && !ordered.includes(d)) ordered.push(d);
    }
  }

  const credited = ordered.slice(0, breadth);
  return { total: credited.length * GEMS_PER_DIMENSION, credited };
}
