import * as FileSystem from 'expo-file-system/legacy';
import { fetchRoomPhoto } from './app-major-update-api';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { storage } from './storage';
import { BURROW_ROOM_PHOTO_DIRECTORY, waitForRoomPhotoCleanup } from '../shared/storage/artifacts';
import { kBurrowRoomPhotoCache } from '../shared/storage/keys';

export type RoomPhotoVersion = { id: string; updatedAt: string };
type Index = Record<string, string>;
const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let downloadGeneration = 0;
subscribeSessionIdentity(() => { memory.clear(); inflight.clear(); });

export const roomPhotoVersionKey = (photo: RoomPhotoVersion) => `${photo.id}:${photo.updatedAt}`;

function index(): Index {
  try { return JSON.parse(storage.getString(kBurrowRoomPhotoCache.name) || '{}') as Index; }
  catch { return {}; }
}
function persist(key: string, uri: string) {
  if (!BURROW_ROOM_PHOTO_DIRECTORY) return;
  memory.set(key, uri);
  const next = { ...index(), [key]: uri };
  // Keep current versions, not an unbounded copy of every replacement. Only
  // delete validated app-private files which no retained/in-flight key uses.
  const removed: string[] = [];
  for (const old of Object.keys(next)) {
    if (old !== key && !inflight.has(old) && (old.startsWith(`${key.split(':')[0]}:`) || Object.keys(next).length > 40)) {
      removed.push(next[old]); delete next[old]; memory.delete(old);
    }
  }
  storage.set(kBurrowRoomPhotoCache.name, JSON.stringify(next));
  for (const path of removed) if (path.startsWith(BURROW_ROOM_PHOTO_DIRECTORY) && !Object.values(next).includes(path))
    void FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
}
function filePath(key: string): string | null {
  if (!BURROW_ROOM_PHOTO_DIRECTORY) return null;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return `${BURROW_ROOM_PHOTO_DIRECTORY}${(hash >>> 0).toString(16).padStart(8, '0')}.jpg`;
}

/** Synchronous lookup lets Home render its photo on the first frame after bootstrap. */
export function cachedRoomPhotoUri(photo?: RoomPhotoVersion): string | null {
  if (!photo) return null;
  const key = roomPhotoVersionKey(photo);
  const hit = memory.get(key) ?? index()[key];
  if (hit) memory.set(key, hit);
  return hit ?? null;
}

/** The uploaded crop is copied out of Expo's disposable cache before closing. */
export async function keepRoomPhotoPreview(photo: RoomPhotoVersion, sourceUri: string): Promise<string> {
  const key = roomPhotoVersionKey(photo);
  const path = filePath(key);
  if (!path) { memory.set(key, sourceUri); return sourceUri; }
  const epoch = sessionEpoch();
  await waitForRoomPhotoCleanup();
  await FileSystem.makeDirectoryAsync(BURROW_ROOM_PHOTO_DIRECTORY!, { intermediates: true });
  const temporary = `${path}.${epoch}.part`;
  await FileSystem.deleteAsync(temporary, { idempotent: true });
  if (sourceUri.startsWith('data:image/jpeg;base64,'))
    await FileSystem.writeAsStringAsync(temporary, sourceUri.slice('data:image/jpeg;base64,'.length), { encoding: FileSystem.EncodingType.Base64 });
  else await FileSystem.copyAsync({ from: sourceUri, to: temporary });
  if (epoch !== sessionEpoch()) { await FileSystem.deleteAsync(temporary, { idempotent: true }); throw new Error('session_changed'); }
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: temporary, to: path });
  if (epoch !== sessionEpoch()) { await FileSystem.deleteAsync(path, { idempotent: true }); throw new Error('session_changed'); }
  persist(key, path);
  return path;
}

/** Single-flight download uses a fresh signed link only on a cache miss. */
export function loadRoomPhoto(photo: RoomPhotoVersion): Promise<string> {
  const key = roomPhotoVersionKey(photo);
  const existing = inflight.get(key);
  if (existing) return existing;
  const epoch = sessionEpoch();
  const task = (async () => {
    const cached = cachedRoomPhotoUri(photo);
    if (cached) {
      if (!BURROW_ROOM_PHOTO_DIRECTORY || !cached.startsWith(BURROW_ROOM_PHOTO_DIRECTORY)) return cached;
      if ((await FileSystem.getInfoAsync(cached)).exists) return cached;
      invalidateRoomPhotoCache(photo);
    }
    const signedUrl = await fetchRoomPhoto(photo.id, photo.updatedAt);
    if (epoch !== sessionEpoch()) throw new Error('session_changed');
    const basePath = filePath(key);
    if (!basePath) { memory.set(key, signedUrl); return signedUrl; }
    // A failed image decode can be cached by Expo Image/Skia against its URI.
    // Give each recovery download a new file name so both renderers retry.
    const path = `${basePath.slice(0, -4)}-${Date.now().toString(36)}-${++downloadGeneration}.jpg`;
    await waitForRoomPhotoCleanup();
    await FileSystem.makeDirectoryAsync(BURROW_ROOM_PHOTO_DIRECTORY!, { intermediates: true });
    const temporary = `${path}.${epoch}.download`;
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    const response = await FileSystem.downloadAsync(signedUrl, temporary);
    if (response.status < 200 || response.status >= 300 || epoch !== sessionEpoch()) {
      await FileSystem.deleteAsync(temporary, { idempotent: true });
      throw new Error(epoch !== sessionEpoch() ? 'session_changed' : 'photo_download_failed');
    }
    await FileSystem.deleteAsync(path, { idempotent: true });
    await FileSystem.moveAsync({ from: temporary, to: path });
    if (epoch !== sessionEpoch()) { await FileSystem.deleteAsync(path, { idempotent: true }); throw new Error('session_changed'); }
    persist(key, path);
    return path;
  })().finally(() => { if (inflight.get(key) === task) inflight.delete(key); });
  inflight.set(key, task);
  return task;
}

/** Recover from a missing/corrupt local file without clearing unrelated photos. */
export function invalidateRoomPhotoCache(photo: RoomPhotoVersion) {
  const key = roomPhotoVersionKey(photo);
  const uri = cachedRoomPhotoUri(photo);
  memory.delete(key);
  const next = index();
  delete next[key];
  storage.set(kBurrowRoomPhotoCache.name, JSON.stringify(next));
  if (uri?.startsWith(BURROW_ROOM_PHOTO_DIRECTORY ?? '\0')) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
