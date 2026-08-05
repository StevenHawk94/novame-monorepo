import { describe, expect, it } from 'vitest';

import { matchItems } from './item-matcher';
import { ITEM_DICTIONARY } from './dictionary';

// Integrity tests for the GENERATED v3 dictionary (tools/build-items-v3.py,
// icon_keyword_mapping_final.xlsx, 2026-07-30) — pins the phrase-priority
// rule against real data and guards referential integrity after any regen.
describe('real dictionary smoke (v3)', () => {
  it('has the full 2665-item catalog', () => {
    expect(Object.keys(ITEM_DICTIONARY.items).length).toBe(2665);
  });

  it('every synonym points at an existing item', () => {
    for (const id of Object.values(ITEM_DICTIONARY.synonyms)) {
      expect(ITEM_DICTIONARY.items[id]).toBeDefined();
    }
  });

  it('every item carries one of the five Bags categories', () => {
    const allowed = new Set(['Myself', 'Food & Fun', 'Stuff', 'Places', 'Nature']);
    for (const def of Object.values(ITEM_DICTIONARY.items)) {
      expect(allowed.has(def.bagsCategory ?? '')).toBe(true);
    }
  });

  it('phrase beats word: electric guitar never also matches guitar', () => {
    const m = matchItems('I played electric guitar today', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['musical_instruments.electric_guitar']);
  });

  it('plain guitar still matches', () => {
    const m = matchItems('I played guitar', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toEqual(['musical_instruments.guitar']);
  });

  it('matching is case-insensitive', () => {
    const m = matchItems('RAMEN for dinner', ITEM_DICTIONARY);
    expect(m.map((x) => x.itemId)).toContain('food_drink.ramen');
  });

  it('multiple items match in one line', () => {
    const m = matchItems('coffee and cake with my cat', ITEM_DICTIONARY);
    const ids = m.map((x) => x.itemId);
    expect(ids).toContain('food_drink.coffee');
    expect(ids).toContain('food_drink.cake');
    expect(ids).toContain('animals.cat');
  });

  it('emotions are matchable (guided page taps rely on them existing)', () => {
    expect(ITEM_DICTIONARY.items['emotions_expressions.happy']).toBeDefined();
    expect(ITEM_DICTIONARY.items['emotions_expressions.sad']).toBeDefined();
  });
});
