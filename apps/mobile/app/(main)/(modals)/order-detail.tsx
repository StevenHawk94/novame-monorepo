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
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
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
  pending_payment: { bg: 'rgba(194,91,78,0.12)', fg: '#C25B4E' },
  pending_selection: { bg: 'rgba(181,138,42,0.12)', fg: '#B58A2A' },
  paid: { bg: 'rgba(138,98,64,0.12)', fg: '#8A6240' },
  processing: { bg: 'rgba(181,138,42,0.12)', fg: '#B58A2A' },
  shipped: { bg: 'rgba(74,123,166,0.12)', fg: '#4A7BA6' },
  delivered: { bg: 'rgba(62,124,79,0.12)', fg: '#3E7C4F' },
  cancelled: { bg: 'rgba(194,91,78,0.12)', fg: '#C25B4E' },
  refunded: { bg: 'rgba(138,122,99,0.12)', fg: '#8A7A63' },
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

  // Re-fetch on every focus (not just mount). After submitting a deck in
  // cards-select and tapping OK, we router.back() to THIS already-mounted
  // screen; a mount-only effect would keep showing the stale
  // pending_selection status. useFocusEffect re-runs so the status reflects
  // the server (now 'paid' + no Continue CTA). Also re-runs when userId
  // resolves, since that dep change happens while this screen is focused.
  useFocusEffect(
    useCallback(() => {
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
    }, [userId, orderId]),
  );

  const goBack = () => {
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/bags');
  };

  const onContinueSelection = () => {
    void haptics.light();
    // Phase A: cards-select composed a deck of 48 keyword cards, and both the
    // cards and the modal are gone. v2.0 prints an object codex and a skill
    // deck instead; their composer lands in Phase C. The button stays so the
    // order flow's shape stays legible, but it navigates nowhere yet.
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
          <ActivityIndicator size="large" color="#8A6240" />
        </View>
      ) : !order ? (
        <View style={styles.empty}>
          <MaterialIcons
            name="error-outline"
            size={48}
            color="#C9BCA5"
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {
    color: '#8A7A63',
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
  heroTitle: { color: '#4A3423', fontSize: 18, fontWeight: '800' },
  heroId: { color: '#8A7A63', fontSize: 12, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '800' },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8D5B0',
  },
  sectionTitle: {
    color: '#8A7A63',
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
    borderBottomColor: '#E8D5B0',
  },
  rowLabel: {
    color: '#8A7A63',
    fontSize: 12,
    flexShrink: 0,
    marginRight: 12,
  },
  rowValue: {
    color: '#2B2B2B',
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
    backgroundColor: 'rgba(242,230,203,0.95)',
    borderTopWidth: 1,
    borderTopColor: '#E8D5B0',
  },
  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#8A6240',
    borderWidth: 1,
    borderColor: '#8A6240',
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
