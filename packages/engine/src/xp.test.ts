import { describe, expect, it } from 'vitest';
import { maxDailyXp, xpForAction, XP_RULES } from './xp';

describe('xpForAction', () => {
  it('pays until the cap, then zero', () => {
    expect(xpForAction('reflect', 0)).toBe(30);
    expect(xpForAction('reflect', 2)).toBe(30);
    expect(xpForAction('reflect', 3)).toBe(0);
  });
  it('focus pays twice a day (PRD 8.1)', () => {
    expect(xpForAction('focus', 0)).toBe(30);
    expect(xpForAction('focus', 1)).toBe(30);
    expect(xpForAction('focus', 2)).toBe(0);
  });
  it('visitMaster pays 50 once (48h gate lives in the RPC)', () => {
    expect(xpForAction('visitMaster', 0)).toBe(50);
    expect(xpForAction('visitMaster', 1)).toBe(0);
  });
  it('rejects negative prior counts', () => {
    expect(xpForAction('reflect', -1)).toBe(0);
  });
});

describe('maxDailyXp', () => {
  it('sums daily sources only: 60 + 90 + 20 + 20 + 240 + 50 + 25 = 505', () => {
    expect(maxDailyXp()).toBe(505);
  });
  it('excludes weekly trueNorth', () => {
    expect(XP_RULES.trueNorth.period).toBe('week');
  });
});
