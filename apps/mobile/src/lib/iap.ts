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
  purchaseUpdatedListener,
  purchaseErrorListener,
  ErrorCode,
  type Purchase,
  type ExpoPurchaseError as PurchaseError,
  type ProductSubscription,
} from 'expo-iap';

import { apiClient } from './api';
import { supabase } from './supabase';
import {
  clearCachedSubscription,
  fetchSubscriptionTier,
} from './subscription';
import type { PricingTierKey } from '@novame/core';

// ---- Product IDs (must match Apple App Store Connect setup) ----

export const IOS_SUBSCRIPTION_PRODUCT_IDS = [
  'novame.basic.monthly',
  'novame.basic.yearly',
  'novame.pro.monthly',
  'novame.pro.yearly',
  'novame.ultra.monthly',
  'novame.ultra.yearly',
] as const;

export type IOSSubscriptionProductId =
  (typeof IOS_SUBSCRIPTION_PRODUCT_IDS)[number];

const PRODUCT_TO_TIER: Record<IOSSubscriptionProductId, PricingTierKey> = {
  'novame.basic.monthly': 'basic',
  'novame.basic.yearly': 'basic',
  'novame.pro.monthly': 'pro',
  'novame.pro.yearly': 'pro',
  'novame.ultra.monthly': 'ultra',
  'novame.ultra.yearly': 'ultra',
};

const PRODUCT_TO_CYCLE: Record<IOSSubscriptionProductId, 'monthly' | 'yearly'> = {
  'novame.basic.monthly': 'monthly',
  'novame.basic.yearly': 'yearly',
  'novame.pro.monthly': 'monthly',
  'novame.pro.yearly': 'yearly',
  'novame.ultra.monthly': 'monthly',
  'novame.ultra.yearly': 'yearly',
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
  if (Platform.OS !== 'ios') return; // Stage 5: iOS only.

  try {
    await initConnection();
    initialized = true;
  } catch (e) {
    console.warn('[iap] initConnection failed:', e);
    return;
  }

  // Global listener -- fires for new purchases AND restored purchases
  // AND auto-renewals replayed on app launch (StoreKit 2 behavior).
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
export async function fetchSubscriptionProducts(): Promise<ProductSubscription[]> {
  if (Platform.OS !== 'ios') return [];
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
    return Array.isArray(products)
      ? (products as ProductSubscription[])
      : [];
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
): Promise<void> {
  if (Platform.OS !== 'ios') {
    throw new Error('IAP only supported on iOS in this build');
  }
  if (!initialized) {
    throw new Error('IAP not initialized -- call initIAP() first');
  }
  await requestPurchase({
    request: { ios: { sku: productId } },
    type: 'subs',
  });
  // Result arrives via purchaseUpdatedListener.
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
  if (Platform.OS !== 'ios') return { restored: false };
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

  try {
    await uploadPurchaseToServer(purchase);
  } catch (e) {
    console.error('[iap] server upload failed:', e);
    // DO NOT finish the transaction -- StoreKit will replay on next
    // launch and we can retry the upload.
    return;
  }

  // Server accepted -- finish the transaction so StoreKit drops it.
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch (e) {
    console.warn('[iap] finishTransaction failed (non-fatal):', e);
  }

  // Refresh local cache + notify UI.
  await refreshSubscriptionCache();
  const tier = PRODUCT_TO_TIER[productId];
  const cycle = PRODUCT_TO_CYCLE[productId];
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

  const data = await apiClient.post<AppleIapResponse>('/api/apple-iap', {
    userId,
    transactionId: String(purchase.id),
    productId: purchase.productId,
    originalTransactionId: originalTxnId,
    expiresDate: expiresIso,
  });

  if (!data.success) {
    throw new Error(data.error ?? 'apple-iap upload returned !success');
  }
}

async function refreshSubscriptionCache(): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return;
  clearCachedSubscription();
  try {
    await fetchSubscriptionTier(userId);
  } catch (e) {
    console.warn('[iap] cache refresh failed:', e);
  }
}

// ---- Helpers ----

const TIER_RANK: Record<PricingTierKey, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  ultra: 3,
};

function pickHigherTier(
  a: PricingTierKey | undefined,
  b: PricingTierKey,
): PricingTierKey {
  if (!a) return b;
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}
