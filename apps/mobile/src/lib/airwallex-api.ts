/**
 * Airwallex API client wrapper — Stage 5.AIR.1
 *
 * Wraps the server's /api/book-payment endpoint to create an
 * Airwallex paymentIntent. The endpoint is named "book-payment" for
 * historical reasons but actually handles all printed-product
 * payments (wisdom_book + wisdom_cards) — the orderType field
 * disambiguates.
 *
 * Why a separate file from orders-api.ts: paymentIntent creation
 * lives at /api/book-payment (Airwallex-specific concerns: customer
 * lookup/create, currency, metadata for webhook routing). Order
 * record creation lives at /api/orders (DB concern only). Mobile
 * makes both calls back-to-back inside payment-stub.tsx Pay button
 * but they are conceptually distinct operations on different
 * collaborators.
 *
 * The flow this module enables (see payment-stub.tsx for the call
 * site):
 *   1. createOrder({ status: 'pending_payment' }) -> orderId
 *   2. createPaymentIntent({ originalOrderId: orderId, ... })
 *      -> paymentIntentId + clientSecret
 *   3. Build checkoutUrl using server's /api/payment-checkout bridge
 *   4. Open in SFAuthenticationSession via expo-web-browser
 *   5. User pays on Airwallex hosted page
 *   6. Airwallex redirects back to server /api/payment-result, which
 *      in turn deep-links back into the app via novame://
 *   7. Webhook (already implemented) updates the order status in DB
 */
import { apiClient } from './api';

export type ProductType = 'wisdom_book' | 'wisdom_cards';

export type CreatePaymentIntentParams = {
  userId: string;
  userEmail: string;
  amount: number;
  orderType: ProductType;
  originalOrderId: string;
};

export type CreatePaymentIntentResponse = {
  success: boolean;
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
};

/**
 * Create a Airwallex paymentIntent for a NovaMe order.
 *
 * The originalOrderId is critical: it gets embedded in the
 * paymentIntent.metadata.original_order_id field so the
 * /api/webhooks/airwallex handler can route the webhook event back
 * to the correct row in the orders table.
 */
export async function createPaymentIntent(
  params: CreatePaymentIntentParams,
): Promise<CreatePaymentIntentResponse> {
  return apiClient.post<CreatePaymentIntentResponse>('/api/book-payment', {
    action: 'create',
    userId: params.userId,
    userEmail: params.userEmail,
    amount: params.amount,
    orderType: params.orderType,
    originalOrderId: params.originalOrderId,
    // Stage A (dynamic pricing): server reads canonical price from
    // app_config by `product`. The `amount` field above is kept for
    // back-compat but ignored server-side; the server-charged amount
    // is always the latest DB value.
    product: params.orderType,
  });
}

/**
 * Build the URL of the server's payment-checkout bridge page.
 *
 * The bridge page is necessary because Airwallex does not expose a
 * direct public URL for hosted checkout — the JS SDK
 * (AirwallexComponentsSDK.init().payments.redirectToCheckout) must
 * run inside a browser context, and that context is the bridge
 * page. The bridge:
 *   1. Loads the Airwallex SDK from their CDN
 *   2. Calls redirectToCheckout with the intent + secret
 *   3. The SDK navigates window.location to the real Airwallex
 *      hosted page
 *
 * After the user pays, Airwallex redirects to successUrl/failUrl/
 * cancelUrl which all point at our server's /api/payment-result
 * bridge, which in turn deep-links back into the app.
 */
export function buildCheckoutUrl(args: {
  apiBaseUrl: string;
  intentId: string;
  clientSecret: string;
  amount: number;
}): string {
  const { apiBaseUrl, intentId, clientSecret, amount } = args;
  // All three result URLs point at the SAME bridge endpoint with
  // different status query params. The bridge HTML / JS handles
  // the deep-link back into the app uniformly; the client-side
  // status parsing differentiates the UX.
  const baseResult = `${apiBaseUrl}/api/payment-result`;
  const successUrl = `${baseResult}?status=success`;
  const failUrl = `${baseResult}?status=fail`;
  const cancelUrl = `${baseResult}?status=cancel`;

  const qs = new URLSearchParams({
    intentId,
    clientSecret,
    amount: String(amount),
    successUrl,
    failUrl,
    cancelUrl,
  });

  return `${apiBaseUrl}/api/payment-checkout?${qs.toString()}`;
}
