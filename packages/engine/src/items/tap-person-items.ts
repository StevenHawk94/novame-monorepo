import type { ItemDef } from './item-types';

// Stable manual-selection IDs, retained in historical records.
export const TAP_PERSON_ITEMS: Record<string, ItemDef> = {
  'tap.person.just_me': { displayName: 'Just Me', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', visualConcept: 'A single bunny.', emoji: '🐰' },
  'tap.person.partner': { displayName: 'Partner', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', visualConcept: 'Two overlapping hearts.', emoji: '💕' },
  'tap.person.family': { displayName: 'Family', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', visualConcept: 'A house with two bunnies.', emoji: '🐰' },
  'tap.person.friends': { displayName: 'Friends', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', visualConcept: 'Three friends together.', emoji: '🐰' },
  'tap.person.pets': { displayName: 'Pets', rarity: 'common', category: 'People & Relationships', bagsCategory: 'Myself', visualConcept: 'A cat and dog together.', emoji: '🐾' },
};
