/**
 * IAP layer -- Stage 5.IAP.2.
 *
 * Wraps expo-iap@4.2.4 (OpenIAP / StoreKit 2) for the iOS subscription
 * paywall. Single global purchase listener registered at app launch
 * (see app/_layout.tsx); paywall just calls purchaseSubscription() to
 * trigger the StoreKit dialog and listens for the resulting cache
 * update via onPurchaseComplete().
 *
 * Why this shape:
 *   - useIAP hook does not exist in v4.2.4 (verified against
 *     node_modules/expo-iap/build/*.d.ts). Module functions only.
 *   - The purchase result does NOT come back from requestPurchase()'s
 *     promise on iOS -- it arrives via purchaseUpdatedListener (a
 *     global event emitter). This is StoreKit 2's design: the same
 *     listener fires for new purchases, restored purchases, and
 *     auto-renewals replayed on app launch.
 *   - We register the listener exactly ONCE in RootLayout. Paywall
 *     mount/unmount does not touch IAP listeners (avoids double
 *     processing, missed events).
 *
 * Verification flow:
 *   listener fires
 *     -> POST /api/apple-iap with {userId, transactionId, productId,
 *        originalTransactionId, expiresDate}
 *     -> server validates + writes profiles.subscription_tier and
 *        subscriptions table
 *     -> mobile invalidates subscription cache
 *     -> finishTransaction({ purchase, isConsumable: false })
 *     -> emit purchase-complete event so paywall can close itself
 *
 * Server already exists (apps/api/src/app/api/apple-iap/route.js, 130
 * lines) -- we only call it.
 */
import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  restorePurchases,
  getAvailablePurchases,
  presentCodeRedemptionSheetIOS,
  purchaseUpdatedListener,
  purchaseErrorListener,
  ErrorCode,
  type Purchase,
  type ExpoPurchaseError as PurchaseError,
  type ProductSubscription,
} from 'expo-iap';

import { apiClient } from './api';
import { clearQuotaExhausted } from './quota-flag';
import { refreshMeStats } from './me-stats';
import { supabase } from './supabase';
import {
  clearCachedSubscription,
  fetchSubscriptionTier,
} from './subscription';
import type { PricingTierKey } from '@novame/core';

// ---- Purchase outcome (for paywall to react to upgrade vs downgrade) ----

/**
 * Result of a user-initiated subscribe call.
 *
 * Apple StoreKit 2 has different behavior for upgrade vs downgrade vs
 * crossgrade (same level, different duration):
 *   - new / upgrade  -> requestPurchase resolves to a Purchase, the
 *                       purchaseUpdatedListener fires with the new
 *                       transaction, money is charged immediately.
 *   - downgrade      -> requestPurchase resolves to null. NO new
 *                       transaction, NO listener fire. The change
 *                       lands in renewalInfo.autoRenewPreference and
 *                       takes effect at the end of the current
 *                       billing period.
 *   - crossgrade     -> same as downgrade for behavior purposes
 *                       (Apple treats same-level/different-duration
 *                       as deferred per StoreKit 2 docs).
 *
 * We surface these distinctions so the paywall can show the correct
 * post-purchase UX (e.g. "Welcome to Pro" vs "Your plan changes on
 * YYYY-MM-DD").
 */
export type PurchaseOutcome =
  | { kind: 'completed'; productId: string }
  | { kind: 'scheduled'; productId: string }
  | { kind: 'cancelled' };

// ---- Product IDs (must match Apple App Store Connect setup) ----

export const IOS_SUBSCRIPTION_PRODUCT_IDS = [
  'novame.plus.monthly',
  'novame.plus.yearly',
  'novame.plusduo.monthly',
  'novame.plusduo.yearly',
] as const;

export type IOSSubscriptionProductId =
  (typeof IOS_SUBSCRIPTION_PRODUCT_IDS)[number];

const PRODUCT_TO_TIER: Record<IOSSubscriptionProductId, PricingTierKey> = {
  'novame.plus.monthly': 'plus',
  'novame.plus.yearly': 'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly': 'plus',
};

/** Seat model per product: plusduo grants an extra seat to invite one member. */
export const PRODUCT_TO_PLAN_TYPE: Record<IOSSubscriptionProductId, 'solo' | 'duo'> = {
  'novame.plus.monthly': 'solo',
  'novame.plus.yearly': 'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly': 'duo',
};

const PRODUCT_TO_CYCLE: Record<IOSSubscriptionProductId, 'monthly' | 'yearly'> = {
  'novame.plus.monthly': 'monthly',
  'novame.plus.yearly': 'yearly',
  'novame.plusduo.monthly': 'monthly',
  'novame.plusduo.yearly': 'yearly',
};

function isKnownProductId(
  id: string,
): id is IOSSubscriptionProductId {
  return (IOS_SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(id);
}

// ---- Module-level state (single listener, single connection) ----

let initialized = false;
let purchaseUpdateSub: { remove: () => void } | null = null;
let purchaseErrorSub: { remove: () => void } | null = null;

// Stage 5.IAP fix: tracks transactionIds we have already processed in
// this app launch. Sandbox + Apple replay any unfinished transactions
// every time initConnection runs, AND every auto-renewal (every 5
// minutes in sandbox) fires the listener again. Without dedup we'd
// re-upload the same transaction many times. Server is upsert-safe
// but the UI complete-callback is not.
const processedTransactionIds = new Set<string>();

// Stage 5.IAP fix: distinguishes user-initiated purchases from queue
// replays / auto-renewals. Set to true only inside purchaseSubscription
// for the duration of the StoreKit dialog. The listener uses this flag
// to decide whether to fire onPurchaseComplete callbacks (which close
// the paywall + show the success alert). Replays / renewals must NOT
// trigger that UI -- they should just sync silently to the server.
let userInitiatedInFlight = false;
let userInitiatedTimer: ReturnType<typeof setTimeout> | null = null;

// Event emitter for UI to subscribe to purchase outcomes.
type PurchaseCompleteCallback = (info: {
  tier: PricingTierKey;
  cycle: 'monthly' | 'yearly';
}) => void;
type PurchaseErrorCallback = (error: PurchaseError) => void;

const completeCallbacks = new Set<PurchaseCompleteCallback>();
const errorCallbacks = new Set<PurchaseErrorCallback>();

export function onPurchaseComplete(
  cb: PurchaseCompleteCallback,
): () => void {
  completeCallbacks.add(cb);
  return () => {
    completeCallbacks.delete(cb);
  };
}

export function onPurchaseError(
  cb: PurchaseErrorCallback,
): () => void {
  errorCallbacks.add(cb);
  return () => {
    errorCallbacks.delete(cb);
  };
}

// ---- Lifecycle ----

/**
 * Initialize StoreKit 2 connection + register global listeners.
 * Idempotent: safe to call multiple times. Called once from
 * app/_layout.tsx RootLayout on mount.
 */
export async function initIAP(): Promise<void> {
  if (initialized) return;

  try {
    await initConnection();
    initialized = true;
  } catch (e) {
    console.warn('[iap] initConnection failed:', e);
    return;
  }

  // Stage 5.IAP fix (Bug #7 + #8): recover any unfinished StoreKit
  // transactions BEFORE registering the listener. This drains the
  // replay queue in silent mode (server upload + finishTransaction,
  // but no onPurchaseComplete fired -- so the paywall doesn't see a
  // ghost success). Without this step, every cold app launch was
  // showing "Subscription Active to Ultra" because an old sandbox
  // ultra transaction was stuck in the queue.
  //
  // Reference: hyochan/expo-iap discussion #177 -- "On app startup,
  // call getAvailablePurchases() to load any pending/restore-able
  // transactions. Validate each on your server (source of truth for
  // subscription status). Call finishTransaction() for each to clear
  // the queue."
  try {
    const pending = await getAvailablePurchases();
    if (pending && pending.length > 0) {
      console.log(
        `[iap] recovering ${pending.length} unfinished transaction(s) from StoreKit queue`,
      );
      for (const purchase of pending) {
        const txnId = String(purchase.id);
        if (processedTransactionIds.has(txnId)) continue;
        processedTransactionIds.add(txnId);
        try {
          await uploadPurchaseToServer(purchase);
          await finishTransaction({ purchase, isConsumable: false });
          console.log('[iap] recovered transaction', txnId, purchase.productId);
        } catch (e) {
          console.warn('[iap] recovery failed for', txnId, e);
          // Stage 6 fix: distinguish INFRASTRUCTURE failures (no
          // session / network down / supabase unavailable) from
          // BUSINESS failures (server rejected the transaction).
          //
          // Infrastructure failures during initIAP recovery are
          // common: the listener registers very early in app boot,
          // before supabase.auth has restored the session from MMKV.
          // The first uploadPurchaseToServer call throws "No active
          // session for IAP upload" -- a transient race, NOT a
          // problem with the transaction itself.
          //
          // Old behavior: kept the txnId in processedTransactionIds
          // anyway "to avoid spam." Consequence: when the user
          // later tapped Subscribe, StoreKit returned the same
          // unfinished transaction (because finishTransaction never
          // ran), the listener fired, saw the id in the set, and
          // returned silently. paywall.onPurchaseComplete never
          // fired -> paywall stuck on "Processing..." until the 5s
          // safety net, but never closed.
          //
          // New behavior: for transient errors we recognise as
          // infrastructure (session missing, network), DROP the id
          // from the set. The listener will get a fresh shot later
          // (e.g. when the user actually taps Subscribe and
          // StoreKit re-delivers the unfinished transaction).
          const msg =
            e instanceof Error ? e.message : typeof e === 'string' ? e : '';
          const isTransient =
            msg.includes('No active session') ||
            msg.includes('Network request failed') ||
            msg.includes('fetch failed') ||
            msg.includes('NetworkError');
          if (isTransient) {
            processedTransactionIds.delete(txnId);
            console.log(
              '[iap] recovery error is transient, releasing txnId for retry:',
              txnId,
            );
          }
          // For non-transient (business) errors: keep in set, don't
          // spam server with the same broken txn every launch.
        }
      }
      // After recovery, refresh the cached tier so the user sees
      // their accurate state on Me page.
      await refreshSubscriptionCache();
    }
  } catch (e) {
    console.warn('[iap] queue recovery failed:', e);
  }

  // Global listener -- fires for NEW user-initiated purchases AND
  // future auto-renewals. Stale-replay protection happens via
  // processedTransactionIds set above.
  purchaseUpdateSub = purchaseUpdatedListener((purchase) => {
    void handlePurchaseUpdate(purchase);
  });

  purchaseErrorSub = purchaseErrorListener((error) => {
    handlePurchaseError(error);
  });
}

/**
 * Tear down on app shutdown. RootLayout unmounts only when the entire
 * app exits, so this is mostly defensive.
 */
export async function cleanupIAP(): Promise<void> {
  purchaseUpdateSub?.remove();
  purchaseErrorSub?.remove();
  purchaseUpdateSub = null;
  purchaseErrorSub = null;
  if (initialized) {
    try {
      await endConnection();
    } catch {
      /* ignore -- shutdown best-effort */
    }
    initialized = false;
  }
}

// ---- Product fetching (for paywall to show real localized prices) ----

/**
 * Fetches the 6 subscription products from the App Store. Used by the
 * paywall to display real localized prices (currency-aware) instead
 * of the hard-coded USD prices in PRICING_TIERS.
 *
 * Optional in Stage 5.IAP.3 -- the paywall can keep using
 * PRICING_TIERS for now and switch to live prices in a follow-up.
 */
// Play Billing needs an offerToken per sku at purchase time; harvested from
// the last fetchProducts result (first offer of each product).
const androidOfferTokens = new Map<string, string>();

export async function fetchSubscriptionProducts(): Promise<ProductSubscription[]> {
  if (!initialized) {
    try {
      await initConnection();
      initialized = true;
    } catch {
      return [];
    }
  }
  try {
    const products = await fetchProducts({
      skus: [...IOS_SUBSCRIPTION_PRODUCT_IDS],
      type: 'subs',
    });
    const list = Array.isArray(products) ? (products as ProductSubscription[]) : [];
    if (Platform.OS === 'android') {
      for (const prod of list) {
        const offers = (prod as { subscriptionOffers?: { offerTokenAndroid?: string | null }[] })
          .subscriptionOffers;
        const token = offers?.[0]?.offerTokenAndroid;
        if (token) androidOfferTokens.set(prod.id, token);
      }
    }
    return list;
  } catch (e) {
    console.warn('[iap] fetchProducts failed:', e);
    return [];
  }
}

// ---- Purchase trigger (paywall calls this) ----

/**
 * Trigger StoreKit purchase dialog for the given product. Does NOT
 * return the purchase; the result arrives via the global listener
 * (which then notifies UI via onPurchaseComplete callbacks).
 *
 * Throws on configuration errors (e.g. native module not initialized).
 * User cancellation is NOT thrown -- it surfaces via onPurchaseError
 * listeners with code 'user-cancelled'.
 */
export async function purchaseSubscription(
  productId: IOSSubscriptionProductId,
): Promise<PurchaseOutcome> {
  if (!initialized) {
    throw new Error('IAP not initialized -- call initIAP() first');
  }

  // Mark that the next listener fire originated from a user tap. The
  // listener uses this to decide whether to fire onPurchaseComplete
  // (which closes the paywall + shows success). Replays / renewals
  // run silently. Auto-clear after 60s in case the dialog is dismissed.
  userInitiatedInFlight = true;
  if (userInitiatedTimer) clearTimeout(userInitiatedTimer);
  userInitiatedTimer = setTimeout(() => {
    userInitiatedInFlight = false;
    userInitiatedTimer = null;
  }, 60000);

  try {
    // requestPurchase returns:
    //   - Purchase           -> new / upgrade (immediate, listener fires)
    //   - null               -> downgrade or crossgrade (scheduled,
    //                           NO new transaction, listener does NOT
    //                           fire). The change lives in renewalInfo.
    //                           autoRenewPreference and takes effect at
    //                           the end of the current period.
    // Cancellation throws ErrorCode.UserCancelled.
    // Android requires the Play offer token alongside the sku; make sure
    // products (and their tokens) are loaded before the purchase call.
    if (Platform.OS === 'android' && !androidOfferTokens.has(productId)) {
      await fetchSubscriptionProducts();
    }
    const androidOffer = androidOfferTokens.get(productId);
    const result = await requestPurchase({
      request: {
        ios: { sku: productId },
        android: {
          skus: [productId],
          ...(androidOffer
            ? { subscriptionOffers: [{ sku: productId, offerToken: androidOffer }] }
            : {}),
        },
      },
      type: 'subs',
    });

    if (result === null || result === undefined) {
      // Scheduled change -- clear the in-flight flag because the
      // listener won't fire. The paywall will show "scheduled" UI.
      userInitiatedInFlight = false;
      if (userInitiatedTimer) {
        clearTimeout(userInitiatedTimer);
        userInitiatedTimer = null;
      }
      // Refresh the cached subscription so renewalInfo settles -- the
      // server doesn't know yet, but local cache reflects current state.
      void refreshSubscriptionCache();
      return { kind: 'scheduled', productId };
    }

    // Immediate purchase -- the listener will pick up the transaction
    // (uploadPurchaseToServer + finishTransaction + fire complete
    // callbacks). The paywall should wait for onPurchaseComplete
    // before closing, so it sees the server-confirmed tier.
    return { kind: 'completed', productId };
  } catch (e) {
    userInitiatedInFlight = false;
    if (userInitiatedTimer) {
      clearTimeout(userInitiatedTimer);
      userInitiatedTimer = null;
    }
    // Detect user cancellation -- expo-iap throws an error with
    // code='user-cancelled'. We don't want to surface this as a
    // failure to the UI.
    const errCode =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code?: string }).code
        : undefined;
    if (errCode === ErrorCode.UserCancelled) {
      return { kind: 'cancelled' };
    }
    throw e;
  }
}

// ---- Restore purchases ----

/**
 * Restore previously purchased subscriptions. The flow:
 *   1. Call restorePurchases() -- triggers StoreKit sync (no return).
 *   2. Call getAvailablePurchases() -- returns the list.
 *   3. Process each via the same upload-to-server pipeline as new
 *      purchases. The server is idempotent (upserts on
 *      apple_original_transaction_id), so re-running is safe.
 *   4. Return whether any active sub was found.
 *
 * Does NOT throw on no-purchases-found -- returns { restored: false }.
 */
export async function restoreSubscriptions(): Promise<{
  restored: boolean;
  tier?: PricingTierKey;
}> {
  if (!initialized) {
    try {
      await initConnection();
      initialized = true;
    } catch {
      return { restored: false };
    }
  }

  try {
    await restorePurchases(); // sync, no return value
    const purchases = await getAvailablePurchases();
    if (!purchases || purchases.length === 0) {
      return { restored: false };
    }

    let highestTier: PricingTierKey | undefined;
    for (const purchase of purchases) {
      const productId = purchase.productId;
      if (!isKnownProductId(productId)) continue;
      try {
        await uploadPurchaseToServer(purchase);
      } catch (e) {
        console.warn('[iap] restore upload failed for', productId, e);
        continue;
      }
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        /* non-fatal */
      }
      const tier = PRODUCT_TO_TIER[productId];
      highestTier = pickHigherTier(highestTier, tier);
    }

    if (highestTier) {
      await refreshSubscriptionCache();
      return { restored: true, tier: highestTier };
    }
    return { restored: false };
  } catch (e) {
    console.warn('[iap] restoreSubscriptions failed:', e);
    return { restored: false };
  }
}

// ---- Internal: purchase event handling ----

async function handlePurchaseUpdate(purchase: Purchase): Promise<void> {
  const productId = purchase.productId;
  if (!isKnownProductId(productId)) {
    console.warn('[iap] unknown productId:', productId);
    return;
  }

  // Stage 5.IAP fix (Bug #7 + #8): dedup by transactionId. Sandbox
  // replays the same transaction every initConnection AND every
  // auto-renewal (~5min in sandbox). Without this, the listener
  // would re-upload + re-fire UI callbacks on every replay.
  const txnId = String(purchase.id);
  if (processedTransactionIds.has(txnId)) {
    console.log('[iap] skipping already-processed transaction', txnId);
    return;
  }
  processedTransactionIds.add(txnId);

  // Stage 5.IAP fix: capture the user-initiated flag at the start of
  // handling. Even if userInitiatedInFlight clears mid-flight (60s
  // timeout) we want to honor the original intent.
  const wasUserInitiated = userInitiatedInFlight;
  if (wasUserInitiated) {
    userInitiatedInFlight = false;
    if (userInitiatedTimer) {
      clearTimeout(userInitiatedTimer);
      userInitiatedTimer = null;
    }
  }

  try {
    await uploadPurchaseToServer(purchase);
  } catch (e) {
    console.error('[iap] server upload failed:', e);
    // Don't finish the transaction -- StoreKit replays it on next
    // launch and we can retry the upload then. Also remove from the
    // dedup set so a future retry can attempt again.
    processedTransactionIds.delete(txnId);
    return;
  }

  // Server accepted -- finish the transaction so StoreKit drops it.
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch (e) {
    console.warn('[iap] finishTransaction failed (non-fatal):', e);
  }

  // Refresh local cache so any later UI read sees the new tier.
  await refreshSubscriptionCache();

  // Only fire the success UI callback if this was a user tap on
  // Subscribe. Replays and silent auto-renewals must NOT close the
  // paywall or show "Subscription Active" because the user did not
  // just initiate anything.
  if (!wasUserInitiated) {
    console.log(
      '[iap] silent processed (queue replay / auto-renewal):',
      txnId,
      productId,
    );
    return;
  }

  const tier = PRODUCT_TO_TIER[productId];
  const cycle = PRODUCT_TO_CYCLE[productId];

  // Stage 6 follow-up (Me-page subscription regression): proactively
  // refresh me-stats cache rather than just invalidating it.
  //
  // The old `invalidateMeStats()` only removed the MMKV entry and
  // relied on the UI to re-fetch. This worked when Me modal was
  // already mounted (its onPurchaseComplete listener ran fetchMeStats
  // itself). But in the "publish-wisdom -> paywall" path the Me modal
  // is NOT mounted at purchase time -- record.tsx pushed the paywall
  // directly. So:
  //   1) invalidateMeStats cleared the MMKV cache.
  //   2) Me listener was unsubscribed (Me unmounted before paywall).
  //   3) Paywall close -> user taps Me -> Me mounts ->
  //      getCachedMeStats() returns null -> UI shows "--" placeholders
  //      and "Wisdom Seeker" / "Free Plan" defaults for ~10s until
  //      some other path (home-tab focus, etc.) reseeds the cache.
  //
  // Fix: this lib-level path always re-fetches the cache regardless
  // of which UI surface is currently mounted. Fire-and-forget so it
  // doesn't delay paywall close (consistent with record.tsx
  // publish-side Promise.allSettled refresh batch behaviour).
  try {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (userId) {
      void refreshMeStats(userId);
    }
  } catch (e) {
    // best-effort -- console.warn rather than swallow silently so a
    // sustained outage shows up in Metro logs.
    console.warn('[iap] me-stats refresh failed:', e);
  }

  for (const cb of completeCallbacks) {
    try {
      cb({ tier, cycle });
    } catch (e) {
      console.warn('[iap] completeCallback threw:', e);
    }
  }
}

function handlePurchaseError(error: PurchaseError): void {
  // user-cancelled is silent (per expo-iap official guidance:
  // "Don't show error message, just continue").
  if (error.code === ErrorCode.UserCancelled) return;

  for (const cb of errorCallbacks) {
    try {
      cb(error);
    } catch (e) {
      console.warn('[iap] errorCallback threw:', e);
    }
  }
}

// ---- Internal: server upload + cache refresh ----

type AppleIapResponse = {
  success: boolean;
  tier?: PricingTierKey;
  billingCycle?: string;
  periodEnd?: string;
  error?: string;
};

async function uploadPurchaseToServer(purchase: Purchase): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) {
    throw new Error('No active session for IAP upload');
  }

  // iOS StoreKit fields (verified against PurchaseIOS interface in
  // node_modules/expo-iap/build/types.d.ts):
  //   - purchase.id                              StoreKit transaction.id
  //   - purchase.originalTransactionIdentifierIOS StoreKit originalID
  //   - purchase.productId                       e.g. "novame.pro.monthly"
  //   - purchase.expirationDateIOS               unix ms (number) or null
  //
  // Server contract (apps/api/.../apple-iap/route.js): expects
  //   { userId, transactionId, productId, originalTransactionId,
  //     expiresDate (ISO string or null) }
  const expirationMs =
    'expirationDateIOS' in purchase &&
    typeof purchase.expirationDateIOS === 'number'
      ? purchase.expirationDateIOS
      : null;
  const expiresIso = expirationMs
    ? new Date(expirationMs).toISOString()
    : null;

  const originalTxnId =
    'originalTransactionIdentifierIOS' in purchase &&
    typeof purchase.originalTransactionIdentifierIOS === 'string' &&
    purchase.originalTransactionIdentifierIOS
      ? purchase.originalTransactionIdentifierIOS
      : String(purchase.id);

  // A2: send the StoreKit 2 signed transaction (JWS) so the server can
  // verify it with Apple instead of trusting the plain fields. In expo-iap
  // 4.2.4 the unified `purchaseToken` carries the iOS JWS (types.d.ts:
  // "Unified purchase token (iOS JWS, Android purchaseToken)"). Sent now
  // (1.0.7); the server starts REQUIRING + verifying it only after 1.0.7
  // is forced live, so older clients are never broken mid-rollout.
  const jws =
    'purchaseToken' in purchase &&
    typeof purchase.purchaseToken === 'string' &&
    purchase.purchaseToken
      ? purchase.purchaseToken
      : null;

  const endpoint = Platform.OS === 'android' ? '/api/google-iap' : '/api/apple-iap';
  const data = await apiClient.post<AppleIapResponse>(endpoint, {
    userId,
    transactionId: String(purchase.id),
    productId: purchase.productId,
    originalTransactionId: originalTxnId,
    expiresDate: expiresIso,
    jws,
  });

  if (!data.success) {
    throw new Error(data.error ?? 'iap upload returned !success');
  }
}

async function refreshSubscriptionCache(): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return;
  clearCachedSubscription();
  try {
    await fetchSubscriptionTier(userId);
    // A purchase just upgraded the tier, so any locally-remembered
    // "quota exhausted" verdict from the old tier is now stale. Clear it
    // so the next Transform proceeds instead of popping the paywall again.
    clearQuotaExhausted();
  } catch (e) {
    console.warn('[iap] cache refresh failed:', e);
  }
}

// ---- Helpers ----

const TIER_RANK: Record<PricingTierKey, number> = {
  free: 0,
  plus: 1,
};

/**
 * Classify a subscription change. Mirrors the App Store Connect
 * subscription-group ranking: plus (level 1) > free. Same tier + same cycle =
 * same; solo<->duo or monthly<->yearly within plus is a crossgrade.
 * Same tier + different cycle = crossgrade (deferred per Apple).
 *
 * Used by the paywall CTA to choose the right label and post-action
 * messaging.
 */
export type SubscriptionChange =
  | 'new'         // user is on free, buying their first paid plan
  | 'same'        // exact same plan + cycle (button should be disabled)
  | 'upgrade'     // higher tier (immediate)
  | 'downgrade'   // lower tier (scheduled)
  | 'crossgrade'; // same tier, different cycle (scheduled per Apple StoreKit 2)

/**
 * Present Apple's offer-code redemption sheet (iOS only; real device
 * only -- not the simulator, and offer codes are not redeemable in
 * Sandbox/TestFlight per Apple, so this is testable only in a live
 * build with a real code).
 *
 * We mark the flow as user-initiated (same flag + 60s auto-clear as
 * purchaseSubscription) so the redeemed transaction fires
 * completeCallbacks -- refreshing the subscription cache + me-stats --
 * instead of going through the silent auto-renewal branch. Like a normal
 * purchase we do NOT show our own success alert: Apple's redemption sheet
 * already confirms success, and the Me page reflects the new tier on its
 * next focus (same industry-standard rationale as the paywall).
 *
 * Best-effort: never throws. On failure we clear the user-initiated flag
 * so a later unrelated transaction isn't mislabelled.
 */
export async function presentOfferCodeRedemption(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  userInitiatedInFlight = true;
  if (userInitiatedTimer) clearTimeout(userInitiatedTimer);
  userInitiatedTimer = setTimeout(() => {
    userInitiatedInFlight = false;
    userInitiatedTimer = null;
  }, 60000);

  try {
    await presentCodeRedemptionSheetIOS();
  } catch (e) {
    console.warn('[iap] offer code redemption sheet failed:', e);
    userInitiatedInFlight = false;
    if (userInitiatedTimer) {
      clearTimeout(userInitiatedTimer);
      userInitiatedTimer = null;
    }
  }
}

export function classifySubscriptionChange(
  current: { tier: PricingTierKey; cycle?: 'monthly' | 'yearly' | null },
  target: { tier: PricingTierKey; cycle: 'monthly' | 'yearly' },
): SubscriptionChange {
  if (current.tier === 'free') return 'new';
  if (current.tier === target.tier) {
    if (current.cycle === target.cycle) return 'same';
    return 'crossgrade';
  }
  if (TIER_RANK[target.tier] > TIER_RANK[current.tier]) return 'upgrade';
  return 'downgrade';
}

/**
 * Seat model for the v2 Plus plan. Both plus (solo) and plusduo (duo) grant the
 * same tier; the seat count is the only difference, so change classification
 * runs on the seat rank, not the tier.
 */
export type PlanSeat = 'plus' | 'plusduo';

const SEAT_RANK: Record<PlanSeat, number> = {
  plus: 1,
  plusduo: 2,
};

/**
 * Classify a plan change within Plus (Apple StoreKit 2 semantics, option A):
 *   - from free               -> 'new'      (immediate)
 *   - more seats (solo->duo)  -> 'upgrade'  (immediate; Apple prorates)
 *   - fewer seats (duo->solo) -> 'downgrade'(scheduled, end of period)
 *   - same seat, diff cycle   -> 'crossgrade'(scheduled; monthly<->yearly)
 *   - identical               -> 'same'
 *
 * Cycle changes are always crossgrade (never upgrade), so a monthly<->yearly
 * switch defers to period end -- no proration edge cases. Only a seat increase
 * is immediate.
 */
export function classifyPlanChange(
  current: { seat: PlanSeat; cycle: 'monthly' | 'yearly' } | null,
  target: { seat: PlanSeat; cycle: 'monthly' | 'yearly' },
): SubscriptionChange {
  if (!current) return 'new';
  if (current.seat === target.seat) {
    return current.cycle === target.cycle ? 'same' : 'crossgrade';
  }
  return SEAT_RANK[target.seat] > SEAT_RANK[current.seat] ? 'upgrade' : 'downgrade';
}

function pickHigherTier(
  a: PricingTierKey | undefined,
  b: PricingTierKey,
): PricingTierKey {
  if (!a) return b;
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}
