/**
 * XP sources and their daily/weekly caps. Decision record B1 (lines 67-73).
 *
 * XP is earned, never spent and never decayed -- a core product principle: no
 * decay mechanics, no manufactured desire. This module answers one question,
 * "given what the user already did this period, how much XP does this action
 * award right now", and owns the caps so client and server cannot drift.
 */

export type XpSource =
  | 'focus'
  | 'reflect'
  | 'quietWins'
  | 'newLens'
  | 'tameEnemy'
  | 'trueNorth'
  | 'visitMaster';

interface XpRule {
  award: number;
  /** Max awarding events per period. */
  cap: number;
  period: 'day' | 'week';
}

// Focus can be replayed freely; only the first qualifying listen per day awards
// XP, so cap is 1, not unlimited. Visit Master fires but never pays (award 0).
export const XP_RULES: Record<XpSource, XpRule> = {
  focus:       { award: 30, cap: 1, period: 'day' },
  reflect:     { award: 30, cap: 3, period: 'day' },
  quietWins:   { award: 20, cap: 1, period: 'day' },
  newLens:     { award: 20, cap: 1, period: 'day' },
  tameEnemy:   { award: 20, cap: 1, period: 'day' },
  trueNorth:   { award: 50, cap: 1, period: 'week' },
  visitMaster: { award: 0,  cap: 3, period: 'week' },
};

/**
 * XP for one action given how many times this source already fired in the
 * current period. Zero once the cap is reached -- the action still happens, it
 * just stops paying.
 */
export function xpForAction(source: XpSource, priorCountThisPeriod: number): number {
  const rule = XP_RULES[source];
  if (priorCountThisPeriod < 0) return 0;
  return priorCountThisPeriod < rule.cap ? rule.award : 0;
}

/** Theoretical max XP in one day from the daily sources (excludes weekly). */
export function maxDailyXp(): number {
  let sum = 0;
  for (const s of Object.keys(XP_RULES) as XpSource[]) {
    const r = XP_RULES[s];
    if (r.period === 'day') sum += r.award * r.cap;
  }
  return sum;
}
