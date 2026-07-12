/**
 * Reflect Feed data (C11b): the user's OWN reflections grouped by day, each with
 * the items collected that day. Private -- friends never see this (they get the
 * emoji glimpse only). Item emoji resolved from the shared dictionary by id.
 */
import { ITEM_DICTIONARY } from '@novame/engine';

import { apiClient } from './api';
import { supabase } from './supabase';

export interface FeedDay {
  date: string;
  reflects: { id: string; body: string }[];
  itemIds: string[];
  itemEmoji: string[]; // decorated
}

function emojiFor(itemId: string): string {
  return ITEM_DICTIONARY.items[itemId]?.emoji ?? '✨';
}

export async function fetchReflectFeed(): Promise<FeedDay[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return [];

  try {
    const data = await apiClient.get<{
      success?: boolean;
      days?: { date: string; reflects: { id: string; body: string }[]; itemIds: string[] }[];
    }>(`/api/reflect-feed?userId=${encodeURIComponent(userId)}`);
    if (!data.success || !data.days) return [];
    return data.days.map((d) => ({ ...d, itemEmoji: d.itemIds.map(emojiFor) }));
  } catch {
    return [];
  }
}

/** A day label like "Jul 12" from a YYYY-MM-DD string. */
export function formatDayLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
