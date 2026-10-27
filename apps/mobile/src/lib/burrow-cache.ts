import { storage } from './storage';
import { kBurrowSnapshot, kBurrowWallet, kBurrowActionKeys } from '../shared/storage/keys';
import type { MajorUpdateBootstrap } from './app-major-update-api';
import type { CoinWallet, CoinWalletState } from './coin-reward-ledger';
import { questProgress } from './quest-progress-store';

/** Save only confirmed money synchronously, not an entire room/catalogue on
 * every receipt. A restart overlays this small journal onto the room cache. */
export function persistBurrowWallet(owner: string, wallet: CoinWallet, coinState?: CoinWalletState) {
  try { storage.set(kBurrowWallet.name, JSON.stringify({ owner, wallet, coinState })); } catch {}
}
function restoreWallet(owner: string, data: MajorUpdateBootstrap) {
  try {
    const receipt = JSON.parse(storage.getString(kBurrowWallet.name) ?? 'null');
    const wallet = receipt?.wallet;
    if (receipt?.owner === owner && Number.isSafeInteger(wallet?.balance)
      && Number.isSafeInteger(wallet?.version) && wallet.version >= 0
      && wallet.version > data.wallet.version) {
      data.wallet = wallet;
      data.coinState = receipt.coinState?.wallet?.version === wallet.version
        && receipt.coinState.wallet.balance === wallet.balance ? receipt.coinState : undefined;
    }
  } catch { /* The complete room snapshot is still usable. */ }
}

/** Only personal display state survives a process restart. Partner journal/photo
 * content always requires a fresh authorization check, never an offline snapshot. */
export function persistBurrowSnapshot(data: MajorUpdateBootstrap, elapsedMs = 0) {
  try {
    data = questProgress.unproject(data);
    const id = data.profile.id;
    const personal = { ...data, roomPhotos: data.roomPhotos.filter(photo => photo.ownerId === id),
      memoryEntries: data.memoryEntries.filter(entry => entry.author_id === id),
      moments: data.moments.filter(event => event.actor_id === id), affectionInbox: [],affectionInboxGroups:[], gifts: [] };
    delete personal.pairAccessVerified;
    storage.set(kBurrowSnapshot.name, JSON.stringify({ version: 1, owner: id, savedAt: Date.now() - Math.max(0, elapsedMs), data: personal }));
  } catch { /* A full device must not turn a committed command into a failure. */ }
}
export function readBurrowSnapshot(owner: string) {
  try {
    const raw = storage.getString(kBurrowSnapshot.name);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || record.owner !== owner || record.data?.profile?.id !== owner
      || !Number.isFinite(record.savedAt) || record.savedAt > Date.now() + 60_000
      || !['catalog', 'loadouts', 'roomPhotos', 'inventory', 'moments', 'memoryEntries'].every(key => Array.isArray(record.data[key]))) return null;
    // A complete server catalogue remains a complete DISPLAY snapshot after
    // restart. Background sync updates it atomically; every writer still checks
    // the current price, entitlement and pair. Never promote an old partial one.
    const data:MajorUpdateBootstrap={...record.data};
    // The test-stage window catalogue was explicitly replaced, not remapped.
    // Do not briefly resurrect deleted names/ownership/placements on restart.
    const oldWindows = new Set(data.catalog.filter(item => item.category === 'windows' &&
      (!item.stable_id.startsWith('window_frame_') || !item.metadata?.windowFrameKey)).map(item => item.stable_id));
    if (oldWindows.size) {
      data.catalog = data.catalog.filter(item => !oldWindows.has(item.stable_id));
      data.inventory = data.inventory.filter(row => !oldWindows.has(row.item_id));
      data.loadouts = data.loadouts.filter(row => !oldWindows.has(row.item_id));
      data.moments = data.moments.filter(event => ![...oldWindows].some(id => JSON.stringify(event.payload ?? {}).includes(JSON.stringify(id))));
    }
    restoreWallet(owner, data);
    delete data.pairAccessVerified;
    return {...record,data} as { data: MajorUpdateBootstrap; savedAt: number };
  } catch { return null; }
}
export function clearBurrowSnapshot() {
  try { storage.remove(kBurrowSnapshot.name); } catch {}
  try { storage.remove(kBurrowWallet.name); } catch {}
}
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
