import { describe, expect, it } from 'vitest';

import { matchItems } from './item-matcher';
import { ITEM_DICTIONARY } from './dictionary';

function idForName(name: string): string {
  const found = Object.entries(ITEM_DICTIONARY.items).find(([, item]) => item.displayName === name);
  if (!found) throw new Error(`Missing stable catalog item: ${name}`);
  return found[0];
}

describe('real dictionary smoke (stable v19 icons + v25 matching rules)', () => {
  it('has the complete 5,390-item catalog', () => {
    expect(Object.keys(ITEM_DICTIONARY.items).length).toBe(5390);
  });

  it('keeps every synonym and exclusion referentially valid', () => {
    for (const id of Object.values(ITEM_DICTIONARY.synonyms)) {
      expect(ITEM_DICTIONARY.items[id]).toBeDefined();
    }
    for (const [keyword, rules] of Object.entries(ITEM_DICTIONARY.exclusions ?? {})) {
      expect(ITEM_DICTIONARY.synonyms[keyword]).toBeDefined();
      expect(rules.length).toBeGreaterThan(0);
    }
  });

  it('retains the three core app-facing fields', () => {
    for (const item of Object.values(ITEM_DICTIONARY.items)) {
      expect(item.displayName.length).toBeGreaterThan(0);
      expect(item.keywords?.length).toBeGreaterThan(0);
      expect(item.visualConcept?.length).toBeGreaterThan(0);
    }
  });

  it('matches case-insensitively and can return multiple items', () => {
    const names = matchItems('COFFEE and pizza with my cat', ITEM_DICTIONARY).map((item) => item.displayName);
    expect(names).toContain('Coffee');
    expect(names).toContain('Pizza');
    expect(names).toContain('Cat');
  });

  it('applies literal AUTO_UNLESS_EXCLUDED phrases', () => {
    expect(matchItems('I made coffee', ITEM_DICTIONARY).map((item) => item.displayName)).toContain('Coffee');
    expect(matchItems('I bought a coffee table', ITEM_DICTIONARY).map((item) => item.displayName)).not.toContain('Coffee');
  });

  it('routes duplicate keywords to the most direct icon only', () => {
    expect(ITEM_DICTIONARY.synonyms['fried egg']).toBe(idForName('Fried Egg'));
    expect(ITEM_DICTIONARY.synonyms['ultimate frisbee']).toBe(idForName('Frisbee'));
    expect(ITEM_DICTIONARY.synonyms.surprised).toBe(idForName('Surprised'));
    expect(ITEM_DICTIONARY.synonyms.celebrating).toBe(idForName('Celebrating'));
  });

  it('maps retired Online Shopping rules to Shopping', () => {
    expect(ITEM_DICTIONARY.synonyms['online shopping']).toBe(idForName('Shopping'));
  });
});
