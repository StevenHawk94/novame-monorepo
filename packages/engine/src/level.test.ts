import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, levelFromXp, xpToNext, xpToReach } from './level';

describe('xpToNext', () => {
  it('follows the A-curve', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(120);
    expect(xpToNext(10)).toBe(280);
  });
  it('is zero at the cap and rejects sub-1 levels', () => {
    expect(xpToNext(99)).toBe(0);
    expect(() => xpToNext(0)).toThrow(RangeError);
  });
});

describe('skin thresholds land on round levels', () => {
  // The design contract. If the curve changes and these drift, that is a
  // product decision to make on purpose, not to discover in the app.
  it.each([
    [400, 4],
    [1300, 8],
    [3000, 14],
    [5600, 20],
  ])('%i xp is level %i', (xp, level) => {
    expect(levelFromXp(xp).level).toBe(level);
  });
});

describe('levelFromXp', () => {
  it('starts at level 1 with zero xp', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForLevel: 100, progress: 0 });
  });
  it('crosses into level 2 exactly at 100', () => {
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(100).xpIntoLevel).toBe(0);
  });
  it('caps at 99 with full progress', () => {
    const capped = levelFromXp(10_000_000);
    expect(capped.level).toBe(MAX_LEVEL);
    expect(capped.progress).toBe(1);
    expect(capped.xpForLevel).toBe(0);
  });
  it('is internally consistent with xpToReach for a spread of levels', () => {
    for (const lv of [1, 2, 5, 10, 20, 50, 98, 99]) {
      expect(levelFromXp(xpToReach(lv)).level).toBe(lv);
    }
  });
  it('treats negative or NaN xp as level 1, never throws', () => {
    expect(levelFromXp(-5).level).toBe(1);
    expect(levelFromXp(NaN).level).toBe(1);
  });
});
