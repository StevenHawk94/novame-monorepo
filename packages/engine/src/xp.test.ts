import { describe, expect, it } from 'vitest';
import { maxDailyXp, xpForAction, XP_RULES } from './xp';

describe('xpForAction', () => {
  it('pays until the cap, then zero', () => {
    expect(xpForAction('reflect', 0)).toBe(30);
    expect(xpForAction('reflect', 2)).toBe(30);
    expect(xpForAction('reflect', 3)).toBe(0);
  });
  it('focus is once per day', () => {
    expect(xpForAction('focus', 0)).toBe(30);
    expect(xpForAction('focus', 1)).toBe(0);
  });
  it('visitMaster never pays', () => {
    expect(xpForAction('visitMaster', 0)).toBe(0);
  });
  it('rejects negative prior counts', () => {
    expect(xpForAction('reflect', -1)).toBe(0);
  });
});

describe('maxDailyXp', () => {
  it('sums daily sources only: 30 + 90 + 20 + 20 + 20 = 180', () => {
    expect(maxDailyXp()).toBe(180);
  });
  it('excludes weekly trueNorth', () => {
    expect(XP_RULES.trueNorth.period).toBe('week');
  });
});
