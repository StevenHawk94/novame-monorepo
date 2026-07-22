/**
 * Currency sources and their daily/weekly caps. Decision record B1, revised by
 * the PRD v2.0 economy (§8.1) and the 2026-07 product ruling (Q8): the XP
 * ledger IS the currency ledger — levels were abandoned, the number that used
 * to be "XP" is now the clover currency, same ledger, same events. Names keep
 * the Xp prefix to avoid a repo-wide rename; read "xp" as "currency".
 *
 * Currency is earned and spent (cosmetics), never decayed. This module answers
 * one question, "given what the user already did this period, how much does
 * this action pay right now", and owns the caps so client and server cannot
 * drift.
 */

export type XpSource =
  | 'focus'
  | 'reflect'
  | 'quietWins'
  | 'newLens'
  | 'tameEnemy'
  | 'trueNorth'
  | 'visitMaster'
  | 'bubble';

interface XpRule {
  award: number;
  /** Max awarding events per period. */
  cap: number;
  period: 'day' | 'week';
}

/** PRD §1: the balance never exceeds this; RPCs clamp on write. */
export const CURRENCY_CAP = 99999;

// PRD §8.1 values. Notes:
//  - focus pays twice a day now (was once)
//  - visitMaster's real gate is the 48h cooldown in the RPC; the day-cap here
//    only stops double-pay inside one day
//  - tameEnemy: free users tame once a day; paid users once per enemy (8/day).
//    The per-enemy gate lives in the RPC — this table holds the paid ceiling
//    so maxDailyXp() stays the true upper bound.
//  - bubble: popping a friend's memory bubble on Home (+5, at most 5 a day)
export const XP_RULES: Record<XpSource, XpRule> = {
  focus:       { award: 30,  cap: 2, period: 'day' },
  reflect:     { award: 30,  cap: 3, period: 'day' },
  quietWins:   { award: 20,  cap: 1, period: 'day' },
  newLens:     { award: 20,  cap: 1, period: 'day' },
  tameEnemy:   { award: 30,  cap: 8, period: 'day' },
  trueNorth:   { award: 100, cap: 1, period: 'week' },
  visitMaster: { award: 50,  cap: 1, period: 'day' },
  bubble:      { award: 5,   cap: 5, period: 'day' },
};

/** Free-tier tame cap (paid = XP_RULES.tameEnemy.cap, one per enemy). */
export const TAME_CAP_FREE_PER_DAY = 1;

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
