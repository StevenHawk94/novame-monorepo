import type { ItemDef } from './item-matcher';

// Selection-only items. No synonyms: Write Freely keyword matching is unchanged.
// Kept outside generated dictionary.json so spreadsheet rebuilds cannot erase them.
export const TAP_PERSON_ITEMS: Record<string, ItemDef> = {
  'tap.person.just_me': { displayName: 'Just Me', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', keywords: [], visualConcept: 'A single bunny.', emoji: '🐰' },
  'tap.person.partner': { displayName: 'Partner', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', keywords: [], visualConcept: 'Two overlapping hearts.', emoji: '💕' },
  'tap.person.family': { displayName: 'Family', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', keywords: [], visualConcept: 'A house with two bunnies.', emoji: '🐰' },
  'tap.person.friends': { displayName: 'Friends', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', keywords: [], visualConcept: 'Three friends together.', emoji: '🐰' },
  'tap.person.pets': { displayName: 'Pets', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', keywords: [], visualConcept: 'A cat and dog together.', emoji: '🐾' },
};
