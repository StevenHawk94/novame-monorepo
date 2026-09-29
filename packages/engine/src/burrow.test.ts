import { describe, expect, it } from 'vitest';
import {
  FREE_ADVENTURE_DURATION_MS,
  PLUS_ADVENTURE_DURATION_MS,
  acceleratedAdventureEndMs,
  affectionCooldownRemainingMs,
  adventureDurationMs,
  pairItemDisposition,
  projectedRoomNeed,
  specialQuestTarget,
} from './burrow';

describe('room needs', () => {
  it('decays by one for each completed five-minute interval', () => {
    expect(projectedRoomNeed(100, 0, 4 * 60 * 1000 + 59_999)).toBe(100);
    expect(projectedRoomNeed(100, 0, 5 * 60 * 1000)).toBe(99);
    expect(projectedRoomNeed(50, 0, 300 * 60 * 1000)).toBe(0);
  });

  it('clamps corrupt or future values safely', () => {
    expect(projectedRoomNeed(120, 100, 0)).toBe(100);
    expect(projectedRoomNeed(-20, 0, 0)).toBe(0);
  });
});

describe('affection and adventure timing', () => {
  it('shares one six-hour free cooldown and bypasses it for Plus', () => {
    const hour = 60 * 60 * 1000;
    expect(affectionCooldownRemainingMs(0, 2 * hour, false)).toBe(4 * hour);
    expect(affectionCooldownRemainingMs(0, 2 * hour, true)).toBe(0);
    expect(affectionCooldownRemainingMs(0, 7 * hour, false)).toBe(0);
  });

  it('locks free and Plus adventure durations', () => {
    expect(adventureDurationMs(false)).toBe(FREE_ADVENTURE_DURATION_MS);
    expect(adventureDurationMs(true)).toBe(PLUS_ADVENTURE_DURATION_MS);
  });

  it('never lengthens an adventure during a Plus upgrade', () => {
    const hour = 60 * 60 * 1000;
    expect(acceleratedAdventureEndMs(8 * hour, 1 * hour)).toBe(3 * hour);
    expect(acceleratedAdventureEndMs(2 * hour, 1 * hour)).toBe(2 * hour);
    expect(acceleratedAdventureEndMs(1 * hour, 2 * hour)).toBe(1 * hour);
  });
});

describe('quest and drop rules', () => {
  it('grows special quest targets by stage', () => {
    expect(specialQuestTarget(1, 'adventures_completed')).toBe(5);
    expect(specialQuestTarget(4, 'items_collected')).toBe(40);
    expect(specialQuestTarget(2, 'friends_met')).toBe(4);
  });

  it('grants, gifts, then excludes duplicate pair items', () => {
    expect(pairItemDisposition(false, false)).toBe('grant_self');
    expect(pairItemDisposition(true, false)).toBe('gift_partner');
    expect(pairItemDisposition(true, true)).toBe('exclude');
  });
});
