import { describe, expect, it } from 'vitest';
import { ITEM_DICTIONARY } from './dictionary';
import { MAX_REFLECT_ITEMS, MAX_TAP_YOUR_DAY_SELECTIONS, TAP_YOUR_DAY_CHOICES, TAP_YOUR_DAY_QUESTIONS, tapYourDayChoice, tapYourDaySelectionLimit } from './tap-your-day';

describe('Tap Your Day curated catalog', () => {
  it('contains four fixed questions with all 131 unique selections', () => {
    expect(TAP_YOUR_DAY_QUESTIONS.map((q) => q.groups.flatMap((g) => g.choices).length)).toEqual([49, 47, 5, 30]);
    expect(TAP_YOUR_DAY_CHOICES).toHaveLength(131);
    expect(MAX_TAP_YOUR_DAY_SELECTIONS).toBe(30);
    expect(MAX_REFLECT_ITEMS).toBeGreaterThan(MAX_TAP_YOUR_DAY_SELECTIONS);
    expect(tapYourDaySelectionLimit('tap-your-day-v3')).toBe(30);
    expect(new Set(TAP_YOUR_DAY_CHOICES.map((c) => c.itemId)).size).toBe(131);
    expect(new Set(TAP_YOUR_DAY_CHOICES.map((c) => c.label)).size).toBe(131);
  });
  it('uses registered dictionary items, with exactly matching emotion names', () => {
    for (const choice of TAP_YOUR_DAY_CHOICES) {
      const item = ITEM_DICTIONARY.items[choice.itemId];
      expect(item, choice.label).toBeDefined();
      if (choice.kind === 'feeling') expect(item.displayName).toBe(choice.label);
      expect(tapYourDayChoice(choice.itemId)).toEqual(choice);
    }
  });
  it('keeps the user choice separate from the narrower representative art', () => {
    expect(tapYourDayChoice('tap.person.pets')?.label).toBe('Pets');
    expect(tapYourDayChoice('tap.person.friends')?.label).toBe('Friends');
    expect(tapYourDayChoice('memory.0076_seafood_boil')?.label).toBe('Seafood');
    expect(tapYourDayChoice('not-a-choice')).toBeUndefined();
  });
});
