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
import * as Crypto from 'expo-crypto';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  restorePurchases,
  getAvailablePurchases,
  presentCodeRedemptionSheetIOS,
  isEligibleForIntroOfferIOS,
  purchaseUpdatedListener,
  purchaseErrorListener,
  createPurchaseError,
  ErrorCode,
  type Purchase,
  type ExpoPurchaseError as PurchaseError,
  type ProductSubscription,
} from 'expo-iap';

import { apiClient } from './api';
import { ApiError } from '@novame/api-client';
import { clearQuotaExhausted } from './quota-flag';
import { refreshMeStats } from './me-stats';
import { ensureSession } from './auth';
import { supabase } from './supabase';
import {
  clearCachedSubscription,
  fetchSubscriptionTier,
  setCachedSubscription,
} from './subscription';
import type { PricingTierKey } from '@novame/core';
import { logStartTrial } from './meta-analytics';

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

// ---- Store product IDs ----

export const IOS_SUBSCRIPTION_PRODUCT_IDS = [
  'novame.plus.monthly',
  'novame.plus.yearly',
  'novame.plusduo.monthly',
  'novame.plusduo.yearly',
] as const;

export type IOSSubscriptionProductId =
  (typeof IOS_SUBSCRIPTION_PRODUCT_IDS)[number];

// Google Play Console currently has two separate Burrow Plus subscriptions.
// Keep this list separate because Duo exists on iOS but is not a Play product.
export const ANDROID_SUBSCRIPTION_PRODUCT_IDS = [
  'novame.plus.monthly',
  'novame.plus.yearly',
] as const;
type SubscriptionCycle = 'monthly' | 'yearly';
type PlanType = 'solo' | 'duo';

const PRODUCT_TO_TIER: Record<IOSSubscriptionProductId, PricingTierKey> = {
  'novame.plus.monthly': 'plus',
  'novame.plus.yearly': 'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly': 'plus',
};

/** Seat model per product: plusduo grants an extra seat to invite one member. */
export const PRODUCT_TO_PLAN_TYPE: Record<IOSSubscriptionProductId, PlanType> = {
  'novame.plus.monthly': 'solo',
  'novame.plus.yearly': 'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly': 'duo',
};

const PRODUCT_TO_CYCLE: Record<IOSSubscriptionProductId, SubscriptionCycle> = {
  'novame.plus.monthly': 'monthly',
  'novame.plus.yearly': 'yearly',
  'novame.plusduo.monthly': 'monthly',
  'novame.plusduo.yearly': 'yearly',
};

function isIOSProductId(id: string): id is IOSSubscriptionProductId {
  return (IOS_SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(id);
}

function getPurchaseEntitlement(purchase: Purchase): {
  tier: PricingTierKey;
  cycle: SubscriptionCycle;
} | null {
  if (isIOSProductId(purchase.productId)) {
    return {
      tier: PRODUCT_TO_TIER[purchase.productId],
      cycle: PRODUCT_TO_CYCLE[purchase.productId],
    };
  }
  return null;
}

// ---- Module-level state (single listener, single connection) ----

let initialized = false;
let initIAPInFlight: Promise<void> | null = null;
let purchaseUpdateSub: { remove: () => void } | null = null;
let purchaseErrorSub: { remove: () => void } | null = null;
let reconciliationInFlight: Promise<boolean> | null = null;
let alreadyOwnedRecoveryInFlight: Promise<boolean> | null = null;
let recentAlreadyOwnedRecovery: { at: number; recovered: boolean } | null = null;

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
// UUID that launched the active store sheet. It prevents a transaction from
// being uploaded under a different account if the auth session changes while
// StoreKit / Play Billing is still open.
let purchaseAccountIdInFlight: string | null = null;
let purchaseIncludesFreeTrialInFlight = false;

// Event emitter for UI to subscribe to purchase outcomes.
type PurchaseCompleteCallback = (info: {
  tier: PricingTierKey;
  cycle: 'monthly' | 'yearly';
}) => void;
type PurchaseErrorCallback = (error: PurchaseError) => void;

const completeCallbacks = new Set<PurchaseCompleteCallback>();
const errorCallbacks = new Set<PurchaseErrorCallback>();
let pendingOwnershipError: PurchaseError | null = null;

class PurchasePendingError extends Error {
  constructor(message = 'Your payment is still pending in Google Play. Plus will activate automatically after Google confirms it.') {
    super(message);
    this.name = 'PurchasePendingError';
  }
}

type IapApiErrorBody = {
  code?: unknown;
  error?: unknown;
  pending?: unknown;
};

function apiErrorBody(error: unknown): IapApiErrorBody | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return null;
  return error.body as IapApiErrorBody;
}

function isAndroidPurchasePending(purchase: Purchase): boolean {
  return Platform.OS === 'android' && purchase.purchaseState === 'pending';
}

function purchaseFailureMessage(error: unknown): string {
  if (error instanceof PurchasePendingError) return error.message;
  const body = apiErrorBody(error);
  const code = typeof body?.code === 'string' ? body.code : null;
  switch (code) {
    case 'GOOGLE_PLAY_CONFIGURATION_ERROR':
    case 'GOOGLE_PLAY_TEMPORARY_UNAVAILABLE':
      return 'Google Play confirmed the order, but Burrow could not finish syncing it yet. Your purchase is safe and will be restored automatically; please try Restore Purchases shortly.';
    case 'PURCHASE_NOT_FOUND':
      return 'Google Play has not made this order available to Burrow yet. Please wait a moment, then use Restore Purchases.';
    case 'PURCHASE_PENDING_CANCELED':
      return 'The pending Google Play payment was canceled. You have not been charged by Burrow.';
    case 'SUBSCRIPTION_NOT_ENTITLED':
      return 'Google Play does not currently show this subscription as active.';
    case 'AUTH_ACCOUNT_CHANGED':
      return 'Your account changed while the purchase was open. Return to the Burrow account that started the purchase and restore it.';
    default:
      if (typeof body?.error === 'string' && body.error) return body.error;
      if (error instanceof Error && error.message && !(error instanceof ApiError)) return error.message;
      return 'We could not finish syncing your purchase. Your order will be restored automatically; you can also use Restore Purchases.';
  }
}

async function recoverAlreadyOwnedPurchase(productId?: string | null): Promise<boolean> {
  if (recentAlreadyOwnedRecovery && Date.now() - recentAlreadyOwnedRecovery.at < 5_000) {
    return recentAlreadyOwnedRecovery.recovered;
  }
  if (alreadyOwnedRecoveryInFlight) return alreadyOwnedRecoveryInFlight;
  alreadyOwnedRecoveryInFlight = (async () => {
    userInitiatedInFlight = false;
    purchaseIncludesFreeTrialInFlight = false;
    purchaseAccountIdInFlight = null;
    if (userInitiatedTimer) {
      clearTimeout(userInitiatedTimer);
      userInitiatedTimer = null;
    }

    const restored = await restoreSubscriptions();
    if (restored.restored && restored.tier) {
      const cycle = restored.cycle ?? (productId && isIOSProductId(productId)
        ? PRODUCT_TO_CYCLE[productId]
        : 'yearly');
      for (const cb of completeCallbacks) {
        try {
          cb({ tier: restored.tier, cycle });
        } catch (callbackError) {
          console.warn('[iap] completeCallback threw:', callbackError);
        }
      }
      return true;
    }

    const message = restored.pending
      ? new PurchasePendingError().message
      : restored.error
        ?? 'Google Play already has this subscription. Use Restore Purchases to finish syncing it with Burrow.';
    handlePurchaseError(createPurchaseError({
      code: restored.pending ? ErrorCode.Pending : ErrorCode.PurchaseVerificationFailed,
      message,
      productId: productId ?? undefined,
      platform: 'android',
    }));
    return false;
  })();
  try {
    const recovered = await alreadyOwnedRecoveryInFlight;
    recentAlreadyOwnedRecovery = { at: Date.now(), recovered };
    return recovered;
  } finally {
    alreadyOwnedRecoveryInFlight = null;
  }
}

type StoreEnvironment = 'sandbox' | 'production' | 'unknown';

type PurchaseOwnershipConflict = {
  storeEnvironment: StoreEnvironment;
  message: string;
};

function purchaseOwnershipConflict(error: unknown): PurchaseOwnershipConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body && typeof error.body === 'object'
    ? error.body as { code?: unknown; error?: unknown; storeEnvironment?: unknown }
    : null;
  const isOwnershipConflict = body?.code === 'PURCHASE_ACCOUNT_CONFLICT'
    || body?.error === 'Purchase belongs to another account';
  if (!isOwnershipConflict) return null;

  const storeEnvironment: StoreEnvironment = body?.storeEnvironment === 'sandbox'
    ? 'sandbox'
    : body?.storeEnvironment === 'production'
      ? 'production'
      : 'unknown';
  const message = storeEnvironment === 'sandbox'
    ? 'This Sandbox purchase is linked to another Burrow test account. Clear Purchase History in Settings > Developer > Sandbox Apple Account > Manage, sign out and back in, then try again.'
    : 'This purchase is linked to another Burrow account. Sign in to the Burrow account that originally purchased it, then restore purchases.';
  return { storeEnvironment, message };
}

async function finishOwnershipConflict(
  purchase: Purchase,
  conflict: PurchaseOwnershipConflict,
): Promise<void> {
  try {
    // A verified transaction rejected for account ownership is a permanent
    // business failure for the CURRENT app account, not a transient upload
    // failure. Finishing removes it from StoreKit's update queue so it does
    // not POST 409 on every launch. The underlying entitlement remains
    // restorable after the user signs into the correct Burrow account.
    await finishTransaction({ purchase, isConsumable: false });
    console.warn(
      '[iap] finished account-conflict transaction:',
      String(purchase.id),
      conflict.storeEnvironment,
    );
  } catch (finishError) {
    console.warn('[iap] could not finish account-conflict transaction:', finishError);
  }
}

function notifyOwnershipConflict(
  conflict: PurchaseOwnershipConflict,
  productId: string,
): void {
  const error = createPurchaseError({
    code: ErrorCode.PurchaseVerificationFailed,
    message: conflict.message,
    productId,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (errorCallbacks.size === 0) {
    // Queue one actionable error when cold-start recovery detects the conflict
    // before a paywall/onboarding listener exists. It is delivered once when
    // the user next opens a purchase surface, rather than interrupting Home.
    pendingOwnershipError = error;
    return;
  }
  handlePurchaseError(error);
}

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
  if (pendingOwnershipError) {
    const pending = pendingOwnershipError;
    pendingOwnershipError = null;
    cb(pending);
  }
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
  if (initIAPInFlight) return initIAPInFlight;

  initIAPInFlight = initializeIAP();
  try {
    await initIAPInFlight;
  } finally {
    initIAPInFlight = null;
  }
}

async function initializeIAP(): Promise<void> {

  try {
    await initConnection();
  } catch (e) {
    console.warn('[iap] initConnection failed:', e);
    return;
  }

  // Install listeners before querying purchases so a state transition that
  // happens during cold-start recovery cannot be missed.
  purchaseUpdateSub = purchaseUpdatedListener((purchase) => {
    void handlePurchaseUpdate(purchase);
  });

  purchaseErrorSub = purchaseErrorListener((error) => {
    if (Platform.OS === 'android' && error.code === ErrorCode.AlreadyOwned) {
      void recoverAlreadyOwnedPurchase(error.productId);
      return;
    }
    handlePurchaseError(error);
  });
  initialized = true;

  // Recover active/unacknowledged transactions silently. The same idempotent
  // reconciliation runs again on auth restoration and every foreground entry.
  await reconcileAvailablePurchasesInternal();
}

async function reconcileAvailablePurchasesInternal(): Promise<boolean> {
  if (reconciliationInFlight) return reconciliationInFlight;
  reconciliationInFlight = (async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user?.id) return false;

    let restored = false;
    const purchases = await getAvailablePurchases();
    for (const purchase of purchases ?? []) {
      if (!getPurchaseEntitlement(purchase) || isAndroidPurchasePending(purchase)) continue;
      const txnId = String(purchase.id);
      const before = processedTransactionIds.has(txnId);
      await handlePurchaseUpdate(purchase);
      if (!before && processedTransactionIds.has(txnId)) restored = true;
    }
    if (restored) await refreshSubscriptionCache({ preserveExisting: true });
    return restored;
  })();
  try {
    return await reconciliationInFlight;
  } catch (error) {
    console.warn('[iap] purchase reconciliation failed:', error);
    return false;
  } finally {
    reconciliationInFlight = null;
  }
}

/** Reconcile purchases after auth restore and whenever the app returns active. */
export async function reconcileAvailablePurchases(): Promise<boolean> {
  if (!initialized) await initIAP();
  if (!initialized) return false;
  return reconcileAvailablePurchasesInternal();
}

/**
 * Tear down on app shutdown. RootLayout unmounts only when the entire
 * app exits, so this is mostly defensive.
 */
export async function cleanupIAP(): Promise<void> {
  if (initIAPInFlight) {
    try {
      await initIAPInFlight;
    } catch {
      /* initialization already logged its failure */
    }
  }
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
    processedTransactionIds.clear();
  }
}

// ---- Product fetching (for localized storefront pricing) ----

/** Fetches and normalizes the current storefront's subscription prices. */
type AndroidOffer = {
  basePlanIdAndroid?: string | null;
  currency?: string | null;
  displayPrice: string;
  offerTokenAndroid?: string | null;
  price: number;
  pricingPhasesAndroid?: {
    pricingPhaseList: Array<{
      formattedPrice: string;
      priceAmountMicros: string;
      priceCurrencyCode: string;
    }>;
  } | null;
};

export type SubscriptionPlanPricing = {
  displayPrice: string;
  price: number;
  currency: string;
};

export type StoreSubscriptionPricing = {
  yearly: SubscriptionPlanPricing;
  monthly: SubscriptionPlanPricing;
  yearlyPerMonth: string;
  monthlyAnnualized: string;
  yearlyTrialEligible: boolean;
};

function hasFreePhase(offer: AndroidOffer): boolean {
  return Boolean(
    offer.pricingPhasesAndroid?.pricingPhaseList.some(
      (phase) => Number(phase.priceAmountMicros) === 0,
    ),
  );
}

async function isIOSIntroTrialEligible(
  productId: string,
  prefetchedProducts?: ProductSubscription[],
): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const products = prefetchedProducts ?? await fetchSubscriptionProducts();
    const product = products.find((item) => item.id === productId) as
      | (ProductSubscription & {
          subscriptionInfoIOS?: { subscriptionGroupId?: string } | null;
          introductoryPricePaymentModeIOS?: string | null;
        })
      | undefined;
    const groupId = product?.subscriptionInfoIOS?.subscriptionGroupId;
    const hasFreeTrial = product?.introductoryPricePaymentModeIOS === 'free-trial';
    return Boolean(hasFreeTrial && groupId && await isEligibleForIntroOfferIOS(groupId));
  } catch (error) {
    console.warn('[iap] could not verify introductory-offer eligibility:', error);
    return false;
  }
}

function isAndroidIntroTrialEligible(
  products: ProductSubscription[],
  productId: string,
): boolean {
  if (Platform.OS !== 'android') return false;
  const product = products.find((item) => item.id === productId);
  const offers = ((product as { subscriptionOffers?: AndroidOffer[] } | undefined)
    ?.subscriptionOffers ?? []);
  return offers.some(hasFreePhase);
}

function selectAndroidOffer(
  offers: AndroidOffer[],
  cycle: SubscriptionCycle,
): AndroidOffer | undefined {
  // Prefer the configured free trial when the user is eligible. Google only
  // returns eligible offers; otherwise fall back to the active base plan.
  return cycle === 'yearly'
    ? offers.find(hasFreePhase) ?? offers[0]
    : offers[0];
}

export function getSubscriptionPlanPricing(
  products: ProductSubscription[],
  cycle: SubscriptionCycle,
): SubscriptionPlanPricing | null {
  if (Platform.OS === 'android') {
    const product = products.find((item) => item.id === `novame.plus.${cycle}`);
    const offers = ((product as { subscriptionOffers?: AndroidOffer[] } | undefined)
      ?.subscriptionOffers ?? []);
    const offer = selectAndroidOffer(offers, cycle);
    if (!offer) return null;
    // A trial offer's top-level display price can be $0.00. The final pricing
    // phase is the recurring base-plan price shown on the paywall.
    const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
    const recurring = phases[phases.length - 1];
    return recurring
      ? {
          displayPrice: recurring.formattedPrice,
          price: Number(recurring.priceAmountMicros) / 1_000_000,
          currency: recurring.priceCurrencyCode || offer.currency || product?.currency || '',
        }
      : {
          displayPrice: offer.displayPrice,
          price: offer.price,
          currency: offer.currency || product?.currency || '',
        };
  }

  const product = products.find(
    (item) => item.id === `novame.plus.${cycle}`,
  );
  if (!product?.displayPrice || typeof product.price !== 'number') return null;
  return {
    displayPrice: product.displayPrice,
    price: product.price,
    currency: product.currency,
  };
}

export async function fetchSubscriptionProducts(): Promise<ProductSubscription[]> {
  if (!initialized) {
    try {
      await initIAP();
    } catch {
      return [];
    }
  }
  try {
    const products = await fetchProducts({
      skus: Platform.OS === 'android'
        ? [...ANDROID_SUBSCRIPTION_PRODUCT_IDS]
        : [...IOS_SUBSCRIPTION_PRODUCT_IDS],
      type: 'subs',
    });
    const list = Array.isArray(products) ? (products as ProductSubscription[]) : [];
    return list;
  } catch (e) {
    console.warn('[iap] fetchProducts failed:', e);
    return [];
  }
}

function formatStoreCurrency(amount: number, currency: string): string {
  if (!Number.isFinite(amount) || amount < 0 || !currency) {
    throw new Error('The store returned incomplete subscription pricing.');
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch {
    // Currency and amount still come from the store. This fallback is only for
    // runtimes that cannot format a valid ISO currency code.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Returns the complete customer-facing price model for both paywalls.
 * Charged prices are the store-provided display strings. Derived comparison
 * amounts use only the store's numeric values and currency (never USD stubs).
 */
export async function fetchStoreSubscriptionPricing(): Promise<StoreSubscriptionPricing> {
  const products = await fetchSubscriptionProducts();
  const yearly = getSubscriptionPlanPricing(products, 'yearly');
  const monthly = getSubscriptionPlanPricing(products, 'monthly');

  if (!yearly || !monthly || !yearly.currency || !monthly.currency) {
    throw new Error('Subscription prices are temporarily unavailable.');
  }

  const yearlyTrialEligible = Platform.OS === 'android'
    ? isAndroidIntroTrialEligible(products, 'novame.plus.yearly')
    : await isIOSIntroTrialEligible('novame.plus.yearly', products);

  return {
    yearly,
    monthly,
    yearlyPerMonth: formatStoreCurrency(yearly.price / 12, yearly.currency),
    monthlyAnnualized: formatStoreCurrency(monthly.price * 12, monthly.currency),
    yearlyTrialEligible,
  };
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
    await initIAP();
  }
  if (!initialized) {
    throw new Error('The App Store connection is not ready. Please try again.');
  }

  // Purchases are allowed for guest users, but the receipt must still be
  // attached to a durable Supabase UUID. Create/restore that anonymous
  // session silently before opening StoreKit or Play Billing.
  const sessionReady = await ensureSession();
  if (!sessionReady) {
    throw new Error(
      'We couldn’t prepare your account for purchase. Check your connection and try again.',
    );
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const purchaseUserId = sessionData.session?.user?.id;
  if (!purchaseUserId) {
    throw new Error(
      'We couldn’t prepare your account for purchase. Check your connection and try again.',
    );
  }

  // Mark that the next listener fire originated from a user tap. The
  // listener uses this to decide whether to fire onPurchaseComplete
  // (which closes the paywall + shows success). Replays / renewals
  // run silently. Auto-clear after 60s in case the dialog is dismissed.
  userInitiatedInFlight = true;
  purchaseIncludesFreeTrialInFlight = false;
  purchaseAccountIdInFlight = purchaseUserId;
  if (userInitiatedTimer) clearTimeout(userInitiatedTimer);
  userInitiatedTimer = setTimeout(() => {
    const timedOutProductId = productId;
    userInitiatedInFlight = false;
    purchaseIncludesFreeTrialInFlight = false;
    purchaseAccountIdInFlight = null;
    userInitiatedTimer = null;
    handlePurchaseError(createPurchaseError({
      code: ErrorCode.PurchaseVerificationFailed,
      message: 'Your purchase is taking longer than expected. It will be restored automatically; you can also try Restore Purchases.',
      productId: timedOutProductId,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    }));
  }, 10 * 60 * 1000);

  try {
    // requestPurchase returns:
    //   - Purchase           -> new / upgrade (immediate, listener fires)
    //   - null               -> downgrade or crossgrade (scheduled,
    //                           NO new transaction, listener does NOT
    //                           fire). The change lives in renewalInfo.
    //                           autoRenewPreference and takes effect at
    //                           the end of the current period.
    // Cancellation throws ErrorCode.UserCancelled.
    // Android requires an eligible Play offer token alongside the SKU. Query
    // it immediately before launch instead of reusing the paywall's earlier
    // ProductDetails: Google explicitly warns that stale ProductDetails can
    // make launchBillingFlow fail.
    const cycle = PRODUCT_TO_CYCLE[productId];
    const androidProductId = productId;
    let androidOffer: string | undefined;
    if (Platform.OS === 'android') {
      const products = await fetchSubscriptionProducts();
      const product = products.find((item) => item.id === androidProductId);
      const offers = (product as { subscriptionOffers?: AndroidOffer[] } | undefined)
        ?.subscriptionOffers ?? [];
      const selectedOffer = selectAndroidOffer(offers, cycle);
      androidOffer = selectedOffer?.offerTokenAndroid ?? undefined;
      purchaseIncludesFreeTrialInFlight = Boolean(selectedOffer && hasFreePhase(selectedOffer));
    } else {
      purchaseIncludesFreeTrialInFlight = await isIOSIntroTrialEligible(productId);
    }
    if (Platform.OS === 'android' && !androidOffer) {
      throw new Error(
        `Google Play could not load the ${cycle} plan. Use a Play license tester or install the opted-in Play test-track build, then try again.`,
      );
    }
    const googleAccountId = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `novame:${purchaseUserId}`,
    );
    const result = await requestPurchase({
      request: {
        apple: { sku: productId, appAccountToken: purchaseUserId },
        google: {
          skus: [androidProductId],
          obfuscatedAccountId: googleAccountId,
          obfuscatedProfileId: purchaseUserId,
          ...(androidOffer
            ? { subscriptionOffers: [{ sku: androidProductId, offerToken: androidOffer }] }
            : {}),
        },
      },
      type: 'subs',
    });

    if (result === null || result === undefined) {
      // Scheduled change -- clear the in-flight flag because the
      // listener won't fire. The paywall will show "scheduled" UI.
      userInitiatedInFlight = false;
      purchaseIncludesFreeTrialInFlight = false;
      purchaseAccountIdInFlight = null;
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
    purchaseIncludesFreeTrialInFlight = false;
    purchaseAccountIdInFlight = null;
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
    if (Platform.OS === 'android' && errCode === ErrorCode.AlreadyOwned) {
      // Play already owns the SKU when a previous verification/acknowledgement
      // attempt was interrupted. Reconcile that purchase instead of asking the
      // user to buy it again.
      const recovered = await recoverAlreadyOwnedPurchase(productId);
      return recovered
        ? { kind: 'completed', productId }
        : { kind: 'cancelled' };
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
  cycle?: SubscriptionCycle;
  ownershipConflict?: PurchaseOwnershipConflict;
  pending?: boolean;
  error?: string;
}> {
  if (!initialized) {
    try {
      await initIAP();
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
    let restoredCycle: SubscriptionCycle | undefined;
    let ownershipConflict: PurchaseOwnershipConflict | undefined;
    let sawPending = false;
    let firstError: string | undefined;
    for (const purchase of purchases) {
      const productId = purchase.productId;
      const entitlement = getPurchaseEntitlement(purchase);
      if (!entitlement) continue;
      if (isAndroidPurchasePending(purchase)) {
        sawPending = true;
        continue;
      }
      try {
        await uploadPurchaseToServer(purchase);
      } catch (e) {
        const conflict = purchaseOwnershipConflict(e);
        if (conflict) {
          ownershipConflict ??= conflict;
          await finishOwnershipConflict(purchase, conflict);
          continue;
        }
        console.warn('[iap] restore upload failed for', productId, e);
        if (e instanceof PurchasePendingError) sawPending = true;
        firstError ??= purchaseFailureMessage(e);
        continue;
      }
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        /* non-fatal */
      }
      highestTier = pickHigherTier(highestTier, entitlement.tier);
      restoredCycle = entitlement.cycle;
    }

    if (highestTier) {
      await refreshSubscriptionCache();
      return { restored: true, tier: highestTier, cycle: restoredCycle };
    }
    return {
      restored: false,
      ownershipConflict,
      pending: sawPending,
      error: firstError,
    };
  } catch (e) {
    console.warn('[iap] restoreSubscriptions failed:', e);
    return { restored: false, error: purchaseFailureMessage(e) };
  }
}

// ---- Internal: purchase event handling ----

async function handlePurchaseUpdate(purchase: Purchase): Promise<void> {
  const productId = purchase.productId;
  const entitlement = getPurchaseEntitlement(purchase);
  if (!entitlement) {
    console.warn('[iap] unknown productId:', productId);
    return;
  }

  // Google explicitly forbids granting or acknowledging while a purchase is
  // pending. Play will emit it again as PURCHASED and foreground recovery also
  // queries it, so keeping it unfinished is intentional.
  if (isAndroidPurchasePending(purchase)) {
    const wasUserInitiated = userInitiatedInFlight;
    userInitiatedInFlight = false;
    purchaseIncludesFreeTrialInFlight = false;
    purchaseAccountIdInFlight = null;
    if (userInitiatedTimer) {
      clearTimeout(userInitiatedTimer);
      userInitiatedTimer = null;
    }
    if (wasUserInitiated) {
      handlePurchaseError(createPurchaseError({
        code: ErrorCode.Pending,
        message: new PurchasePendingError().message,
        productId,
        platform: 'android',
      }));
    }
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
  const startedFreeTrial = wasUserInitiated && purchaseIncludesFreeTrialInFlight;
  const expectedUserId = wasUserInitiated ? purchaseAccountIdInFlight : null;
  if (wasUserInitiated) {
    userInitiatedInFlight = false;
    purchaseIncludesFreeTrialInFlight = false;
    purchaseAccountIdInFlight = null;
    if (userInitiatedTimer) {
      clearTimeout(userInitiatedTimer);
      userInitiatedTimer = null;
    }
  }

  let verified: AppleIapResponse;
  try {
    verified = await uploadPurchaseToServer(purchase, expectedUserId);
  } catch (e) {
    console.error('[iap] server upload failed:', e);
    const conflict = purchaseOwnershipConflict(e);
    if (conflict) {
      await finishOwnershipConflict(purchase, conflict);
      notifyOwnershipConflict(conflict, productId);
      return;
    }
    // Don't finish the transaction -- StoreKit replays it on next
    // launch and we can retry the upload then. Also remove from the
    // dedup set so a future retry can attempt again.
    processedTransactionIds.delete(txnId);
    if (wasUserInitiated) {
      const message = purchaseFailureMessage(e);
      handlePurchaseError(createPurchaseError({
        code: ErrorCode.PurchaseVerificationFailed,
        message,
        productId,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }));
    }
    return;
  }

  // Server accepted -- finish the transaction so StoreKit drops it.
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch (e) {
    console.warn('[iap] finishTransaction failed (non-fatal):', e);
  }

  // The verification endpoint is authoritative and already returns the
  // granted tier. Persist it immediately so closing the paywall cannot flash
  // Free while a second user-sync request is still in flight.
  const verifiedTier = verified.tier ?? entitlement.tier;
  setCachedSubscription({
    tier: verifiedTier,
    lastFetchedAtMs: Date.now(),
    serverConfirmed: true,
  });
  clearQuotaExhausted();

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

  const { cycle } = entitlement;
  if (startedFreeTrial) logStartTrial({ productId, cycle });

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
      cb({ tier: verifiedTier, cycle });
    } catch (e) {
      console.warn('[iap] completeCallback threw:', e);
    }
  }

  // Reconcile verbose subscription/profile caches after the UI has already
  // closed. This is intentionally not awaited: server verification above is
  // the durable success boundary, while this GET is redundant bookkeeping.
  void refreshSubscriptionCache({ preserveExisting: true });
}

function handlePurchaseError(error: PurchaseError): void {
  userInitiatedInFlight = false;
  purchaseIncludesFreeTrialInFlight = false;
  purchaseAccountIdInFlight = null;
  if (userInitiatedTimer) {
    clearTimeout(userInitiatedTimer);
    userInitiatedTimer = null;
  }
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
  storeEnvironment?: StoreEnvironment;
  pending?: boolean;
  code?: string;
  acknowledgementPending?: boolean;
  error?: string;
};

async function uploadPurchaseToServer(
  purchase: Purchase,
  expectedUserId: string | null = null,
): Promise<AppleIapResponse> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) {
    throw new Error('No active session for IAP upload');
  }
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(
      'Your account changed while the purchase was open. Return to the account that started the purchase and restore it.',
    );
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
  const body = Platform.OS === 'android'
    ? { userId, purchaseToken: jws }
    : {
        userId,
        transactionId: String(purchase.id),
        productId: purchase.productId,
        originalTransactionId: originalTxnId,
        expiresDate: expiresIso,
        jws,
      };
  let data: AppleIapResponse;
  try {
    data = await apiClient.post<AppleIapResponse>(endpoint, body);
  } catch (error) {
    const response = apiErrorBody(error);
    // A stale Supabase access token must not strand a completed store order.
    // Refresh exactly once, verify that the user identity did not change, then
    // retry the same idempotent purchase token.
    if (
      Platform.OS === 'android'
      && error instanceof ApiError
      && error.status === 401
      && response?.code === 'AUTH_INVALID'
    ) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) throw error;
      if (refreshed.session.user.id !== userId) {
        throw new Error(
          'Your account changed while the purchase was being verified. Return to the account that started it and restore purchases.',
        );
      }
      data = await apiClient.post<AppleIapResponse>(endpoint, body);
    } else {
      throw error;
    }
  }

  if (data.pending || data.code === 'PURCHASE_PENDING') {
    throw new PurchasePendingError(data.error);
  }
  if (!data.success) {
    throw new Error(data.error ?? 'iap upload returned !success');
  }
  return data;
}

async function refreshSubscriptionCache(
  options?: { preserveExisting?: boolean },
): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return;
  if (!options?.preserveExisting) clearCachedSubscription();
  try {
    await fetchSubscriptionTier(userId, { force: true });
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
  purchaseIncludesFreeTrialInFlight = false;
  if (userInitiatedTimer) clearTimeout(userInitiatedTimer);
  userInitiatedTimer = setTimeout(() => {
    userInitiatedInFlight = false;
    purchaseIncludesFreeTrialInFlight = false;
    userInitiatedTimer = null;
  }, 60000);

  try {
    await presentCodeRedemptionSheetIOS();
  } catch (e) {
    console.warn('[iap] offer code redemption sheet failed:', e);
    userInitiatedInFlight = false;
    purchaseIncludesFreeTrialInFlight = false;
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
