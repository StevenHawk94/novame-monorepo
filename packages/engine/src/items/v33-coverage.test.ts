import { describe, expect, it } from 'vitest';

import { ITEM_DICTIONARY } from './dictionary';
import { matchItems } from './item-matcher';

// One new workbook phrase per expanded icon. Keep these explicit so a future
// generated dictionary cannot silently weaken coverage or re-enable bare words.
const COVERAGE = [
  ['Wrap', 'ate a chicken wrap'],
  ['Mole', 'ate mole sauce'],
  ['Toast', 'ate toast with butter'],
  ['Jam', 'a jar of strawberry jam'],
  ['Jelly', 'a spoonful of grape jelly'],
  ['Honey', 'added raw honey'],
  ['Relish', 'added pickle relish'],
  ['Orange', 'bought an orange'],
  ['Sage', 'added fresh sage'],
  ['Block', 'across from my city block'],
  ['Bar', 'arrived at the bar'],
  ['Bank', 'arrived at the bank'],
  ['Stream', 'a forest stream in the woods'],
  ['Ranch', 'arrived at the ranch'],
  ['Port', 'arrived at the cruise port'],
  ['Dock', 'arrived at the boat dock'],
  ['Lighter', 'used the cigarette lighter'],
  ['Stool', 'bought a small stool'],
  ['Compass', 'borrowed a compass'],
  ['Foundation', 'applied liquid foundation'],
  ['Needle', 'changed the syringe needle'],
  ['Ivy', 'cared for the ivy'],
  ['Rose', 'a vase of roses'],
  ['Daisy', 'a vase of daisies'],
  ['Lily', 'a vase of lilies'],
  ['Poppy', 'a vase of poppies'],
  ['Iris', 'a vase of irises'],
  ['Violet', 'a vase of violets'],
  ['Jasmine', 'a vase of jasmine blossoms'],
  ['Log', 'a fallen log by the trail'],
  ['Branch', 'a tree branch over the trail'],
  ['Rock', 'a river rock near the river'],
  ['Crystal', 'bought a healing crystal'],
  ['Shell', 'a seashell on the beach'],
  ['Coral', 'bright colored coral'],
  ['Cliff', 'cliff along the coast'],
  ['Cloud', 'clouds above the city'],
  ['Star', 'camped under the stars'],
  ['Bear', 'black bear crossed the road'],
  ['Bat', 'flying bat at dusk'],
  ['Mouse', 'field mouse crossed the road'],
  ['Seal', 'came across a harbor seal'],
  ['Ray', 'came across a stingray'],
  ['Raven', 'heard a raven bird'],
  ['Robin', 'heard a robin bird'],
  ['Cardinal', 'cardinal bird at the feeder'],
  ['Duck', 'came across a mallard duck'],
  ['Turkey', 'came across a wild turkey bird'],
  ['Chicken', 'came across a live chicken'],
  ['Crab', 'came across a live crab'],
  ['Pitcher', 'bought a water pitcher'],
] as const;

describe('v33 positive coverage expansion', () => {
  it.each(COVERAGE)('%s has explicit positive coverage without relying on a bare keyword', (name, phrase) => {
    const id = Object.keys(ITEM_DICTIONARY.items).find(key => ITEM_DICTIONARY.items[key].displayName === name)!;
    expect(id).toBeDefined();
    expect(ITEM_DICTIONARY.items[id].keywords?.map(word => word.toLowerCase())).toContain(phrase);
    expect(ITEM_DICTIONARY.synonyms[phrase]).toBe(id);
    expect(Object.values(ITEM_DICTIONARY.synonyms).filter(value => value === id).length).toBeGreaterThanOrEqual(30);
    expect(matchItems(phrase, ITEM_DICTIONARY).map(item => item.itemId)).toEqual([id]);
  });

  it('covers all 51 target icons while leaving Running and Neutral outside this expansion', () => {
    expect(COVERAGE).toHaveLength(51);
    const names = new Set<string>(COVERAGE.map(([name]) => name));
    expect(names.size).toBe(51);
    expect(names.has('Running')).toBe(false);
    expect(names.has('Neutral')).toBe(false);
  });

  it.each([
    ['lighter', 'This bag feels lighter than before.', 'Lighter'],
    ['running', 'Running late while running a business.', 'Running'],
    ['neutral', 'A neutral stance on the issue.', 'Neutral'],
    ['jam', 'There was a traffic jam.', 'Jam'],
    ['foundation', 'The building foundation needs attention.', 'Foundation'],
    ['rose', 'The price rose overnight.', 'Rose'],
  ])('does not re-enable the ambiguous bare word %s', (word, text, excluded) => {
    expect(ITEM_DICTIONARY.synonyms[word]).toBeUndefined();
    expect(matchItems(text, ITEM_DICTIONARY).map(item => item.displayName)).not.toContain(excluded);
  });

  it('matches the cigarette lighter scene and preserves its source evidence', () => {
    const hits = matchItems('Tonight I used the cigarette lighter.', ITEM_DICTIONARY);
    const lighter = hits.find(item => item.displayName === 'Lighter');
    expect(lighter?.sourceExcerpt).toBe('Tonight I used the cigarette lighter.');
  });

  it('still rejects a negated positive phrase', () => {
    const hits = matchItems("I never used the cigarette lighter.", ITEM_DICTIONARY);
    expect(hits.some(item => item.displayName === 'Lighter')).toBe(false);
  });
});
