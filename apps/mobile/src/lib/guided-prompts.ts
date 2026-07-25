/**
 * Guided Prompts (流程2) 配置与持久化 (2026-07-24 需求).
 *
 * The chooser lists every category that exists in the runtime dictionary,
 * in this file's order; the user picks 3-20 and gets ONE prompt page per
 * pick. The selection persists per user (kGuidedCategories) — first run
 * shows the chooser, later runs jump straight to the prompt pages, and the
 * pages' Edit button reopens the chooser.
 *
 * DATA-DRIVEN ON PURPOSE: entries cover the NEW 14-category taxonomy (the
 * 2026-07-24 CSV, sheets pending) AND today's 23-category dictionary, keyed
 * by category prefix. When the new dictionary is generated the chooser
 * shrinks to the 14 automatically — zero code change. Any category missing
 * here still renders via the fallback (capitalized key + generic question).
 */
import { ITEM_DICTIONARY } from '@novame/engine';

import { kGuidedCategories } from '../shared/storage/keys';
import { storage } from './storage';

export const GUIDED_MIN = 3;
export const GUIDED_MAX = 20;

export interface GuidedCategory {
  key: string;
  label: string;
  emoji: string;
  question: string;
}

// Order = chooser order = prompt-page order.
const CONFIG: GuidedCategory[] = [
  // ---- the 2026-07-24 taxonomy (14, live after the next dictionary run) ----
  { key: 'emotions', label: 'Emotions', emoji: '💛', question: 'How do you feel today?' },
  { key: 'eating', label: 'Eating', emoji: '🍜', question: 'What did you eat today?' },
  { key: 'exercise', label: 'Exercise', emoji: '🏃', question: 'How did you move today?' },
  { key: 'hobby', label: 'Hobby', emoji: '🎨', question: 'What did you do for fun today?' },
  { key: 'relaxing', label: 'Relaxing', emoji: '🛋️', question: 'How did you unwind today?' },
  { key: 'social', label: 'Social', emoji: '👥', question: 'Who did you spend time with today?' },
  { key: 'outdoor', label: 'Nature & Outdoor', emoji: '🏞️', question: 'Did you get outside today?' },
  { key: 'petting', label: 'Pets & Animals', emoji: '🐾', question: 'Any animal moments today?' },
  { key: 'gardening', label: 'Gardening', emoji: '🪴', question: 'Did you tend your plants today?' },
  { key: 'beauty', label: 'Beauty', emoji: '💅', question: 'Any self-care today?' },
  { key: 'health', label: 'Health', emoji: '🩺', question: 'How was your health today?' },
  { key: 'routine', label: 'Routine', emoji: '⏰', question: 'Which routines did you keep today?' },
  { key: 'chores', label: 'Chores', emoji: '🧹', question: 'Which chores did you get done?' },
  { key: 'better_me', label: 'Better Me', emoji: '🌱', question: 'How did you grow today?' },
  // ---- today's dictionary (until the regen; overlapping keys stay above) ---
  { key: 'food', label: 'Food & Drinks', emoji: '🍜', question: 'What did you eat today?' },
  { key: 'sports', label: 'Sports', emoji: '🏃', question: 'How did you move today?' },
  { key: 'entertainment', label: 'Entertainment', emoji: '🎮', question: 'What did you do for fun today?' },
  { key: 'relax', label: 'Relaxing', emoji: '🛋️', question: 'How did you unwind today?' },
  { key: 'music', label: 'Music', emoji: '🎵', question: 'Any music in your day?' },
  { key: 'plants', label: 'Plants', emoji: '🪴', question: 'Did you tend your plants today?' },
  { key: 'animals', label: 'Pets & Animals', emoji: '🐾', question: 'Any animal moments today?' },
  { key: 'nature', label: 'Nature', emoji: '🏞️', question: 'Did you get outside today?' },
  { key: 'routines', label: 'Routine', emoji: '⏰', question: 'Which routines did you keep today?' },
  { key: 'home', label: 'Home', emoji: '🏠', question: 'Anything around the house today?' },
  { key: 'kitchen', label: 'Cooking', emoji: '🍳', question: 'Did you cook something today?' },
  { key: 'work', label: 'Work', emoji: '💼', question: 'How was work today?' },
  { key: 'places', label: 'Places', emoji: '📍', question: 'Where did your day take you?' },
  { key: 'transport', label: 'Getting Around', emoji: '🚌', question: 'How did you get around today?' },
  { key: 'shopping', label: 'Shopping', emoji: '🛍️', question: 'Any errands or shopping today?' },
  { key: 'celebrations', label: 'Celebrations', emoji: '🎉', question: 'Anything worth celebrating today?' },
  { key: 'clothing', label: 'Clothing', emoji: '👕', question: 'What did you wear today?' },
  { key: 'belongings', label: 'Belongings', emoji: '🎒', question: 'Anything you carried or used today?' },
  { key: 'appliances', label: 'Appliances', emoji: '🔌', question: 'Any gadgets in your day?' },
  { key: 'professions', label: 'People', emoji: '🧑‍💼', question: 'Anyone you crossed paths with today?' },
];

const BY_KEY = new Map(CONFIG.map((c) => [c.key, c]));

function fallbackFor(key: string): GuidedCategory {
  const label = key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  return { key, label, emoji: '✨', question: `Anything about ${label.toLowerCase()} today?` };
}

/** Every category present in the runtime dictionary, in chooser order. */
export function availableGuidedCategories(): GuidedCategory[] {
  const present = new Set(Object.values(ITEM_DICTIONARY.items).map((d) => d.category));
  const out: GuidedCategory[] = [];
  for (const c of CONFIG) {
    if (present.has(c.key)) {
      out.push(c);
      present.delete(c.key);
    }
  }
  for (const key of present) out.push(fallbackFor(key));
  return out;
}

/** The stored picks, filtered to categories that still exist (regen-safe). */
export function getGuidedSelection(): string[] {
  try {
    const raw = storage.getString(kGuidedCategories.name);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(availableGuidedCategories().map((c) => c.key));
    return parsed.filter((k): k is string => typeof k === 'string' && valid.has(k));
  } catch {
    return [];
  }
}

export function setGuidedSelection(keys: string[]): void {
  storage.set(kGuidedCategories.name, JSON.stringify(keys.slice(0, GUIDED_MAX)));
}

export function guidedCategoryFor(key: string): GuidedCategory {
  return BY_KEY.get(key) ?? fallbackFor(key);
}
