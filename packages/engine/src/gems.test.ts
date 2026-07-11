import { describe, expect, it } from 'vitest';
import { gemStage, gemsForReflect } from './gems';

describe('gemStage', () => {
  it.each([[0, 1], [599, 1], [600, 2], [2000, 3], [4500, 4], [9000, 5], [50000, 5]])(
    '%i gems -> stage %i',
    (g, s) => expect(gemStage(g)).toBe(s),
  );
});

describe('gemsForReflect: free tier', () => {
  it('credits the prompt dimension only (+10)', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: [], isPaid: false, priorCountsToday: {} });
    expect(r).toEqual({ total: 10, credited: ['expression'] });
  });
  it('free-form prompt earns nothing for free users', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: null, aiDimensions: [], isPaid: false, priorCountsToday: {} });
    expect(r).toEqual({ total: 0, credited: [] });
  });
  it('ignores aiDimensions even if passed', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness', 'momentum'], isPaid: false, priorCountsToday: {} });
    expect(r.total).toBe(10);
  });
});

describe('gemsForReflect: paid tier', () => {
  it('prompt + 2 AI = 3 dimensions (+30)', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness', 'momentum'], isPaid: true, priorCountsToday: {} });
    expect(r).toEqual({ total: 30, credited: ['expression', 'awareness', 'momentum'] });
  });
  it('dedups AI repeating the prompt dimension', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['expression', 'awareness'], isPaid: true, priorCountsToday: {} });
    expect(r.total).toBe(20);
  });
  it('caps at 3 even if AI gives more', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness', 'momentum', 'direction'], isPaid: true, priorCountsToday: {} });
    expect(r.credited).toEqual(['expression', 'awareness', 'momentum']);
  });
  it('free-form paid: pure AI, up to 3', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: null, aiDimensions: ['awareness', 'momentum', 'direction'], isPaid: true, priorCountsToday: {} });
    expect(r.total).toBe(30);
  });
  it('prompt dimension at daily cap is skipped, AI still counts', () => {
    const r = gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness'], isPaid: true, priorCountsToday: { expression: 2 } });
    expect(r).toEqual({ total: 10, credited: ['awareness'] });
  });
});

describe('gemsForReflect: shared rules', () => {
  it('under 20 chars earns nothing', () => {
    expect(gemsForReflect({ charCount: 19, promptDimension: 'expression', aiDimensions: [], isPaid: true, priorCountsToday: {} }).total).toBe(0);
  });
});
