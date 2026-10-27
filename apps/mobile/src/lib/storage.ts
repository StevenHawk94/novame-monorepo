/**
 * MMKV storage singleton.
 *
 * Used by zustand persist middleware (stage 3) for fast,
 * synchronous, on-device key-value storage.
 *
 * Supabase sessions use the asynchronous auth-storage adapter over this same
 * encrypted native store; legacy AsyncStorage sessions migrate on access.
 */
export { mmkv as storage } from '../shared/storage/mmkv';
