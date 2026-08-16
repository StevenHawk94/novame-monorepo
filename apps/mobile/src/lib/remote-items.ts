/**
 * OTA items (2026-08-08): the first batch of memory items ships in the bundle
 * (assets/items/each + the compiled dictionary); LATER items arrive with no
 * app release via R2:
 *
 *   Items/items-manifest.json   the catalog additions
 *   Items/<id>.webp             each new item's art (256px, transparent)
 *
 * Manifest shape:
 *   { "version": 1,
 *     "items": [ { "id": "food_drink.boba", "name": "Boba",
 *                  "bagsCategory": "Food & Fun",
 *                  "promptCategory": "Food & Drink",
 *                  "keywords": ["boba", "bubble tea"] } ] }
 *
 * The app refreshes the manifest at launch (prefetch) into device-scoped
 * MMKV; every consumer then reads the MERGED view: bundled dictionary first,
 * remote additions second. Images render straight from R2 through expo-image
 * (disk-cached). The server mirrors the same merge for text matching,
 * validation and the items-table upsert (apps/api/src/lib/remote-items.js).
 */
import { ITEM_DICTIONARY, type ItemDictionary } from '@novame/engine';
import { Image as ExpoImage } from 'expo-image';

import { storage } from './storage';
import { kRemoteItems } from '../shared/storage/keys';

const R2_BASE = 'https://media.novameapp.com';
const MANIFEST_URL = `${R2_BASE}/Items/items-manifest.json`;

export interface RemoteItem {
  id: string;
  name: string;
  bagsCategory: string;
  promptCategory?: string;
  keywords?: string[];
  imageKey?: string;
}

export interface RemoteKeywordPatch {
  keyword: string;
  itemId: string;
  safetyMode?: 'AUTO' | 'AUTO_UNLESS_EXCLUDED' | 'NEVER_AUTO';
  exclusions?: string[];
}

interface RemoteItemsState {
  version: number | string;
  items: RemoteItem[];
  keywordPatches: RemoteKeywordPatch[];
  fetchedAtMs: number;
}

let memo: RemoteItemsState | null | undefined;

function readState(): RemoteItemsState | null {
  if (memo !== undefined) return memo;
  try {
    const raw = storage.getString(kRemoteItems.name);
    memo = raw ? (JSON.parse(raw) as RemoteItemsState) : null;
  } catch {
    memo = null;
  }
  return memo;
}

/** Fetch + persist the manifest (launch/prefetch; failures keep the cache). */
export async function refreshRemoteItems(): Promise<void> {
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`);
    if (!res.ok) return;
    const data = (await res.json()) as { version?: number | string; items?: RemoteItem[]; keywordPatches?: RemoteKeywordPatch[] };
    if (!Array.isArray(data.items)) return;
    const previous = readState();
    if (previous && String(previous.version) === String(data.version ?? 1)) return;
    const valid = data.items.filter(
      (it) => it && typeof it.id === 'string' && typeof it.name === 'string' && it.id.length > 0,
    );
    const state: RemoteItemsState = {
      version: data.version ?? 1,
      items: valid,
      keywordPatches: Array.isArray(data.keywordPatches) ? data.keywordPatches : [],
      fetchedAtMs: Date.now(),
    };
    // Stage a complete version before making its rules visible. Downloads run
    // in small batches because this function itself is launched in the
    // background during prefetch; a failed batch keeps the previous version.
    for (let i = 0; i < valid.length; i += 8) {
      const results = await Promise.all(valid.slice(i, i + 8).map((item) => {
        const key = item.imageKey;
        const uri = key
          ? `${R2_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`
          : `${R2_BASE}/Items/${encodeURIComponent(item.id)}.webp`;
        return ExpoImage.prefetch(uri, 'disk');
      }));
      if (results.some((ok) => !ok)) return;
    }
    storage.set(kRemoteItems.name, JSON.stringify(state));
    memo = state;
  } catch {
    // offline — cached manifest keeps serving
  }
}

/** All remote additions (empty until the first manifest lands). */
export function remoteItems(): RemoteItem[] {
  return readState()?.items ?? [];
}

/** Remote definition for an id, or null. */
export function remoteItemDef(id: string): RemoteItem | null {
  return remoteItems().find((it) => it.id === id) ?? null;
}

/** R2 art URL for a remote item. */
export function remoteImageUri(id: string): string {
  const key = remoteItemDef(id)?.imageKey;
  if (key) return `${R2_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return `${R2_BASE}/Items/${encodeURIComponent(id)}.webp`;
}

/** Bundled + cloud items and manually-published keyword patches. */
export function mergedItemDictionary(): ItemDictionary {
  const state = readState();
  if (!state) return ITEM_DICTIONARY;
  const items: ItemDictionary['items'] = { ...ITEM_DICTIONARY.items };
  const synonyms = { ...ITEM_DICTIONARY.synonyms };
  const exclusions = { ...(ITEM_DICTIONARY.exclusions ?? {}) };
  for (const item of state.items) {
    if (!items[item.id]) items[item.id] = {
      displayName: item.name, category: item.promptCategory ?? 'Uncategorized',
      bagsCategory: item.bagsCategory ?? 'Stuff', rarity: 'common',
    };
    for (const raw of item.keywords ?? []) {
      const keyword = raw.trim().toLowerCase();
      if (keyword && !synonyms[keyword]) synonyms[keyword] = item.id;
    }
  }
  for (const patch of state.keywordPatches ?? []) {
    const keyword = patch.keyword?.trim().toLowerCase();
    if (!keyword || !items[patch.itemId] || patch.safetyMode === 'NEVER_AUTO') continue;
    if (!synonyms[keyword]) synonyms[keyword] = patch.itemId;
    if (patch.safetyMode === 'AUTO_UNLESS_EXCLUDED' && patch.exclusions?.length) {
      exclusions[keyword] = patch.exclusions;
    }
  }
  return { items, synonyms, exclusions };
}

/** MERGED display name: bundled dictionary first, then remote, then the id. */
export function itemDisplayName(id: string): string {
  return ITEM_DICTIONARY.items[id]?.displayName ?? remoteItemDef(id)?.name ?? id;
}

/** MERGED bags category (null when unknown). */
export function itemBagsCategory(id: string): string | null {
  return ITEM_DICTIONARY.items[id]?.bagsCategory ?? remoteItemDef(id)?.bagsCategory ?? null;
}

/** Remote ids belonging to a guided prompt category. */
export function remoteIdsForPromptCategory(category: string): string[] {
  return remoteItems()
    .filter((it) => it.promptCategory === category)
    .map((it) => it.id);
}
