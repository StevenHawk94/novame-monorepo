/**
 * Reflect Feed data (C11b): the user's OWN reflections grouped by day, each with
 * the items collected that day. Private -- friends never see this (they get the
 * emoji glimpse only). Item emoji resolved from the shared dictionary by id.
 */
import { ITEM_DICTIONARY } from '@novame/engine';

import { apiClient } from './api';
import { storage } from './storage';
import { kReflectFeed } from '../shared/storage/keys';
import { supabase } from './supabase';

export interface FeedDay {
  date: string;
  reflects: {
    id: string;
    body: string;
    sharedToFriends: boolean;
    itemIds: string[];
    hasMemories: boolean;
  }[];
  itemIds: string[];
  itemEmoji: string[]; // decorated
}

interface ReflectFeedCache {
  days: FeedDay[];
  fetchedAtMs: number;
}

const REFLECT_FEED_TTL_MS = 15 * 60 * 1000;
let feedInflight: Promise<FeedDay[]> | null = null;

function emojiFor(itemId: string): string {
  return ITEM_DICTIONARY.items[itemId]?.emoji ?? '✨';
}

function readCache(): ReflectFeedCache | null {
  const raw = storage.getString(kReflectFeed.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReflectFeedCache | FeedDay[];
    if (Array.isArray(parsed)) return { days: parsed, fetchedAtMs: 0 };
    if (Array.isArray(parsed.days)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Cached feed for cache-first render (returns [] if none). */
export function getCachedFeed(): FeedDay[] {
  return readCache()?.days ?? [];
}

export function fetchReflectFeed(options?: { force?: boolean }): Promise<FeedDay[]> {
  const cached = readCache();
  const cacheHasMemoryStatus = cached?.days.every((day) =>
    day.reflects.every((reflect) => typeof reflect.hasMemories === 'boolean'),
  );
  if (!options?.force && cached && cacheHasMemoryStatus && Date.now() - cached.fetchedAtMs < REFLECT_FEED_TTL_MS) {
    return Promise.resolve(cached.days);
  }
  if (feedInflight) return feedInflight;

  feedInflight = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return getCachedFeed();
    try {
      const data = await apiClient.get<{
        success?: boolean;
        days?: {
          date: string;
          reflects: {
            id: string;
            body: string;
            sharedToFriends: boolean;
            itemIds?: string[];
            hasMemories?: boolean;
          }[];
          itemIds: string[];
        }[];
      }>(`/api/reflect-feed?userId=${encodeURIComponent(userId)}`);
      if (!data.success || !data.days) return getCachedFeed();
      const days = data.days.map((d) => ({
        ...d,
        reflects: d.reflects.map((reflect) => ({
          ...reflect,
          itemIds: reflect.itemIds ?? [],
          hasMemories: reflect.hasMemories === true,
        })),
        itemEmoji: d.itemIds.map(emojiFor),
      }));
      storage.set(
        kReflectFeed.name,
        JSON.stringify({ days, fetchedAtMs: Date.now() } satisfies ReflectFeedCache),
      );
      return days;
    } catch {
      return getCachedFeed();
    } finally {
      feedInflight = null;
    }
  })();
  return feedInflight;
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
