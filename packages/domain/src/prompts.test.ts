import { describe, expect, it } from 'vitest';
import { REFLECT_PROMPTS, promptDimension } from './prompts';
import { DIMENSION_IDS } from './dimensions';

describe('REFLECT_PROMPTS', () => {
  it('has 9 prompts with ids 1..9', () => {
    expect(REFLECT_PROMPTS.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('eight map to distinct real dimensions, one is free-form', () => {
    const dims = REFLECT_PROMPTS.map((p) => p.dimension).filter((d): d is NonNullable<typeof d> => d !== null);
    expect(dims).toHaveLength(8);
    expect(new Set(dims).size).toBe(8);
    for (const d of dims) expect(DIMENSION_IDS).toContain(d);
  });
  it('the free-form prompt is id 9 with null dimension', () => {
    expect(REFLECT_PROMPTS.find((p) => p.dimension === null)?.id).toBe(9);
  });
});

describe('promptDimension', () => {
  it('resolves a prompt id to its dimension', () => {
    expect(promptDimension(1)).toBe('momentum');
    expect(promptDimension(8)).toBe('gratitude');
  });
  it('returns null for the free-form prompt and unknown ids', () => {
    expect(promptDimension(9)).toBeNull();
    expect(promptDimension(99)).toBeNull();
  });
});
