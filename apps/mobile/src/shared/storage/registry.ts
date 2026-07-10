import { mmkv } from './mmkv';

/**
 * Key scope registry.
 * ===========================================================================
 *
 * The root cause of P0-1 was never "someone forgot to add a key to the
 * sign-out list". It was that a key could *exist* without ever declaring
 * whether it belonged to the account or to the phone.
 *
 * Before this module, `app/_layout.tsx` cleared keys from a hand-maintained
 * allowlist that covered 6 of the 29 keys in use. The 13 user-scoped keys it
 * missed included `novame_record_draft` (a pointer to an unpublished voice
 * recording), `novame_kwdetail:*` (the previous user's own journal entries),
 * and `novame.ai_consent` (a consent record).
 *
 * Here a key cannot exist without a scope: `defineKey` requires one, and
 * `clearScope('user')` walks the registry rather than a list someone has to
 * remember to update.
 *
 * Scope, deliberately, is NOT a codec
 * -----------------------------------
 * This module knows nothing about how values are serialised. Reads and writes
 * still go through the existing `storage.getString(...)` / `storage.set(...)`
 * call sites, untouched. Phase 0 changes *clearing* behaviour and nothing
 * else, which keeps the blast radius at exactly the bug being fixed.
 *
 * Typed accessors and `useSyncExternalStore` subscriptions arrive in Phase 1,
 * when `createResource()` rewrites those call sites anyway.
 * ===========================================================================
 */

export type KeyScope =
  /** Describes the signed-in account. Cleared on SIGNED_IN and on SIGNED_OUT. */
  | 'user'
  /** Describes this phone, not this account. Survives a user switch. */
  | 'device'
  /**
   * Collected before authentication, by the person who is about to sign in.
   *
   * The same bytes have two owners depending on the event. At SIGNED_IN they
   * belong to the arriving user, who typed them thirty seconds ago -- clearing
   * them there destroys their own work. At SIGNED_OUT they belong to the user
   * who is leaving, and must go.
   *
   * Exactly one key qualifies today (novame_onboarding_state). This exists as
   * a named scope rather than an exception list because an exception list
   * grows: the second entry is always easier to add than the first.
   */
  | 'preauth';

export interface KeyOptions {
  /**
   * Side-effect cleanup, run after `clearScope()` removes the key.
   *
   * Use when the value is a *pointer* to something that must also die -- e.g.
   * a file path in documentDirectory. Fired without await; sign-out navigation
   * must not block on disk I/O. Errors are logged and swallowed.
   */
  onClear?: () => void | Promise<void>;
}

interface Registration {
  /** Full key name, or the prefix when `isPrefix`. */
  name: string;
  scope: KeyScope;
  isPrefix: boolean;
  onClear?: () => void | Promise<void>;
}

const registrations = new Map<string, Registration>();

function register(reg: Registration): void {
  const existing = registrations.get(reg.name);
  if (existing) {
    // Two modules claiming one key would otherwise surface as mysterious
    // cache corruption. Fail at import time, not at runtime.
    throw new Error(
      `[storage] key "${reg.name}" is already registered with scope ` +
        `"${existing.scope}". Declare each key exactly once, in keys.ts.`,
    );
  }
  registrations.set(reg.name, reg);
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export interface StorageKey {
  readonly name: string;
  readonly scope: KeyScope;
}

export interface PrefixKey {
  readonly prefix: string;
  readonly scope: KeyScope;
  /** `kKeywordDetail.keyFor('mind-clarity')` -> 'novame_kwdetail:mind-clarity' */
  keyFor(suffix: string): string;
}

export function defineKey(
  name: string,
  scope: KeyScope,
  options: KeyOptions = {},
): StorageKey {
  register({ name, scope, isPrefix: false, onClear: options.onClear });
  return { name, scope };
}

export function definePrefixKey(
  prefix: string,
  scope: KeyScope,
  options: KeyOptions = {},
): PrefixKey {
  register({ name: prefix, scope, isPrefix: true, onClear: options.onClear });
  return { prefix, scope, keyFor: (suffix: string) => prefix + suffix };
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

/**
 * Removes every registered key in `scope`, then fires their `onClear` hooks.
 *
 * Deliberately loops `mmkv.remove(key)` rather than calling `mmkv.clearAll()`.
 * Three reasons:
 *
 *   1. `clearAll()` would also wipe 'device'-scoped keys.
 *   2. MMKV's JSDoc documents `addOnValueChangedListener` as firing on
 *      "set or delete". It says nothing about `clearAll()`. The mock and web
 *      implementations do notify, but the native C++ path is unverified, and
 *      Phase 1 depends on that listener.
 *   3. A future third-party library sharing the 'novame-storage' id would lose
 *      its data.
 */
export function clearScope(scope: KeyScope, reason = 'unspecified'): void {
  const cleanups: Array<() => void | Promise<void>> = [];
  const removed: string[] = [];

  for (const reg of registrations.values()) {
    if (reg.scope !== scope) continue;
    if (reg.onClear) cleanups.push(reg.onClear);

    // `mmkv.remove` returns true when the key existed, per MMKV.nitro.d.ts.
    if (reg.isPrefix) {
      for (const k of mmkv.getAllKeys()) {
        if (k.startsWith(reg.name) && mmkv.remove(k)) removed.push(k);
      }
    } else if (mmkv.remove(reg.name)) {
      removed.push(reg.name);
    }
  }

  if (__DEV__) {
    // Names, not a count. A count tells you something happened; the names tell
    // you what, and `reason` tells you who asked. An unattributed call in the
    // log is a caller nobody knows about.
    console.log(
      `[storage] clearScope('${scope}') via ${reason} -> ` +
        (removed.length ? removed.join(', ') : '(nothing)') +
        ` | ${mmkv.getAllKeys().length} key(s) left: ${mmkv.getAllKeys().join(', ')}`,
    );
  }

  for (const fn of cleanups) {
    try {
      void fn();
    } catch (e) {
      console.warn('[storage] onClear hook threw:', e);
    }
  }
}

/**
 * Clears the *departing* user's data while preserving what the *arriving* user
 * brought with them.
 *
 * SIGNED_IN fires without a preceding SIGNED_OUT more often than you would
 * think: a force-quit leaves the Supabase session in AsyncStorage, an
 * expo-dev-client hot restart reuses it, and Apple Sign In can re-authenticate
 * as a different account outright. So this path must scrub too.
 *
 * It must NOT scrub 'preauth'. `syncOnboardingIfPending` reads MMKV on its
 * first synchronous line, before the caller regains control; clearing the
 * onboarding draft here means `pendingSync` reads false and the sync never
 * runs at all -- the user's answers never reach the server.
 */
export function clearOnSignIn(): void {
  clearScope('user', 'clearOnSignIn');
}

/**
 * Clears everything the departing account owned, including the onboarding
 * draft they filled in before they ever authenticated.
 */
export function clearOnSignOut(): void {
  clearScope('user', 'clearOnSignOut');
  clearScope('preauth', 'clearOnSignOut');
}

// ---------------------------------------------------------------------------
// Dev-time drift guard
// ---------------------------------------------------------------------------

/**
 * Fails loudly in development when MMKV holds a key nobody registered.
 *
 * An unregistered key is, by construction, a key with no scope -- which is the
 * exact shape of P0-1. This turns a silent privacy bug into a console error on
 * the first run after someone adds a raw `storage.set('novame_whatever', ...)`.
 *
 * ESLint stops it at author time. This catches whatever slips through.
 */
export function assertAllKeysRegistered(): void {
  if (!__DEV__) return;

  const known = [...registrations.values()];
  const orphans = mmkv
    .getAllKeys()
    .filter((k) => !known.some((r) => (r.isPrefix ? k.startsWith(r.name) : k === r.name)));

  if (orphans.length > 0) {
    console.error(
      '[storage] Unregistered MMKV keys found:\n  ' +
        orphans.join('\n  ') +
        "\n\nEvery key must be declared in src/shared/storage/keys.ts with an " +
        "explicit scope ('user' or 'device'). Unregistered keys are never " +
        "cleared on sign-out.",
    );
  }
}

/**
 * Dev-only. Lists every registered non-'device' key still present in MMKV.
 *
 * Call it immediately after a sign-out to see the bug rather than read about
 * it. On the pre-registry code path it prints the fourteen account-owned keys
 * the hand-maintained allowlist never touched -- including the pointer to an
 * unpublished .m4a. On the fixed path it prints nothing.
 *
 * Registered-but-absent keys are omitted: a key the user never triggered was
 * never written, and listing it would drown the ones that matter.
 */
export function debugAccountKeysRemaining(label: string): void {
  if (!__DEV__) return;

  const present = mmkv.getAllKeys();
  const found: Array<{ key: string; scope: KeyScope }> = [];

  for (const reg of registrations.values()) {
    if (reg.scope === 'device') continue;
    if (reg.isPrefix) {
      for (const k of present) {
        if (k.startsWith(reg.name)) found.push({ key: k, scope: reg.scope });
      }
    } else if (present.includes(reg.name)) {
      found.push({ key: reg.name, scope: reg.scope });
    }
  }

  if (found.length === 0) {
    console.log(`[storage] ${label}: 0 account key(s) remain. Clean.`);
    return;
  }
  console.log(
    `[storage] ${label}: ${found.length} account key(s) STILL ON DISK\n` +
      found.map((f) => `    [${f.scope}] ${f.key}`).join('\n'),
  );
}

/** Test/debug only. */
export function __getRegistrations(): ReadonlyMap<string, Registration> {
  return registrations;
}
