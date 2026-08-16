/**
 * Guided Prompts (流程2) 配置与持久化 — v3 (2026-07-30).
 *
 * The chooser lists the 12 prompt-reflection categories (curated, ranked
 * subsets of the master catalog — generated into guided-catalog.g.ts from
 * icon_keyword_mapping_final.xlsx). The user picks the themes they care
 * about once; later opens jump straight to their prompt pages, one designed
 * question per theme, and the pages' top-right Edit reopens the chooser.
 * Object Reflect shares the same 12 categories for its library picker.
 */
import { PROMPT_CATEGORIES } from './guided-catalog.g';
import { remoteIdsForPromptCategory } from './remote-items';
import { kGuidedCategories } from '../shared/storage/keys';
import { storage } from './storage';

export const GUIDED_MIN = 3;
export const GUIDED_MAX = PROMPT_CATEGORIES.length; // all 12 selectable
export const MAX_ITEMS_PER_REFLECT_CATEGORY = 8;

export interface GuidedCategory {
  key: string;
  label: string;
  emoji: string;
  question: string;
}

// One designed question per prompt category (keys = guided-catalog.g.ts).
const META: Record<string, { emoji: string; question: string }> = {
  emotion_and_feeling: { emoji: '💛', question: 'How do you feel today?' },
  food_drink: { emoji: '🍜', question: 'What did you eat & drink today?' },
  chores_home_care: { emoji: '🧹', question: 'Which chores did you get done today?' },
  self_care_hygiene: { emoji: '🛁', question: 'How did you care for yourself today?' },
  work_productivity: { emoji: '💼', question: 'What did you work on today?' },
  entertainment_leisure: { emoji: '🎮', question: 'What did you do for fun today?' },
  exercise_movement: { emoji: '🏃', question: 'How did you move today?' },
  social_relationships: { emoji: '👥', question: 'Who did you spend time with today?' },
  travel_commute: { emoji: '🚌', question: 'Where did your day take you today?' },
  nature_outdoors: { emoji: '🏞️', question: 'Did you get outside today?' },
  learning_hobbies: { emoji: '📚', question: 'What did you learn or practice today?' },
  shopping_errands: { emoji: '🛍️', question: 'What shopping or errands did you do today?' },
};

const CONFIG: GuidedCategory[] = PROMPT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  emoji: META[c.key]?.emoji ?? '✨',
  question: c.question || META[c.key]?.question || `Anything about ${c.label.toLowerCase()} today?`,
}));

const BY_KEY = new Map(CONFIG.map((c) => [c.key, c]));
const ITEMS_BY_KEY = new Map(PROMPT_CATEGORIES.map((c) => [c.key, c.itemIds]));
const CATEGORY_BY_ITEM = new Map<string, string>();
for (const category of PROMPT_CATEGORIES) {
  for (const id of category.itemIds) {
    if (!CATEGORY_BY_ITEM.has(id)) CATEGORY_BY_ITEM.set(id, category.key);
  }
}

/** The 12 prompt categories, in sheet order (= chooser + page order). */
export function availableGuidedCategories(): GuidedCategory[] {
  return CONFIG;
}

/** Ranked, curated item ids for one category's prompt page / picker tab. */
export function itemsForGuidedCategory(key: string): string[] {
  const base = ITEMS_BY_KEY.get(key) ?? [];
  // OTA items: R2-manifest additions tagged with this prompt category append
  // after the bundled list (no release needed).
  const extra = remoteIdsForPromptCategory(key).filter((id) => !base.includes(id));
  return extra.length > 0 ? [...base, ...extra] : base;
}

/** Canonical Reflect category used by both manual-pick flows for the 8 cap. */
export function reflectCategoryForItem(id: string): string | null {
  const bundled = CATEGORY_BY_ITEM.get(id);
  if (bundled) return bundled;
  for (const category of CONFIG) {
    if (remoteIdsForPromptCategory(category.key).includes(id)) return category.key;
  }
  return null;
}

/** The stored picks, filtered to categories that still exist (regen-safe). */
export function getGuidedSelection(): string[] {
  try {
    const raw = storage.getString(kGuidedCategories.name);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string' && BY_KEY.has(k));
  } catch {
    return [];
  }
}

export function setGuidedSelection(keys: string[]): void {
  storage.set(kGuidedCategories.name, JSON.stringify(keys.slice(0, GUIDED_MAX)));
}

export function guidedCategoryFor(key: string): GuidedCategory {
  return (
    BY_KEY.get(key) ?? { key, label: key, emoji: '✨', question: 'Anything to note today?' }
  );
}
