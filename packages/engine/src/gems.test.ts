import { describe, expect, it } from 'vitest';
import { gemStage, gemsForReflect } from './gems';

describe('gemStage', () => {
  it.each([[0, 1], [599, 1], [600, 2], [2000, 3], [4500, 4], [9000, 5], [50000, 5]])(
    '%i gems -> stage %i',
    (g, s) => expect(gemStage(g)).toBe(s),
  );
});

describe('gemsForReflect', () => {
  it('free user credits one dimension', () => {
    const r = gemsForReflect({
      charCount: 100, matchedDimensions: ['expression', 'awareness'],
      isPaid: false, priorCountsToday: {},
    });
    expect(r).toEqual({ total: 10, credited: ['expression'] });
  });
  it('paid user credits two', () => {
    const r = gemsForReflect({
      charCount: 100, matchedDimensions: ['expression', 'awareness'],
      isPaid: true, priorCountsToday: {},
    });
    expect(r.total).toBe(20);
  });
  it('under 20 chars earns nothing', () => {
    expect(gemsForReflect({
      charCount: 19, matchedDimensions: ['expression'],
      isPaid: true, priorCountsToday: {},
    }).total).toBe(0);
  });
  it('a dimension at daily cap earns nothing', () => {
    const r = gemsForReflect({
      charCount: 100, matchedDimensions: ['expression'],
      isPaid: false, priorCountsToday: { expression: 2 },
    });
    expect(r.total).toBe(0);
  });
  it('one capped, one fresh: paid credits only the fresh one', () => {
    const r = gemsForReflect({
      charCount: 100, matchedDimensions: ['expression', 'awareness'],
      isPaid: true, priorCountsToday: { expression: 2 },
    });
    expect(r).toEqual({ total: 10, credited: ['awareness'] });
  });
});
