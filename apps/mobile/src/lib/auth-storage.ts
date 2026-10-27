import AsyncStorage from '@react-native-async-storage/async-storage';
import { storage } from './storage';

const prefix = 'burrow_auth:';
// Cleanup is best-effort and retried on every access. Failure must not turn a
// committed encrypted sign-in/sign-out into a reported authentication failure.
const retireLegacy = (key: string) => { void AsyncStorage.removeItem(key).catch(() => {}); };
/** Supabase owns session deletion; account-cache clearing must not delete a
 * freshly signed-in session. Upgrade copies before retiring AsyncStorage. */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const encrypted = storage.getString(prefix + key);
    if (encrypted !== undefined) { retireLegacy(key); return encrypted || null; }
    const legacy = await AsyncStorage.getItem(key);
    // Sign-out or token refresh may have committed while AsyncStorage awaited.
    const committed = storage.getString(prefix + key);
    if (committed !== undefined) { retireLegacy(key); return committed || null; }
    if (legacy !== null) {
      storage.set(prefix + key, legacy);
      if (storage.getString(prefix + key) !== legacy) throw Error('auth_storage_migration_failed');
      retireLegacy(key);
    }
    return legacy;
  },
  async setItem(key: string, value: string) {
    storage.set(prefix + key, value);
    retireLegacy(key);
  },
  async removeItem(key: string) {
    // A durable tombstone prevents an old AsyncStorage session from being
    // resurrected even when its removal fails during sign-out.
    storage.set(prefix + key, '');
    retireLegacy(key);
  },
};
