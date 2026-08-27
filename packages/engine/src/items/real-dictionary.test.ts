import { describe, expect, it } from 'vitest';

import { matchItems } from './item-matcher';
import { ITEM_DICTIONARY } from './dictionary';
import { TAP_PERSON_ITEMS } from './tap-person-items';

function idForName(name: string): string {
  const found = Object.entries(ITEM_DICTIONARY.items).find(([, item]) => item.displayName === name);
  if (!found) throw new Error(`Missing stable catalog item: ${name}`);
  return found[0];
}

describe('real dictionary smoke (v31 catalog and matching rules)', () => {
  it('has the complete 5,439-item catalog plus five selection-only people', () => {
    expect(Object.keys(ITEM_DICTIONARY.items).length).toBe(5444);
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
    for (const [id, item] of Object.entries(ITEM_DICTIONARY.items)) {
      expect(item.displayName.length).toBeGreaterThan(0);
      if (TAP_PERSON_ITEMS[id]) expect(item.keywords).toEqual([]);
      else expect(item.keywords?.length).toBeGreaterThan(0);
      expect(item.visualConcept?.length).toBeGreaterThan(0);
    }
  });

  it('matches case-insensitively and can return multiple items', () => {
    const names = matchItems('COFFEE and pizza with my cat', ITEM_DICTIONARY).map((item) => item.displayName);
    expect(names).toContain('Coffee');
    expect(names).toContain('Pizza');
    expect(names).toContain('Cat');
  });

  it('keeps the contextual evidence that made a high-school identity match School', () => {
    const school = matchItems(
      'Quick journal check-in from a black high-school student in atlanta: the day was busy in an ordinary, very real way.',
      ITEM_DICTIONARY,
    ).find((item) => item.displayName === 'School');
    expect(school).toBeDefined();
    expect(school?.sourceExcerpt).toContain('black high-school student');
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
    expect(ITEM_DICTIONARY.synonyms['moved back home']).toBe(idForName('Home'));
    expect(ITEM_DICTIONARY.synonyms['on campus']).toBe(idForName('Campus'));
    expect(ITEM_DICTIONARY.synonyms['school day']).toBe(idForName('School'));
    expect(ITEM_DICTIONARY.synonyms.suitcases).toBe(idForName('Suitcase'));
    expect(ITEM_DICTIONARY.synonyms['steel toe boots']).toBe(idForName('Steel-Toe Boot'));
  });

  it('keeps the final 49 bundled icon identities in the v31 catalog', () => {
    expect(ITEM_DICTIONARY.items['memory.5392_chicken_nuggets']?.displayName).toBe('Chicken Nuggets');
    expect(ITEM_DICTIONARY.items['memory.5440_water_heater']?.displayName).toBe('Water Heater');
    expect(matchItems('I replaced the water heater', ITEM_DICTIONARY).map((item) => item.displayName))
      .toContain('Water Heater');
  });

  it('maps retired Online Shopping rules to Shopping', () => {
    expect(ITEM_DICTIONARY.synonyms['online shopping']).toBe(idForName('Shopping'));
  });
});
