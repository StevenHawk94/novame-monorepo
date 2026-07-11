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
    expect(gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: [], isPaid: false }))
      .toEqual({ total: 10, credited: ['expression'] });
  });
  it('free-form prompt earns nothing for free users', () => {
    expect(gemsForReflect({ charCount: 100, promptDimension: null, aiDimensions: [], isPaid: false }))
      .toEqual({ total: 0, credited: [] });
  });
  it('ignores aiDimensions even if passed', () => {
    expect(gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness'], isPaid: false }).total).toBe(10);
  });
});

describe('gemsForReflect: paid tier', () => {
  it('prompt + 2 AI = 3 dimensions (+30)', () => {
    expect(gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness', 'momentum'], isPaid: true }))
      .toEqual({ total: 30, credited: ['expression', 'awareness', 'momentum'] });
  });
  it('dedups AI repeating the prompt dimension', () => {
    expect(gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['expression', 'awareness'], isPaid: true }).total).toBe(20);
  });
  it('caps at 3 even if AI gives more', () => {
    expect(gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: ['awareness', 'momentum', 'direction'], isPaid: true }).credited)
      .toEqual(['expression', 'awareness', 'momentum']);
  });
  it('free-form paid: pure AI, up to 3', () => {
    expect(gemsForReflect({ charCount: 100, promptDimension: null, aiDimensions: ['awareness', 'momentum', 'direction'], isPaid: true }).total).toBe(30);
  });
});

describe('gemsForReflect: no daily cap', () => {
  it('same dimension credits every time (pure, no history)', () => {
    const call = () => gemsForReflect({ charCount: 100, promptDimension: 'expression', aiDimensions: [], isPaid: false });
    expect(call().total).toBe(10);
    expect(call().total).toBe(10);
    expect(call().total).toBe(10);
  });
});

describe('gemsForReflect: shared rules', () => {
  it('under 20 chars earns nothing', () => {
    expect(gemsForReflect({ charCount: 19, promptDimension: 'expression', aiDimensions: [], isPaid: true }).total).toBe(0);
  });
});
