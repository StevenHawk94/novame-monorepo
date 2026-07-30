/**
 * Home scenes ("Maps") — catalog + selection (2026-07-30).
 *
 * Mirrors outfits.ts: the catalog lives in R2's video-manifest.json under
 * `scenes` (name/price/plusOnly + the Maps/<Name>.webp home background and
 * Maps/<Name>-Small.webp grid thumb), so new scenes ship without an app
 * release. The free default (Mushroom Wood) is bundled and NOT in the
 * manifest — any legacy/unknown selection value falls back to it.
 *
 * Selection reuses cosmetics-store's sceneId slot (values are scene keys
 * now; old 'scene1'..'scene6' values read as the default). Ownership is
 * server-authoritative via cosmetic_unlocks type 'scene'.
 */
import { kSceneCatalog } from '../shared/storage/keys';
import { storage } from './storage';
import { getSelectedScene } from './cosmetics-store';

const R2_BASE = 'https://media.novameapp.com';
const MANIFEST_URL = `${R2_BASE}/video-manifest.json`;

export const DEFAULT_SCENE_KEY = 'mushroom-wood';

// Bundled default scene art (free): home background + Maps grid thumb.
export const DEFAULT_SCENE_BG = require('../../assets/Background/Mushroom-Wood.webp');
export const DEFAULT_SCENE_THUMB = require('../../assets/Background/Mushroom-Wood-Small.webp');

export interface SceneDef {
  key: string;
  name: string;
  price: number;
  plusOnly: boolean;
  /** R2 object keys under Maps/. */
  image: string;
  thumb: string;
}

export function sceneAssetUrl(objectKey: string): string {
  return `${R2_BASE}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

export function getCachedSceneCatalog(): SceneDef[] {
  const raw = storage.getString(kSceneCatalog.name);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SceneDef[];
  } catch {
    return [];
  }
}

export async function fetchSceneCatalog(): Promise<SceneDef[]> {
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`);
    if (!res.ok) return getCachedSceneCatalog();
    const manifest = (await res.json()) as { scenes?: SceneDef[] };
    const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
    if (scenes.length > 0) storage.set(kSceneCatalog.name, JSON.stringify(scenes));
    return scenes.length > 0 ? scenes : getCachedSceneCatalog();
  } catch {
    return getCachedSceneCatalog();
  }
}

/**
 * The Home background source for the currently selected scene. Remote scenes
 * render via expo-image's disk cache (prefetched at launch); the default —
 * and any legacy 'sceneN' value — is the bundled art.
 */
export function getHomeSceneSource(): number | { uri: string } {
  const selected = getSelectedScene();
  if (!selected || selected === DEFAULT_SCENE_KEY || /^scene\d+$/.test(selected)) {
    return DEFAULT_SCENE_BG;
  }
  const def = getCachedSceneCatalog().find((s) => s.key === selected);
  return def ? { uri: sceneAssetUrl(def.image) } : DEFAULT_SCENE_BG;
}
