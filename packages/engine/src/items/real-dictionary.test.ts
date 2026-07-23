import { describe, expect, it } from 'vitest';

import { matchItems } from './item-matcher';
import { ITEM_DICTIONARY } from './dictionary';

// Integrity tests for the GENERATED dictionary (tools/build-item-dictionary.py,
// 2026-07-23 batch) -- pins the phrase-priority rule and the keyword-conflict
// rulings against the real data, and guards referential integrity after any
// regeneration.
describe('real dictionary smoke', () => {
  it('has the full 23-category batch', () => {
    expect(Object.keys(ITEM_DICTIONARY.items).length).toBe(1072);
  });

  it('phrase beats word: electric guitar never also matches guitar', () => {
    const m = matchItems('I played electric guitar today', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['music.electric_guitar']);
  });

  it('plain guitar still matches', () => {
    const m = matchItems('I played guitar', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['music.guitar']);
  });

  it('conflict ruling: chips goes to Chips, not Fries', () => {
    const m = matchItems('ate some chips', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['food.chips']);
  });

  it('conflict ruling: starbucks goes to Coffee', () => {
    const m = matchItems('grabbed starbucks with Amy', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['food.coffee']);
  });

  it('hyphenated brands match through tokenization', () => {
    const m = matchItems('went to Chick-fil-A', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['food.chicken']);
  });

  it('every synonym points at an existing item', () => {
    for (const id of Object.values(ITEM_DICTIONARY.synonyms)) {
      expect(ITEM_DICTIONARY.items[id]).toBeDefined();
    }
  });

  it('every item cell is inside its sheet grid', () => {
    for (const def of Object.values(ITEM_DICTIONARY.items)) {
      expect(def.col).toBeGreaterThanOrEqual(0);
      expect(def.col).toBeLessThan(8);
      expect(def.row).toBeGreaterThanOrEqual(0);
      expect(def.row).toBeLessThan(8);
    }
  });
});
