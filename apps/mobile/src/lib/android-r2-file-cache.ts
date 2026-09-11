/**
 * Android-only durable file cache for R2 P0 assets.
 *
 * expo-image prefetch enters the native image pipeline. That is useful on iOS,
 * but warming dozens of Android assets can compete for decode/memory work with
 * the visible screen. P0 therefore lands as opaque files first and is decoded
 * only when a mounted Image actually needs it.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { kAndroidR2FileIndex } from '../shared/storage/keys';
import { storage } from './storage';

const CACHE_DIR = `${FileSystem.cacheDirectory}burrow-r2-p0/`;
const R2_ORIGIN = 'https://media.novameapp.com/';

type CacheIndex = Record<string, string>;

function readIndex(): CacheIndex {
  if (Platform.OS !== 'android') return {};
  try {
    const raw = storage.getString(kAndroidR2FileIndex.name);
    return raw ? JSON.parse(raw) as CacheIndex : {};
  } catch {
    return {};
  }
}

const index = readIndex();
const inflight = new Map<string, Promise<string | null>>();
let directoryReady: Promise<void> | null = null;

function writeIndex(): void {
  storage.set(kAndroidR2FileIndex.name, JSON.stringify(index));
}

function stableHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

function extensionFor(url: string): string {
  const path = url.split('?')[0] ?? '';
  const match = path.match(/\.([A-Za-z0-9]{1,6})$/);
  return match ? `.${match[1]!.toLowerCase()}` : '.bin';
}

function pathFor(url: string): string {
  return `${CACHE_DIR}${stableHash(url)}${extensionFor(url)}`;
}

function logicalAssetUrl(url: string): string {
  return url.split('?')[0] ?? url;
}

function retireOlderVersion(url: string): void {
  const logicalUrl = logicalAssetUrl(url);
  for (const [indexedUrl, uri] of Object.entries(index)) {
    if (indexedUrl === url || logicalAssetUrl(indexedUrl) !== logicalUrl) continue;
    delete index[indexedUrl];
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

function ensureDirectory(): Promise<void> {
  if (!directoryReady) {
    directoryReady = FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true })
      .catch(() => {});
  }
  return directoryReady;
}

export function isR2Url(url: string): boolean {
  return url.startsWith(R2_ORIGIN);
}

/** Synchronous render lookup. The worker validates the file before indexing it. */
export function getAndroidR2CachedUri(url: string): string | null {
  if (Platform.OS !== 'android' || !isR2Url(url)) return null;
  return index[url] ?? null;
}

/** iOS keeps the remote source; Android renders only a verified local file. */
export function androidR2ImageSource(url: string): { uri: string } | null {
  if (Platform.OS !== 'android') return { uri: url };
  const cached = getAndroidR2CachedUri(url);
  return cached ? { uri: cached } : null;
}

/** Remove a stale index entry after a local-file render error. */
export function invalidateAndroidR2CachedFile(url: string): void {
  if (Platform.OS !== 'android') return;
  const uri = index[url];
  if (!uri) return;
  delete index[url];
  writeIndex();
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function isAndroidR2FileCached(url: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !isR2Url(url)) return false;
  const uri = index[url] ?? pathFor(url);
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || (info.size ?? 0) <= 0) {
      if (index[url]) {
        delete index[url];
        writeIndex();
      }
      return false;
    }
    if (index[url] !== uri) {
      index[url] = uri;
      writeIndex();
    }
    return true;
  } catch {
    return false;
  }
}

/** Download without decoding. Concurrent visible/P0 requests share one file job. */
export function ensureAndroidR2FileCached(url: string): Promise<string | null> {
  if (Platform.OS !== 'android' || !isR2Url(url)) return Promise.resolve(null);
  const active = inflight.get(url);
  if (active) return active;

  const task = (async () => {
    if (await isAndroidR2FileCached(url)) return getAndroidR2CachedUri(url);
    await ensureDirectory();
    const destination = pathFor(url);
    const partial = `${destination}.part`;
    await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
    try {
      const result = await FileSystem.downloadAsync(url, partial);
      if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}`);
      const info = await FileSystem.getInfoAsync(partial);
      if (!info.exists || (info.size ?? 0) <= 0) throw new Error('Empty R2 asset');
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      await FileSystem.moveAsync({ from: partial, to: destination });
      retireOlderVersion(url);
      index[url] = destination;
      writeIndex();
      return destination;
    } catch {
      await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, task);
  return task;
}

/** Test/logout helper; device cache normally survives account switches. */
export function resetAndroidR2FileIndexForTests(): void {
  for (const key of Object.keys(index)) delete index[key];
  if (Platform.OS === 'android') writeIndex();
}
