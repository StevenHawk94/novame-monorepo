/**
 * Guided Prompts (流程2) 配置与持久化 — v3 (2026-07-30).
 *
 * The chooser lists the 12 prompt-reflection categories (curated, ranked
 * subsets of the master catalog — generated into guided-catalog.g.ts from
 * Icon_Mapping_Core_Tables_v26.xlsx). The user picks the themes they care
 * about once; later opens jump straight to their prompt pages, one designed
 * question per theme, and the pages' top-right Edit reopens the chooser.
 * Guided Reflect uses the same 12-category item library.
 */
import { PROMPT_CATEGORIES } from './guided-catalog.g';
import { remoteIdsForPromptCategory } from './remote-items';
import { kGuidedCategories, kGuidedFavoriteItems } from '../shared/storage/keys';
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

export interface GuidedSubcategory {
  key: string;
  label: string;
  itemIds: string[];
}

// One designed question per prompt category (keys = guided-catalog.g.ts).
const META: Record<string, { emoji: string; question: string }> = {
  emotion_and_feeling: { emoji: '💛', question: 'Which feelings or inner states showed up today?' },
  food_drink: { emoji: '🍜', question: 'What was part of eating, drinking, or cooking today?' },
  chores_home_care: { emoji: '🧹', question: 'What was part of taking care of home today?' },
  self_care_hygiene: { emoji: '🛁', question: 'What was part of caring for your body or health today?' },
  work_productivity: { emoji: '💼', question: 'What was part of your work or progress today?' },
  entertainment_leisure: { emoji: '🎮', question: 'What was part of your free time today?' },
  exercise_movement: { emoji: '🏃', question: 'What was part of your movement or exercise today?' },
  social_relationships: { emoji: '👥', question: 'What was part of connecting with others today?' },
  travel_commute: { emoji: '🚌', question: 'What was part of going places today?' },
  nature_outdoors: { emoji: '🏞️', question: 'What was part of your time outdoors today?' },
  learning_hobbies: { emoji: '📚', question: 'What was part of learning, making, or practicing today?' },
  shopping_errands: { emoji: '🛍️', question: 'What was part of shopping or running errands today?' },
};

const CONFIG: GuidedCategory[] = PROMPT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  emoji: META[c.key]?.emoji ?? '✨',
  question: META[c.key]?.question || c.question || `Anything about ${c.label.toLowerCase()} today?`,
}));

const BY_KEY = new Map(CONFIG.map((c) => [c.key, c]));
const ITEMS_BY_KEY = new Map(
  PROMPT_CATEGORIES.map((c) => [
    c.key,
    c.itemIds.length > 0 ? c.itemIds : c.subcategories.flatMap((subcategory) => subcategory.itemIds),
  ]),
);
const SUBCATEGORIES_BY_KEY = new Map(PROMPT_CATEGORIES.map((c) => [c.key, c.subcategories]));
const CATEGORY_BY_ITEM = new Map<string, string>();
for (const category of PROMPT_CATEGORIES) {
  for (const id of ITEMS_BY_KEY.get(category.key) ?? []) {
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

/** v26 secondary tabs in workbook order; icons stay in workbook row order. */
export function subcategoriesForGuidedCategory(key: string): GuidedSubcategory[] {
  const bundled = SUBCATEGORIES_BY_KEY.get(key) ?? [];
  const categorized = new Set(bundled.flatMap((subcategory) => subcategory.itemIds));
  const remoteExtras = remoteIdsForPromptCategory(key).filter((id) => !categorized.has(id));
  if (remoteExtras.length === 0) return bundled;
  return [...bundled, { key: 'more', label: 'More', itemIds: remoteExtras }];
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

export type GuidedFavoriteItemsByCategory = Record<string, string[]>;

function groupFavoriteItems(itemIds: string[]): GuidedFavoriteItemsByCategory {
  const grouped: GuidedFavoriteItemsByCategory = {};
  for (const id of new Set(itemIds)) {
    const category = reflectCategoryForItem(id);
    if (!category) continue;
    (grouped[category] ??= []).push(id);
  }
  return grouped;
}

/** Explicit Guided Prompt selection history, isolated by prompt category. */
export function getGuidedFavoriteItems(): GuidedFavoriteItemsByCategory {
  try {
    const raw = storage.getString(kGuidedFavoriteItems.name);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    // Migrate the pre-category array format in memory. It is written back in
    // the grouped format after the next successful Guided reflection.
    if (Array.isArray(parsed)) {
      return groupFavoriteItems(
        parsed.filter((id): id is string => typeof id === 'string' && id.length > 0),
      );
    }
    if (!parsed || typeof parsed !== 'object') return {};
    const grouped: GuidedFavoriteItemsByCategory = {};
    for (const [category, ids] of Object.entries(parsed)) {
      if (!BY_KEY.has(category) || !Array.isArray(ids)) continue;
      grouped[category] = [...new Set(ids.filter(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && reflectCategoryForItem(id) === category,
      ))];
    }
    return grouped;
  } catch {
    return {};
  }
}

export function rememberGuidedFavoriteItems(itemIds: string[]): GuidedFavoriteItemsByCategory {
  const existing = getGuidedFavoriteItems();
  const merged = groupFavoriteItems([
    ...Object.values(existing).flat(),
    ...itemIds,
  ]);
  storage.set(kGuidedFavoriteItems.name, JSON.stringify(merged));
  return merged;
}

export function guidedCategoryFor(key: string): GuidedCategory {
  return (
    BY_KEY.get(key) ?? { key, label: key, emoji: '✨', question: 'Anything to note today?' }
  );
}
