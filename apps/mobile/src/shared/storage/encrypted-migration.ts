/** Frozen pre-encryption schema: all legacy values are strings except these
 * analytics/quota flags. Never guess a primitive by trying MMKV getters: a
 * false boolean can otherwise be decoded as an empty string. */
export function legacyBooleanKey(key: string) {
  return key === 'novame_quota_exhausted' || key === 'burrow_meta_first_launch_logged'
    || key === 'burrow_meta_onboarding_completed_logged' || key === 'burrow_tiktok_onboarding_completed_logged'
    || key.startsWith('burrow_meta_first_reflect_logged:') || key.startsWith('burrow_tiktok_registration_logged:');
}
type Store = { getAllKeys(): string[]; getString(key: string): string | undefined;
  getBoolean(key: string): boolean | undefined; readonly size?: number; set(key: string, value: string | boolean): void; clearAll(): void };
export const ENCRYPTED_STORAGE_ID = 'novame-storage-encrypted-v1';
export const STORAGE_MIGRATED = 'burrow_storage_migrated:v1';
/** Copy -> verify -> commit -> retire. A killed/interrupted migration retries
 * from the untouched source. The encrypted target is never opened with a new
 * random key when the original key is unavailable. */
export function openEncryptedStorage<T extends Store>(deps: {
  readKey(): string | null; saveKey(key: string): void; randomKey(): string;
  exists(id: string): boolean; open(id: string, key?: string): T; retireLegacy(): void;
}): T {
  let key = deps.readKey();
  if (key !== null && !/^[A-Za-z0-9_-]{32}$/.test(key)) throw Error('secure_storage_key_invalid');
  if (!key) {
    if (deps.exists(ENCRYPTED_STORAGE_ID)) throw Error('secure_storage_key_unavailable');
    key = deps.randomKey();
    deps.saveKey(key); // Vault commit precedes creating any encrypted bytes.
    if (deps.readKey() !== key) throw Error('secure_storage_key_not_saved');
  }
  const target = deps.open(ENCRYPTED_STORAGE_ID, key);
  let openedLegacy: T | undefined;
  if (target.getString(STORAGE_MIGRATED) !== '1') {
    if (deps.exists('novame-storage')) {
      const legacy = openedLegacy = deps.open('novame-storage');
      for (const name of legacy.getAllKeys()) {
        const boolean = legacyBooleanKey(name);
        const value = boolean ? legacy.getBoolean(name) : legacy.getString(name);
        if (value === undefined) throw Error('legacy_storage_value_unavailable');
        target.set(name, value);
        if ((boolean ? target.getBoolean(name) : target.getString(name)) !== value) throw Error('secure_storage_migration_failed');
      }
    }
    target.set(STORAGE_MIGRATED, '1');
    if (target.getString(STORAGE_MIGRATED) !== '1') throw Error('secure_storage_migration_failed');
  }
  // Only after verified encrypted copies exist. A cleanup failure is retried
  // next launch and cannot make the committed target unusable.
  if (deps.exists('novame-storage')) try {
    if (openedLegacy) {
      // clearAll truncates to one MMKV page but does not zero that page. Write
      // benign padding over it, then truncate again. Do NOT delete an open
      // native handle: MMKV's memory-warning listener can still reference it.
      openedLegacy.clearAll();
      if (openedLegacy.getAllKeys().length) throw Error('legacy_storage_cleanup_failed');
      const capacity = openedLegacy.size ?? 65536;
      if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 1048576) throw Error('legacy_storage_cleanup_failed');
      const padding = '0'.repeat(capacity + 1024); // Also covers iOS/Android 16KiB pages.
      openedLegacy.set('burrow_storage_retired:v1', padding);
      if (openedLegacy.getString('burrow_storage_retired:v1') !== padding) throw Error('legacy_storage_cleanup_failed');
      openedLegacy.clearAll();
      if (openedLegacy.getAllKeys().length) throw Error('legacy_storage_cleanup_failed');
    } else deps.retireLegacy();
  } catch {}
  return target;
}
