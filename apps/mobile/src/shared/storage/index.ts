/**
 * The only import path for on-device key-value storage.
 *
 *     import { clearUserScopedKeys } from '@/shared/storage';
 *
 * Do not import `react-native-mmkv` anywhere but `./mmkv.ts`. Do not declare a
 * key outside `./keys.ts`. Both are enforced by ESLint and, in development, by
 * `assertAllKeysRegistered()`.
 */

export {
  assertAllKeysRegistered,
  clearOnSignIn,
  clearOnSignOut,
  clearScope,
  debugAccountKeysRemaining,
  defineKey,
  definePrefixKey,
  type KeyOptions,
  type KeyScope,
  type PrefixKey,
  type StorageKey,
} from './registry';

/**
 * Load-bearing. `keys.ts` registers all 31 keys as an import-time side effect,
 * so `clearScope()` sees an empty registry unless this module is evaluated.
 * `export *` guarantees evaluation; the explicit side-effect import above it
 * states the intent for anyone tempted to prune an "unused" re-export.
 */
import './keys';
export * from './keys';
