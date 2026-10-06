import { storage } from './storage';
import { kBurrowSnapshot, kBurrowActionKeys } from '../shared/storage/keys';
import type { MajorUpdateBootstrap } from './app-major-update-api';

const MAX_CACHE_AGE = 7 * 86_400_000;
/** Only personal display state survives a process restart. Partner journal/photo
 * content always requires a fresh authorization check, never an offline snapshot. */
export function persistBurrowSnapshot(data: MajorUpdateBootstrap, elapsedMs = 0) {
  try {
    const id = data.profile.id;
    const personal = { ...data, roomPhotos: data.roomPhotos.filter(photo => photo.ownerId === id),
      memoryEntries: data.memoryEntries.filter(entry => entry.author_id === id),
      moments: data.moments.filter(event => event.actor_id === id), affectionInbox: [], gifts: [] };
    storage.set(kBurrowSnapshot.name, JSON.stringify({ version: 1, owner: id, savedAt: Date.now() - Math.max(0, elapsedMs), data: personal }));
  } catch { /* A full device must not turn a committed command into a failure. */ }
}
export function readBurrowSnapshot(owner: string) {
  try {
    const raw = storage.getString(kBurrowSnapshot.name);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || record.owner !== owner || record.data?.profile?.id !== owner
      || !Number.isFinite(record.savedAt) || record.savedAt > Date.now() + 60_000 || Date.now() - record.savedAt > MAX_CACHE_AGE
      || !['catalog', 'loadouts', 'roomPhotos', 'inventory', 'moments', 'memoryEntries'].every(key => Array.isArray(record.data[key]))) return null;
    return record as { data: MajorUpdateBootstrap; savedAt: number };
  } catch { return null; }
}
export function clearBurrowSnapshot() { try { storage.remove(kBurrowSnapshot.name); } catch {} }
export function persistBurrowActionKeys(owner: string, keys: Map<string, string>) {
  try { storage.set(kBurrowActionKeys.name, JSON.stringify({ owner, keys: [...keys].slice(-100) })); } catch {}
}
export function readBurrowActionKeys(owner: string): [string, string][] {
  try {
    const record = JSON.parse(storage.getString(kBurrowActionKeys.name) ?? 'null');
    if (record?.owner !== owner || !Array.isArray(record.keys)) return [];
    return record.keys.filter((item: unknown) => Array.isArray(item) && item.length === 2 && item.every(value => typeof value === 'string')).slice(-100);
  } catch { return []; }
}
