import { describe, expect, it } from 'vitest';
import {
  AFFECTION_TYPES,
  BURROW_ROOM_IDS,
  COLLECTION_CATEGORIES,
  DAILY_QUEST_IDS,
  HOME_DECOR_SLOTS,
  SHOP_CATEGORIES,
} from './app-major-update';

describe('Burrow major update identifiers', () => {
  it('keeps the product-defined counts stable', () => {
    expect(BURROW_ROOM_IDS).toHaveLength(9);
    expect(HOME_DECOR_SLOTS).toHaveLength(12);
    expect(AFFECTION_TYPES).toHaveLength(6);
    expect(DAILY_QUEST_IDS).toHaveLength(7);
    expect(COLLECTION_CATEGORIES).toHaveLength(5);
    expect(SHOP_CATEGORIES).toHaveLength(14);
  });

  it('contains no duplicate persisted identifiers', () => {
    for (const values of [
      BURROW_ROOM_IDS,
      HOME_DECOR_SLOTS,
      AFFECTION_TYPES,
      DAILY_QUEST_IDS,
      COLLECTION_CATEGORIES,
      SHOP_CATEGORIES,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
