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
 * The native instance is created exactly once in shared/storage/mmkv.ts.
 * Re-exporting it here preserves every existing cache call site while keeping
 * the storage registry and feature modules on the same listener/native object.
 */
export { mmkv as storage } from '../shared/storage/mmkv';
