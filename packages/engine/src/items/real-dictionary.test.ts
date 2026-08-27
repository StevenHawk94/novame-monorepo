import { describe, expect, it } from 'vitest';

import { matchItems } from './item-matcher';
import { ITEM_DICTIONARY } from './dictionary';
import { TAP_PERSON_ITEMS } from './tap-person-items';

function idForName(name: string): string {
  const found = Object.entries(ITEM_DICTIONARY.items).find(([, item]) => item.displayName === name);
  if (!found) throw new Error(`Missing stable catalog item: ${name}`);
  return found[0];
}

describe('real dictionary smoke (stable catalog and v33 matching rules)', () => {
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

  it('keeps the final 49 bundled icon identities in the v33 catalog', () => {
    expect(ITEM_DICTIONARY.items['memory.5392_chicken_nuggets']?.displayName).toBe('Chicken Nuggets');
    expect(ITEM_DICTIONARY.items['memory.5440_water_heater']?.displayName).toBe('Water Heater');
    expect(matchItems('I replaced the water heater', ITEM_DICTIONARY).map((item) => item.displayName))
      .toContain('Water Heater');
  });

  it('maps retired Online Shopping rules to Shopping', () => {
    expect(ITEM_DICTIONARY.synonyms['online shopping']).toBe(idForName('Shopping'));
  });
});

describe('v32 contextual matching and keyword safety', () => {
  const namesFor = (text: string) => matchItems(text, ITEM_DICTIONARY).map((item) => item.displayName);

  it.each([
    ['I went running this morning.', 'Running'],
    ['I ate a wrap.', 'Wrap'],
    ['I ate Mexican mole.', 'Mole'],
    ['I ate a piece of toast.', 'Toast'],
    ['I spread jam.', 'Jam'],
    ['I drizzled honey.', 'Honey'],
    ['I bought oranges.', 'Orange'],
    ['I visited the bank.', 'Bank'],
    ['We met at a bar.', 'Bar'],
    ['I put on foundation.', 'Foundation'],
    ['I used a lighter.', 'Lighter'],
    ['I sat on a stool.', 'Stool'],
    ['I picked up a rock.', 'Rock'],
    ['I found a shell.', 'Shell'],
    ['I watched the clouds.', 'Cloud'],
    ['I saw a wild bear.', 'Bear'],
    ['There were ducks at the pond.', 'Duck'],
    ['There was a mouse in the house.', 'Mouse'],
    ['I saw a seal on the beach.', 'Seal'],
    ['I picked a rose.', 'Rose'],
    ['I planted jasmine.', 'Jasmine'],
    ['I had a neutral mood.', 'Neutral'],
  ])('retains explicit evidence: %s -> %s', (text, expected) => {
    expect(namesFor(text)).toContain(expected);
  });

  it.each([
    ['My brain is running and I am running late.', 'Running'],
    ['We need to wrap this up.', 'Wrap'],
    ['A skin mole.', 'Mole'],
    ['They proposed a toast.', 'Toast'],
    ['Stuck in a traffic jam.', 'Jam'],
    ['They called me honey.', 'Honey'],
    ['The orange shirt.', 'Orange'],
    ['The memory bank.', 'Bank'],
    ['I used the search bar.', 'Bar'],
    ['The building foundation.', 'Foundation'],
    ['It feels lighter now.', 'Lighter'],
    ['I like rock music.', 'Rock'],
    ['I ran a shell command.', 'Shell'],
    ['Please bear with me.', 'Bear'],
    ['I had to duck under it.', 'Duck'],
    ['A wireless mouse.', 'Mouse'],
    ['We will seal the deal.', 'Seal'],
    ['The price rose.', 'Rose'],
    ['Jasmine called me.', 'Jasmine'],
    ['Taking a neutral stance.', 'Neutral'],
  ])('rejects ambiguous non-icon usage: %s', (text, excluded) => {
    expect(namesFor(text)).not.toContain(excluded);
  });

  it.each(['book it', 'need to book', 'book tickets', 'book a hotel', 'book online', 'book through the app'])(
    'excludes booking grammar: %s', (text) => {
      expect(namesFor(text)).not.toContain('Book');
    },
  );

  it('retains a separate literal book despite excluded booking grammar', () => {
    expect(namesFor('I need to book a hotel. Later I read a book.')).toContain('Book');
  });

  it.each([
    ['toast with jam', 'Jam Toast'],
    ['looked at the stars', 'Star'],
    ['rock formation', 'Rock Formation'],
    ['coral reef', 'Coral Reef'],
    ['cruise port', 'Cruise Terminal'],
    ['counter stool', 'Bar Stool'],
    ['large rock', 'Boulder'],
    ['conch shell', 'Shell'],
    ['rain cloud', 'Cloud'],
    ['storm cloud', 'Rain Cloud'],
    ['pocket compass', 'Pocket Compass'],
    ['hiking compass', 'Pocket Compass'],
  ])('resolves a v32 collision to one safe carrier: %s', (phrase, expected) => {
    expect(ITEM_DICTIONARY.synonyms[phrase]).toBe(idForName(expected));
    expect(namesFor(phrase)).toEqual([expected]);
  });

  it('keeps negation and repeated-item deduplication for the new phrases', () => {
    expect(namesFor("I didn't go running for exercise.")).not.toContain('Running');
    expect(namesFor('I went running and later finished my run.').filter((name) => name === 'Running')).toHaveLength(1);
  });
});
