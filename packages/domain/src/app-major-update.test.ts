import { describe, expect, it } from 'vitest';
import {
  AFFECTION_TYPES,
  BURROW_DECOR_SHOP_CATEGORIES,
  BURROW_RELEASE_ROOM_IDS,
  BURROW_ROOM_IDS,
  COLLECTION_CATEGORIES,
  DAILY_QUEST_IDS,
  HOME_DECOR_SLOTS,
  SHOP_CATEGORIES,
} from './app-major-update';

describe('Burrow major update identifiers', () => {
  it('keeps persisted identifiers and release navigation distinct', () => {
    expect(BURROW_ROOM_IDS).toHaveLength(9);
    expect(BURROW_RELEASE_ROOM_IDS).toHaveLength(6);
    expect(HOME_DECOR_SLOTS).toHaveLength(17);
    expect(AFFECTION_TYPES).toHaveLength(6);
    expect(DAILY_QUEST_IDS).toHaveLength(6);
    expect(COLLECTION_CATEGORIES).toHaveLength(4);
    expect(SHOP_CATEGORIES).toHaveLength(19);
    expect(BURROW_DECOR_SHOP_CATEGORIES).toHaveLength(16);
  });

  it('contains no duplicate persisted identifiers', () => {
    for (const values of [
      BURROW_ROOM_IDS,
      BURROW_RELEASE_ROOM_IDS,
      HOME_DECOR_SLOTS,
      AFFECTION_TYPES,
      DAILY_QUEST_IDS,
      COLLECTION_CATEGORIES,
      SHOP_CATEGORIES,
      BURROW_DECOR_SHOP_CATEGORIES,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
