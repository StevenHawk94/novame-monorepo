import { describe, expect, it } from 'vitest';

import { matchItems, type ItemDictionary } from './item-matcher';

// A small fixture dictionary -- the real one is dictionary.json, but the engine
// is pure over whatever dictionary it's given, so the tests pin behavior with a
// compact set covering each rarity and a multi-word entry.
const DICT: ItemDictionary = {
  items: {
    'food.apple': { displayName: 'Apple', rarity: 'common', category: 'food', sheetId: 'food', row: 0, col: 0 },
    'food.apple_pie': { displayName: 'Apple Pie', rarity: 'rare', category: 'food', sheetId: 'food', row: 0, col: 3 },
    'food.coffee': { displayName: 'Coffee', rarity: 'common', category: 'drink', sheetId: 'food', row: 0, col: 1 },
    'food.pizza': { displayName: 'Pizza', rarity: 'uncommon', category: 'food', sheetId: 'food', row: 0, col: 2 },
    'food.tea': { displayName: 'Tea', rarity: 'common', category: 'drink', sheetId: 'food', row: 0, col: 4 },
    'nature.rain': { displayName: 'Rain', rarity: 'common', category: 'nature', sheetId: 'nature', row: 0, col: 0 },
    'nature.sun': { displayName: 'Sun', rarity: 'common', category: 'nature', sheetId: 'nature', row: 0, col: 1 },
    'nature.moon': { displayName: 'Moon', rarity: 'uncommon', category: 'nature', sheetId: 'nature', row: 0, col: 2 },
    'nature.ocean': { displayName: 'Ocean', rarity: 'rare', category: 'nature', sheetId: 'nature', row: 0, col: 4 },
    'object.book': { displayName: 'Book', rarity: 'common', category: 'object', sheetId: 'object', row: 0, col: 0 },
  },
  synonyms: {
    apple: 'food.apple', apples: 'food.apple', 'an apple': 'food.apple',
    'apple pie': 'food.apple_pie',
    coffee: 'food.coffee', espresso: 'food.coffee',
    pizza: 'food.pizza',
    tea: 'food.tea',
    rain: 'nature.rain', rainy: 'nature.rain',
    sun: 'nature.sun', sunshine: 'nature.sun',
    moon: 'nature.moon',
    ocean: 'nature.ocean', sea: 'nature.ocean',
    book: 'object.book', books: 'object.book',
  },
};

function ids(text: string): string[] {
  return matchItems(text, DICT).map((m) => m.itemId).sort();
}
function labels(text: string): string[] {
  return matchItems(text, DICT).map((m) => m.label);
}

describe('matchItems: dictionary lookup', () => {
  it('matches a single item', () => {
    expect(ids('I ate an apple today')).toEqual(['food.apple']);
  });
  it('matches plural and synonym variants', () => {
    expect(ids('bought some apples')).toEqual(['food.apple']);
    expect(ids('had an espresso')).toEqual(['food.coffee']);
  });
  it('returns nothing when no item is present', () => {
    expect(ids('just some random words here')).toEqual([]);
  });
});

describe('matchItems: multi-word entries (rule 6)', () => {
  it('prefers apple pie over apple', () => {
    expect(ids('I love apple pie')).toEqual(['food.apple_pie']);
  });
  it('matches apple pie and a separate apple', () => {
    expect(ids('apple pie and an apple')).toEqual(['food.apple', 'food.apple_pie']);
  });
});

describe('matchItems: negation guard (rule 3)', () => {
  it("drops a hit after didn't", () => {
    expect(ids("I didn't have coffee")).toEqual([]);
  });
  it('drops a hit after no', () => {
    expect(ids('no pizza today')).toEqual([]);
  });
  it('keeps items not governed by the negator', () => {
    expect(ids('skipped breakfast but had tea')).toEqual(['food.tea']);
    expect(ids('tea without sugar')).toEqual(['food.tea']);
  });
});

describe('matchItems: dedupe and cap (rules 4, 5)', () => {
  it('counts the same item once', () => {
    expect(ids('apple apple apple')).toEqual(['food.apple']);
  });
  it('caps at 5, ranked by rarity', () => {
    // ocean(rare) apple_pie(rare) moon(uncommon) pizza(uncommon) then commons
    const got = matchItems('ocean apple pie moon pizza rain sun coffee book', DICT).map((m) => m.itemId);
    expect(got.length).toBe(5);
    // the two rares and two uncommons must be in the top 5
    expect(got).toContain('nature.ocean');
    expect(got).toContain('food.apple_pie');
    expect(got).toContain('nature.moon');
    expect(got).toContain('food.pizza');
  });
});

describe('matchItems: labels (noun + adjective prefix, title-cased)', () => {
  it('plain noun strips articles and fillers', () => {
    expect(labels('an apple')).toEqual(['Apple']);
    expect(labels('uh an apple i guess')).toEqual(['Apple']);
  });
  it('keeps adjectives before the noun', () => {
    expect(labels('delicious apple pie')).toEqual(['Delicious Apple Pie']);
    expect(labels('the big red apple')).toEqual(['Big Red Apple']);
  });
  it('title-cases the whole label', () => {
    expect(labels('warm RAIN')).toEqual(['Warm Rain']);
  });
});

describe('matchItems: tokenization', () => {
  it('handles case and punctuation', () => {
    expect(ids('Rain, rain! And SUNSHINE.')).toEqual(['nature.rain', 'nature.sun']);
  });
});
