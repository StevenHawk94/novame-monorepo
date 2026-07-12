/**
 * Skill dedup (test-phase, keyword-overlap). The load-bearing wall in a simpler
 * form: two skills are "the same lesson" if their keyword sets overlap past a
 * threshold (Jaccard). This catches reworded-but-same lessons that share
 * vocabulary ("rest is recovery" / "recovery needs rest") but NOT ones with
 * disjoint wording ("slow down when tired" / "breaks make me stronger") -- that
 * gap is what the pgvector embedding upgrade closes before launch.
 *
 * Kept pure and swappable: generation calls findDuplicate against the user's
 * existing skills; a non-null result means discard. Threshold 0.35 sits in the
 * wide gap the fixtures show between real duplicates (>=0.40) and genuinely new
 * lessons (0.00), so it's not sensitive.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'no',
  'my', 'your', 'it', 'its', 'this', 'that', 'i', 'you', 'me', 'we', 'they',
  'can', 'could', 'should', 'would', 'will', 'just', 'so', 'than', 'then',
  'when', 'if', 'as', 'from', 'by', 'myself', "i'm", 'im', 'about',
  'more', 'less', 'too', 'very', 'really',
]);

export interface SkillLike {
  text: string;
}

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[\u2019\u2018\u0060\u00b4]/g, "'")
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ing|ed|s)$/, '')) // crude stem
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const SKILL_DEDUP_THRESHOLD = 0.35;

/**
 * The existing skill a new one duplicates (Jaccard >= threshold, best match),
 * or null if the lesson is novel. Discard on a non-null result.
 */
export function findDuplicateSkill<T extends SkillLike>(
  newText: string,
  existing: readonly T[],
  threshold: number = SKILL_DEDUP_THRESHOLD,
): { skill: T; score: number } | null {
  const nk = keywords(newText);
  let best: T | null = null;
  let bestScore = 0;
  for (const ex of existing) {
    const score = jaccard(nk, keywords(ex.text));
    if (score >= threshold && score > bestScore) {
      best = ex;
      bestScore = score;
    }
  }
  return best ? { skill: best, score: bestScore } : null;
}

export const _internal = { keywords, jaccard };
