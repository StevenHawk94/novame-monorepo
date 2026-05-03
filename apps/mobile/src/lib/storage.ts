import { createMMKV } from 'react-native-mmkv';

/**
 * MMKV storage singleton.
 *
 * Used by zustand persist middleware (stage 3) for fast,
 * synchronous, on-device key-value storage.
 *
 * NOT used for Supabase auth session — that goes through
 * AsyncStorage in supabase.ts (Supabase auth storage requires
 * an async interface, MMKV is sync).
 *
 * react-native-mmkv v4 changed API from `new MMKV(...)` to
 * `createMMKV(...)` factory. Requires react-native-nitro-modules
 * peer dep (installed separately in mobile/).
 */
export const storage = createMMKV({
  id: 'novame-storage',
});
