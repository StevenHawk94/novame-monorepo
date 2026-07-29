/**
 * Payment modal — Stage 5.AIR.1 (replaces 3.9.B.5 stub).
 *
 * Receives ?product= (wisdom_book / wisdom_cards) and ?shipping=
 * (JSON-stringified address). Renders an order summary, then on Pay:
 *   1. POST /api/orders to create a row with status='pending_payment'.
 *      Captures the orderId.
 *   2. POST /api/book-payment to create an Airwallex paymentIntent,
 *      embedding originalOrderId in metadata so the webhook can
 *      route the success event back to this row.
 *   3. PATCH /api/orders to attach paymentIntentId to the pending row
 *      (insurance: if the webhook fails to fire we can correlate
 *      manually from Airwallex dashboard).
 *   4. WebBrowser.openAuthSessionAsync opens the server bridge page
 *      (/api/payment-checkout) inside SFAuthenticationSession on iOS.
 *      The bridge boots the Airwallex JS SDK and redirects to the
 *      real hosted checkout page. Returning to the app happens via
 *      novame:// deep link emitted by /api/payment-result, which
 *      SFAuthenticationSession intercepts and uses to resolve.
 *   5. Parse the returned URL to extract status. The Airwallex
 *      webhook (apps/api/src/app/api/webhooks/airwallex/route.js,
 *      already implemented) is the authoritative source for
 *      flipping the order from pending_payment to paid /
 *      pending_selection. We do NOT race the webhook by writing
 *      paid status from the client. Instead, on success we navigate
 *      to order-detail and let the user (and our cached fetch) see
 *      the row update.
 *
 * Status branches:
 *   - success -> close payment-stub, push order-detail, toast.
 *                Order row will flip to paid (book) or
 *                pending_selection (cards) within ~1-3 seconds via
 *                webhook. order-detail polls fetchOrders until then.
 *   - cancel  -> stay on payment-stub, show "Payment cancelled" hint
 *                so user can retry without losing the shipping
 *                context.
 *   - fail    -> same as cancel but with a failure-tone hint.
 *   - dismiss -> SFAuthenticationSession dismissed without redirect
 *                (e.g. user swiped down). Treat as cancel.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import {
  fetchAppConfig,
  getCachedConfig,
  type AppConfig,
} from '@/lib/app-config-api';
import { supabase } from '@/lib/supabase';
import { haptics } from '@/lib/haptics';
import {
  createOrder,
  updateOrder,
  type ShippingPayload,
} from '@/lib/orders-api';
import {
  createPaymentIntent,
  buildCheckoutUrl,
} from '@/lib/airwallex-api';

type ShippingState = ShippingPayload;

const PRODUCT_TITLE: Record<'wisdom_book' | 'wisdom_cards', string> = {
  wisdom_book: 'Wisdom Book',
  wisdom_cards: 'Wisdom Cards',
};

type ResultBanner =
  | null
  | { kind: 'cancel' }
  | { kind: 'fail'; message: string };

export default function PaymentModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ product?: string; shipping?: string }>();
  const product: 'wisdom_book' | 'wisdom_cards' =
    params.product === 'wisdom_cards' ? 'wisdom_cards' : 'wisdom_book';

  const shipping = useMemo<ShippingState | null>(() => {
    if (!params.shipping) return null;
    try {
      return JSON.parse(params.shipping) as ShippingState;
    } catch {
      return null;
    }
  }, [params.shipping]);

  // Stage A (dynamic config / policy c): payment-stub force-refreshes
  // app_config on mount, bypassing TTL. This guarantees the displayed
  // total matches the server-charged amount even if cache is stale.
  //
  // Initial render uses cached values to avoid an empty-state flash.
  // After the network fetch lands, setConfig triggers a re-render --
  // in the rare case prices changed, the user sees the latest values
  // before tapping Pay. On fetch failure we keep the cached values
  // and let the server be the source of truth (it always re-reads DB
  // when creating the paymentIntent).
  const [config, setConfig] = useState<AppConfig>(() => getCachedConfig());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchAppConfig({ noCache: true });
      if (cancelled) return;
      if (result.kind === 'success') {
        setConfig(result.config);
      }
      // On failure, keep cached values silently. The server still
      // charges the canonical DB price regardless.
    })();
    return () => { cancelled = true; };
  }, []);

  const price =
    product === 'wisdom_book' ? config.printed_book_price : config.wisdom_cards_price;
  const total = price + config.shipping_fee;

  const [busy, setBusy] = useState(false);
  const [resultBanner, setResultBanner] = useState<ResultBanner>(null);

  const onPay = async () => {
    void haptics.light();
    if (busy) return;
    if (!shipping) {
      Alert.alert('Missing address', 'Please go back and complete the shipping form.');
      return;
    }
    setBusy(true);
    setResultBanner(null);

    try {
      // ---- 1. Resolve current user ----
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id;
      const userEmail = sess.session?.user?.email ?? '';
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in to continue.');
        setBusy(false);
        return;
      }

      // ---- 2. Create pending_payment order row ----
      const createdOrder = await createOrder({
        userId,
        productType: product,
        amount: total,
        shipping,
        status: 'pending_payment',
      });
      const orderId = createdOrder.order.id;

      // ---- 3. Create Airwallex paymentIntent (metadata routes the
      //         webhook back to orderId) ----
      const intent = await createPaymentIntent({
        userId,
        userEmail,
        amount: total,
        orderType: product,
        originalOrderId: orderId,
      });

      // ---- 4. Attach paymentIntentId to the pending order
      //         (insurance / manual reconciliation aid) ----
      try {
        await updateOrder({
          orderId,
          status: 'pending_payment',
          paymentIntentId: intent.paymentIntentId,
        });
      } catch (e) {
        // Non-fatal: the webhook also writes payment_intent_id when
        // the success event fires. We keep going.
        console.warn('[payment] PATCH paymentIntentId failed (non-fatal):', e);
      }

      // ---- 5. Build checkout URL + open in SFAuthenticationSession ----
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL!;
      const checkoutUrl = buildCheckoutUrl({
        apiBaseUrl,
        intentId: intent.paymentIntentId,
        clientSecret: intent.clientSecret,
        amount: intent.amount,
      });

      const result = await WebBrowser.openAuthSessionAsync(
        checkoutUrl,
        'novame://payment-result',
      );

      // ---- 6. Branch on the SFAuthenticationSession result ----
      if (result.type === 'success' && result.url) {
        // Parse the deep-link URL: novame://payment-result?status=...
        const status = parseStatusFromUrl(result.url);

        if (status === 'success') {
          setBusy(false);
          // The Airwallex webhook is now updating the order row in
          // the background (typically <2s). Push the user to the
          // order-detail screen which polls until the status flips.
          if (router.canGoBack()) router.back(); // pop payment-stub
          router.push({
            // A (bugfix): order-detail reads the id from params.id
            // (useLocalSearchParams<{ id?: string }>). We were passing it as
            // `orderId`, so params.id was undefined -> order-detail's fetch
            // effect bailed (`if (!userId || !orderId) return`) and the
            // loading spinner never cleared (infinite spin after payment).
            // order-history passes { id } and works; match that key.
            pathname: '/(main)/(modals)/order-detail',
            params: { id: orderId },
          });
          return;
        }

        if (status === 'cancel') {
          setBusy(false);
          setResultBanner({ kind: 'cancel' });
          return;
        }

        // status === 'fail' or unknown
        setBusy(false);
        setResultBanner({
          kind: 'fail',
          message: 'Payment did not complete. Please try again.',
        });
        return;
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        // User dismissed SFAuthenticationSession without a redirect.
        // Treat as cancel.
        setBusy(false);
        setResultBanner({ kind: 'cancel' });
        return;
      }

      // Other types (e.g. 'locked' on Android-only auth flows)
      // shouldn't apply here; treat defensively.
      setBusy(false);
      setResultBanner({
        kind: 'fail',
        message: 'Could not open the secure payment session. Please try again.',
      });
    } catch (e) {
      console.error('[payment] flow failed:', e);
      setBusy(false);
      setResultBanner({
        kind: 'fail',
        message: e instanceof Error ? e.message : 'Something went wrong.',
      });
    }
  };

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/bags');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Payment</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 140 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>{PRODUCT_TITLE[product]}</Text>
            <Text style={styles.cardValue}>${price.toFixed(2)}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Shipping</Text>
            <Text style={styles.cardValue}>
              {config.shipping_fee === 0
                ? 'Free'
                : `$${config.shipping_fee.toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.cardRow}>
            <Text style={styles.cardTotalLabel}>Total</Text>
            <Text style={styles.cardTotalValue}>${total.toFixed(2)}</Text>
          </View>
        </View>

        {shipping ? (
          <View style={styles.card}>
            <Text style={styles.cardSection}>Ship to</Text>
            <Text style={styles.shipName}>{shipping.name}</Text>
            <Text style={styles.shipLine}>
              {shipping.address}
              {shipping.address2 ? `, ${shipping.address2}` : ''}
            </Text>
            <Text style={styles.shipLine}>
              {shipping.city}
              {shipping.state ? `, ${shipping.state}` : ''}
              {shipping.zip ? ` ${shipping.zip}` : ''}
            </Text>
            <Text style={styles.shipLine}>{shipping.country}</Text>
            {shipping.phone ? (
              <Text style={[styles.shipLine, { marginTop: 6 }]}>
                {shipping.phone}
              </Text>
            ) : null}
          </View>
        ) : null}

        {resultBanner ? (
          <View
            style={[
              styles.banner,
              resultBanner.kind === 'cancel' ? styles.bannerCancel : styles.bannerFail,
            ]}
          >
            <MaterialIcons
              name={resultBanner.kind === 'cancel' ? 'info' : 'error-outline'}
              size={18}
              color={resultBanner.kind === 'cancel' ? '#B58A2A' : '#C25B4E'}
            />
            <Text style={styles.bannerText}>
              {resultBanner.kind === 'cancel'
                ? "Payment cancelled. Your address is saved — tap below to try again."
                : resultBanner.message}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={onPay}
          disabled={busy}
          style={({ pressed }) => [
            styles.cta,
            busy && { opacity: 0.5 },
            pressed && !busy && { opacity: 0.85 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <MaterialIcons name="lock" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.ctaText}>
            {busy ? 'Opening secure checkout...' : `Pay $${total.toFixed(2)}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Parse the status query parameter from a deep-link URL like:
 *   novame://payment-result?status=success
 *
 * Returns 'success' | 'cancel' | 'fail' | null.
 */
function parseStatusFromUrl(url: string): 'success' | 'cancel' | 'fail' | null {
  try {
    // Hand-roll the parse since RN's URL polyfill can be flaky on
    // custom-scheme URLs. We just want the status query param.
    const queryStart = url.indexOf('?');
    if (queryStart === -1) return null;
    const query = url.slice(queryStart + 1);
    const pairs = query.split('&');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      if (k === 'status') {
        const decoded = decodeURIComponent(v || '');
        if (decoded === 'success' || decoded === 'cancel' || decoded === 'fail') {
          return decoded;
        }
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2E6CB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4A3423',
  },
  headerTitle: { color: '#4A3423', fontSize: 17, fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E8D5B0',
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  cardLabel: { color: '#6B5B44', fontSize: 14, fontWeight: '600' },
  cardValue: { color: '#2B2B2B', fontSize: 14, fontWeight: '700' },
  divider: {
    height: 1,
    backgroundColor: '#E8D5B0',
    marginVertical: 8,
  },
  cardTotalLabel: { color: '#2B2B2B', fontSize: 15, fontWeight: '800' },
  cardTotalValue: { color: '#8A6240', fontSize: 17, fontWeight: '900' },
  cardSection: {
    color: '#8A7A63',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  shipName: { color: '#2B2B2B', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  shipLine: { color: '#6B5B44', fontSize: 13, marginBottom: 2 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  bannerCancel: {
    backgroundColor: 'rgba(181,138,42,0.12)',
    borderColor: 'rgba(181,138,42,0.3)',
  },
  bannerFail: {
    backgroundColor: 'rgba(194,91,78,0.12)',
    borderColor: 'rgba(194,91,78,0.3)',
  },
  bannerText: {
    flex: 1,
    color: '#6B5B44',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(242,230,203,0.92)',
    borderTopWidth: 1,
    borderTopColor: '#E8D5B0',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#8A6240',
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
