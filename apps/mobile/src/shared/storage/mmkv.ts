import { createMMKV, deleteMMKV, existsMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { Platform } from 'react-native';
import { openEncryptedStorage } from './encrypted-migration';

/**
 * The one shared MMKV instance (plus a temporary, read/copy-only legacy store
 * during upgrade migration).
 *
 * THIS IS THE ONLY FILE IN THE REPO ALLOWED TO IMPORT `react-native-mmkv`.
 * Enforced by an ESLint `no-restricted-imports` rule, not by convention.
 *
 * Why: MMKV is per-device, not per-user. A key written directly bypasses the
 * scope registry, which means it is never cleared on sign-out, which means
 * user B eventually reads user A's data. That is exactly how P0-1 happened:
 * 13 user-scoped keys survived a user switch, including a pointer to an
 * unpublished .m4a voice recording.
 *
 * Creating a second `createMMKV({ id: 'novame-storage' })` elsewhere would
 * also fork the value-changed listener registration, so `src/lib/storage.ts`
 * re-exports this instance rather than making its own.
 *
 * API surface verified against react-native-mmkv@4.3.1
 * (lib/specs/MMKV.nitro.d.ts):
 *   set(key, boolean | string | number | ArrayBuffer): void
 *   getString(key): string | undefined
 *   getBoolean(key): boolean | undefined
 *   getNumber(key): number | undefined
 *   remove(key): boolean
 *   getAllKeys(): string[]
 *   clearAll(): void
 *   addOnValueChangedListener((key) => void): Listener
 */
const vaultOptions = { keychainService: 'com.novame.local-storage',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
// Survives JS Fast Refresh, but not a native process restart. Never destroy a
// legacy MMKV handle while the library may still hold its memory-warning hook.
const processState = globalThis as typeof globalThis & { __burrowLegacyMmkvOpened?: boolean };
// A random, OS-vault-protected key; no biometric prompts or network wait. iOS
// encrypted device backup can migrate the key along with the encrypted store.
// Android excludes both from backup because Keystore keys cannot be restored.
// Keeping
// large sessions/journals in encrypted MMKV avoids Keychain's small-value limit.
function initializeStorage() {
  try { return Platform.OS === 'web' ? createMMKV({ id: 'novame-storage' }) : openEncryptedStorage({
  readKey: () => SecureStore.getItem('mmkv-aes-key-v1', vaultOptions),
  saveKey: key => SecureStore.setItem('mmkv-aes-key-v1', key, vaultOptions),
  randomKey: () => Array.from(getRandomBytes(32), byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[byte & 63]).join(''),
  exists: existsMMKV,
  // removeStorage retires the old files, not only their logical key index.
  retireLegacy: () => { if (!processState.__burrowLegacyMmkvOpened && !deleteMMKV('novame-storage')) throw Error('legacy_storage_cleanup_failed'); },
  open: (id, encryptionKey) => {
    if (id === 'novame-storage') processState.__burrowLegacyMmkvOpened = true;
    return createMMKV({ id, ...(encryptionKey ? { encryptionKey, encryptionType: 'AES-256' as const } : {}) });
  },
  }); } catch {
    // Fail closed, but let the entry point show a recoverable screen. Never
    // create a new key, discard a journal or silently fall back to plaintext.
    throw Error('secure_storage_startup_failed');
  }
}
export const mmkv = initializeStorage();
