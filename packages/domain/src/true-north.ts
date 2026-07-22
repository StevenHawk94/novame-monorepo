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

/** Gems for a rank (1-based). Top three only: +30 / +20 / +10, else 0.
 *  (PRD §1.2 — was 50/30/10 before the v2.0 economy pass.) */
export const TRUE_NORTH_GEMS_BY_RANK: readonly number[] = [30, 20, 10];

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

/**
 * Reveal-page content (design: true north result.png). The #1-ranked
 * dimension surfaces its FOCUS list ("What matters to you most"); the
 * LAST-ranked dimension surfaces its RELEASE list ("What you should forgive
 * and forget"). PLACEHOLDER copy — product will retune wording.
 */
export const TRUE_NORTH_FOCUS_POINTS: Record<DimensionId, string[]> = {
  expression: ['Speaking honestly', 'Sharing your thoughts', 'Being heard', 'Hard conversations', 'Saying no clearly', 'Finding your voice', 'Emotional honesty', 'Standing by your words', 'Asking for what you need', 'Telling your story'],
  awareness: ['Understanding yourself', 'Noticing patterns', 'Quiet self-check-ins', 'Naming feelings', 'Untangling thoughts', 'Honest reflection', 'Catching spirals early', 'Seeing both sides', 'Slowing down to look', 'Learning from your days'],
  momentum: ['Completing important tasks', 'Building momentum', 'Making progress', 'Career growth', 'Time management', 'Deep work', 'Creating results', 'Overcoming procrastination', 'Taking action', 'Staying consistent'],
  direction: ['Knowing what you want', 'Setting a course', 'Choosing priorities', 'Long-term goals', 'Meaningful work', 'Saying no to drift', 'Planning next steps', 'Living by your values', 'Future you', 'Purpose over noise'],
  steadiness: ['Staying calm under pressure', 'Grounding routines', 'Steady breathing', 'Weathering hard days', 'Emotional balance', 'Rest without guilt', 'Slow mornings', 'Letting waves pass', 'Keeping your footing', 'A quiet center'],
  confidence: ['Trusting yourself', 'Owning your wins', 'Trying without guarantees', 'Standing your ground', 'Feeling enough', 'Backing your decisions', 'Quiet certainty', 'Bouncing back', 'Asking for more', 'Self-respect'],
  gratitude: ['Noticing small joys', 'Savoring good moments', 'Saying thank you', 'Simple pleasures', 'Appreciating people', 'Ordinary magic', 'Counting the good', 'Warm little rituals', 'Enough as plenty', 'Being present for it'],
  connection: ['Taking care of yourself', 'Showing up for people', 'Real listening', 'Small kindnesses', 'Time with loved ones', 'Reaching out first', 'Letting people in', 'Repairing quickly', 'Shared moments', 'Being there'],
};

export const TRUE_NORTH_RELEASE_POINTS: Record<DimensionId, string[]> = {
  expression: ['Sharing your thoughts', 'Being understood', 'Finding your voice', 'Emotional honesty'],
  awareness: ['Analyzing everything', 'Re-reading the past', 'Perfect self-knowledge', 'Fixing every flaw'],
  momentum: ['Doing it all today', 'Constant productivity', 'Never resting', 'Racing everyone'],
  direction: ['Having it all figured out', 'The perfect plan', 'Comparing paths', 'Rushing the answer'],
  steadiness: ['Controlling everything', 'Never feeling shaken', 'Instant calm', 'Hiding every wobble'],
  confidence: ['Everyone approving', 'Never doubting', 'Being impressive', 'Winning every room'],
  gratitude: ['Forcing positivity', 'Ranking your joys', 'Perfect contentment', 'Guilt about wanting more'],
  connection: ['Pleasing everyone', 'Being needed always', 'Fixing other people', 'Never disappointing anyone'],
};
