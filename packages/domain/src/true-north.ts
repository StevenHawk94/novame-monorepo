/**
 * True North identity phrases (C5). One per dimension, shown on the ranking
 * cards: the user orders them by "what matters most right now". Phrases are
 * fixed and live here; ranking them is a weekly ritual that credits gems to
 * the top three.
 *
 * The reveal interprets only the first and last, and compares to last week's
 * ranking when there is one -- both handled client-side from these labels.
 */
import type { DimensionId } from './dimensions';

export const TRUE_NORTH_PHRASES: Record<DimensionId, string> = {
  expression: 'Speaking my truth',
  awareness:  'Understanding myself',
  momentum:   'Getting things done',
  direction:  'Knowing what I want',
  steadiness: 'Staying grounded',
  confidence: 'Trusting myself',
  gratitude:  'Appreciating what I have',
  connection: 'Showing up for people I love',
};

/** Gems for a rank (1-based). Top three only: +50 / +30 / +10, else 0. */
export const TRUE_NORTH_GEMS_BY_RANK: readonly number[] = [50, 30, 10];

/**
 * The gem hits for a ranking (array of dimension ids, best first). Returns the
 * top-three as [{dimension, gems}], the shape submit_kit expects. Pure -- the
 * API calls this and hands the result to the RPC.
 */
export function trueNorthGemHits(
  ranking: DimensionId[],
): { dimension: DimensionId; gems: number }[] {
  const hits: { dimension: DimensionId; gems: number }[] = [];
  for (let i = 0; i < TRUE_NORTH_GEMS_BY_RANK.length && i < ranking.length; i++) {
    hits.push({ dimension: ranking[i], gems: TRUE_NORTH_GEMS_BY_RANK[i] });
  }
  return hits;
}
