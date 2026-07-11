import { describe, expect, it } from 'vitest';
import { DIMENSION_IDS, DIMENSIONS } from './dimensions';
import { SKIN_COUNT, unlockedSkinCount } from './skins';
import { COUNTRIES, STATES } from './locales';

describe('dimensions', () => {
  it('has exactly 8 ids, each self-consistent', () => {
    expect(DIMENSION_IDS).toHaveLength(8);
    for (const id of DIMENSION_IDS) expect(DIMENSIONS[id].id).toBe(id);
  });
});

describe('skins', () => {
  it('default form only at 0 xp', () => {
    expect(unlockedSkinCount(0, false)).toBe(1);
  });
  it('xp thresholds stack', () => {
    expect(unlockedSkinCount(400, false)).toBe(2);
    expect(unlockedSkinCount(5600, false)).toBe(5);
  });
  it('subscription adds one, capped at SKIN_COUNT', () => {
    expect(unlockedSkinCount(0, true)).toBe(2);
    expect(unlockedSkinCount(5600, true)).toBe(SKIN_COUNT);
    expect(unlockedSkinCount(999999, true)).toBe(SKIN_COUNT);
  });
});

describe('locales ported 1:1 from core', () => {
  it('48 countries; US has 50 states + DC', () => {
    expect(COUNTRIES.length).toBe(48);
    expect(STATES.US?.length).toBe(51);
  });
});
