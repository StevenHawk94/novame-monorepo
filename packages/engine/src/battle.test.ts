import { describe, expect, it } from 'vitest';
import { applyHit, damageFor, HEALTHY_MIN_HP, isTamed, MONSTER_HP, monsterTier } from './battle';

describe('damage', () => {
  it('maps kind to damage', () => {
    expect(damageFor('default')).toBe(10);
    expect(damageFor('learned')).toBe(20);
    expect(damageFor('hidden')).toBe(50);
  });
  it('clears in the documented hit counts', () => {
    let hp = MONSTER_HP;
    for (let i = 0; i < 6; i++) hp = applyHit(hp, 'default');
    expect(isTamed(hp)).toBe(true);
    expect(isTamed(applyHit(applyHit(MONSTER_HP, 'hidden'), 'hidden'))).toBe(true);
  });
});

describe('monsterTier: integer HP bands (B3 line 129)', () => {
  it('healthy at or above HEALTHY_MIN_HP', () => {
    expect(monsterTier(MONSTER_HP)).toBe('healthy');
    expect(monsterTier(HEALTHY_MIN_HP)).toBe('healthy');
  });
  it('wounded from 1 up to just below the healthy floor', () => {
    expect(monsterTier(HEALTHY_MIN_HP - 1)).toBe('wounded');
    expect(monsterTier(20)).toBe('wounded');
    expect(monsterTier(1)).toBe('wounded');
  });
  it('defeated only at zero or below', () => {
    expect(monsterTier(0)).toBe('defeated');
    expect(monsterTier(-5)).toBe('defeated');
  });
  it('applyHit never goes negative', () => {
    expect(applyHit(10, 'hidden')).toBe(0);
  });
});
