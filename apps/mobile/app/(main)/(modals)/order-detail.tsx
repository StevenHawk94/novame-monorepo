/**
 * Order Detail modal — Stage 3.9.B.6
 *
 * Renders the full detail of one order. Loaded by id (route param)
 * so a deep link to a specific order works without first hitting
 * the list. We re-use the order-history fetch, since the server
 * doesn't expose a single-order endpoint and the list payload is
 * cheap.
 *
 * Layout:
 *   - Header
 *   - Hero row: product name + status badge
 *   - Section "Order Summary": product, amount, currency, date,
 *     status, tracking, shipped/delivered timestamps when present
 *   - Section "Shipping Information": name + address fields
 *   - Section "Payment": method + masked payment intent ID
 *   - Footer CTA "Continue Card Selection" only when status is
 *     pending_selection (stage 5 will wire the actual selection UI).
 */
import { useEffect, useState } from 'react';
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

import { fetchOrders, type Order, type OrderStatus } from '@/lib/orders-api';
import { supabase } from '@/lib/supabase';
import { haptics } from '@/lib/haptics';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Pending Payment',
  pending_selection: 'Pending Selection',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const STATUS_TONE: Record<OrderStatus, { bg: string; fg: string }> = {
  pending_payment: { bg: 'rgba(239,68,68,0.18)', fg: '#F87171' },
  pending_selection: { bg: 'rgba(249,115,22,0.18)', fg: '#FB923C' },
  paid: { bg: 'rgba(168,85,247,0.18)', fg: '#C084FC' },
  processing: { bg: 'rgba(250,204,21,0.18)', fg: '#FACC15' },
  shipped: { bg: 'rgba(59,130,246,0.18)', fg: '#60A5FA' },
  delivered: { bg: 'rgba(34,197,94,0.18)', fg: '#4ADE80' },
  cancelled: { bg: 'rgba(239,68,68,0.18)', fg: '#F87171' },
  refunded: { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.5)' },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function OrderDetailModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const orderId = params.id ?? '';

  const [userId, setUserId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!userId || !orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrders(userId);
        if (cancelled) return;
        const found = (res.orders ?? []).find((o) => o.id === orderId) ?? null;
        setOrder(found);
      } catch (e) {
        console.warn('[order-detail] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, orderId]);

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  const onContinueSelection = () => {
    void haptics.light();
    // Stage 5.AIR.2: route to the cards-select modal carrying the
    // current orderId. cards-select handles the deck composition
    // and PATCHes the order to status='paid' on submit.
    router.push({
      pathname: '/(main)/(modals)/cards-select',
      params: { orderId: order?.id ?? '' },
    });
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
        <Text style={styles.headerTitle}>Order Details</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : !order ? (
        <View style={styles.empty}>
          <MaterialIcons
            name="error-outline"
            size={48}
            color="rgba(255,255,255,0.25)"
          />
          <Text style={styles.emptyText}>Order not found</Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.scroll,
              {
                paddingBottom:
                  (order.status === 'pending_selection' ? 120 : 32) +
                  insets.bottom,
              },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero row */}
            <View style={styles.hero}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>
                  {order.product_type === 'wisdom_book'
                    ? 'Wisdom Book'
                    : 'Wisdom Cards'}
                </Text>
                <Text style={styles.heroId}>#{order.id.slice(0, 8)}</Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: STATUS_TONE[order.status].bg },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: STATUS_TONE[order.status].fg },
                  ]}
                >
                  {STATUS_LABEL[order.status]}
                </Text>
              </View>
            </View>

            {/* Order summary */}
            <Section title="Order Summary">
              <Row
                label="Product"
                value={
                  order.product_type === 'wisdom_book'
                    ? 'Wisdom Book'
                    : 'Wisdom Cards'
                }
              />
              <Row label="Amount" value={`$${order.amount.toFixed(2)}`} />
              <Row label="Currency" value={order.currency || 'USD'} />
              <Row label="Date" value={formatDate(order.created_at)} />
              <Row label="Status" value={STATUS_LABEL[order.status]} />
              {order.tracking_number ? (
                <Row label="Tracking" value={order.tracking_number} />
              ) : null}
              {order.shipped_at ? (
                <Row label="Shipped" value={formatDate(order.shipped_at)} />
              ) : null}
              {order.delivered_at ? (
                <Row label="Delivered" value={formatDate(order.delivered_at)} />
              ) : null}
            </Section>

            {/* Shipping */}
            <Section title="Shipping Information">
              <Row label="Name" value={order.shipping_name ?? '\u2014'} />
              <Row label="Address" value={order.shipping_address ?? '\u2014'} />
              <Row label="City" value={order.shipping_city ?? '\u2014'} />
              <Row label="State" value={order.shipping_state ?? '\u2014'} />
              <Row label="ZIP" value={order.shipping_zip ?? '\u2014'} />
              <Row label="Country" value={order.shipping_country ?? '\u2014'} />
              {order.shipping_phone ? (
                <Row label="Phone" value={order.shipping_phone} />
              ) : null}
            </Section>

            {/* Payment */}
            <Section title="Payment">
              <Row label="Method" value="Credit Card" />
              <Row
                label="Payment ID"
                value={
                  order.payment_intent_id
                    ? order.payment_intent_id.slice(0, 20)
                    : 'N/A'
                }
              />
            </Section>
          </ScrollView>

          {order.status === 'pending_selection' ? (
            <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
              <Pressable
                onPress={onContinueSelection}
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.ctaText}>Continue Card Selection</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value || '\u2014'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E' },
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginTop: 12,
  },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 16,
  },
  heroTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  heroId: { color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '800' },
  section: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  rowLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    flexShrink: 0,
    marginRight: 12,
  },
  rowValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(15,11,46,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.4)',
  },
  ctaText: { color: '#C084FC', fontSize: 15, fontWeight: '800' },
});
