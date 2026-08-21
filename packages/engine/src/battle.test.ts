import { describe, expect, it } from 'vitest';
import {
  applyHit,
  battleMilestoneCount,
  battleMilestoneThreshold,
  damageFor,
  HEALTHY_MIN_HP,
  isTamed,
  MONSTER_HP,
  monsterTier,
  nextMilestoneThresholds,
  TAME_POINTS_PER_COMPLETION,
} from './battle';

describe('Tame History points', () => {
  it('awards the fixed launch value for each completed tame', () => {
    expect(TAME_POINTS_PER_COMPLETION).toBe(50);
  });

  it('advances the next three milestones immediately after a crossing', () => {
    expect(battleMilestoneThreshold(1)).toBe(1000);
    expect(battleMilestoneThreshold(2)).toBe(3000);
    expect(battleMilestoneCount(999)).toBe(0);
    expect(battleMilestoneCount(1000)).toBe(1);
    expect(nextMilestoneThresholds(999, 3)).toEqual([1000, 3000, 6000]);
    expect(nextMilestoneThresholds(1000, 3)).toEqual([3000, 6000, 10000]);
  });
});

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
