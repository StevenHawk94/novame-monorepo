/**
 * Order History modal — Stage 3.9.B.6
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { fetchOrders, type Order, type OrderStatus } from '@/lib/orders-api';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';

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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function orderToShipping(o: Order): Record<string, string> {
  return {
    name: o.shipping_name ?? '',
    address: o.shipping_address ?? '',
    address2: '',
    city: o.shipping_city ?? '',
    state: o.shipping_state ?? '',
    zip: o.shipping_zip ?? '',
    country: o.shipping_country ?? 'US',
    phone: o.shipping_phone ?? '',
  };
}

export default function OrderHistoryModal() {
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetchOrders(userId);
      setOrders(res.orders ?? []);
    } catch (e) {
      console.warn('[orders] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  useFocusEffect(
    useCallback(() => {
      if (userId) void load();
    }, [userId, load]),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  const openDetail = (order: Order) => {
    router.push({
      pathname: '/(main)/(modals)/order-detail',
      params: { id: order.id },
    });
  };

  const resumePayment = (order: Order) => {
    const persisted = storage.getString('novame.shipping');
    let shipping: Record<string, string>;
    if (persisted) {
      try {
        shipping = JSON.parse(persisted);
      } catch {
        shipping = orderToShipping(order);
      }
    } else {
      shipping = orderToShipping(order);
    }
    router.push({
      pathname: '/(main)/(modals)/payment-stub',
      params: {
        product: order.product_type,
        shipping: JSON.stringify(shipping),
      },
    });
  };

  const browseProducts = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
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
        <Text style={styles.headerTitle}>Order History</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MaterialIcons
            name="receipt-long"
            size={56}
            color="rgba(255,255,255,0.18)"
          />
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptySub}>
            Order your printed wisdom assets when ready.
          </Text>
          <Pressable
            onPress={browseProducts}
            style={({ pressed }) => [
              styles.emptyBtn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.emptyBtnText}>Browse products</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 32 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              onOpen={() => openDetail(o)}
              onResumePayment={() => resumePayment(o)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function OrderCard({
  order,
  onOpen,
  onResumePayment,
}: {
  order: Order;
  onOpen: () => void;
  onResumePayment: () => void;
}) {
  const tone = STATUS_TONE[order.status];
  const isPendingPay = order.status === 'pending_payment';
  const isPendingSel = order.status === 'pending_selection';

  return (
    <View
      style={[
        styles.card,
        isPendingPay && {
          borderColor: 'rgba(239,68,68,0.35)',
        },
      ]}
    >
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle}>
              {order.product_type === 'wisdom_book'
                ? 'Wisdom Book'
                : 'Wisdom Cards'}
            </Text>
            <Text style={styles.cardId}>#{shortId(order.id)}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.statusText, { color: tone.fg }]}>
              {STATUS_LABEL[order.status]}
            </Text>
          </View>
        </View>

        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>${order.amount.toFixed(2)}</Text>
          <Text style={styles.cardMeta}>{formatDate(order.created_at)}</Text>
        </View>

        {order.tracking_number ? (
          <Text style={styles.cardTracking}>
            Tracking: {order.tracking_number}
          </Text>
        ) : null}

        {isPendingSel ? (
          <Text style={styles.cardHintOrange}>
            Tap to continue card selection
          </Text>
        ) : null}
      </Pressable>

      {isPendingPay ? (
        <Pressable
          onPress={onResumePayment}
          style={({ pressed }) => [
            styles.payNowBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <MaterialIcons name="lock" size={14} color="#F87171" />
          <Text style={styles.payNowText}>Pay Now</Text>
        </Pressable>
      ) : null}
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 6,
  },
  emptySub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 22,
  },
  emptyBtn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.4)',
  },
  emptyBtnText: { color: '#C084FC', fontSize: 14, fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitleWrap: { flex: 1 },
  cardTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cardId: { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 10, fontWeight: '800' },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  cardMeta: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  cardTracking: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 6,
  },
  cardHintOrange: {
    color: '#FB923C',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  payNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.32)',
  },
  payNowText: { color: '#F87171', fontSize: 13, fontWeight: '800' },
});
