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
import { ITEM_DICTIONARY } from '@novame/engine';

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
}

interface RemoteItemsState {
  version: number;
  items: RemoteItem[];
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
    const data = (await res.json()) as { version?: number; items?: RemoteItem[] };
    if (!Array.isArray(data.items)) return;
    const valid = data.items.filter(
      (it) => it && typeof it.id === 'string' && typeof it.name === 'string' && it.id.length > 0,
    );
    const state: RemoteItemsState = {
      version: data.version ?? 1,
      items: valid,
      fetchedAtMs: Date.now(),
    };
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
  return `${R2_BASE}/Items/${encodeURIComponent(id)}.webp`;
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
