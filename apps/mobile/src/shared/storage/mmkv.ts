import { createMMKV } from 'react-native-mmkv';

/**
 * The one and only MMKV instance.
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
export const mmkv = createMMKV({ id: 'novame-storage' });
