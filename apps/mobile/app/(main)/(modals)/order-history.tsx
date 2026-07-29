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
    void haptics.light();
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/bags');
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
        <Text style={styles.headerTitle}>Order History</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#8A6240" />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MaterialIcons
            name="receipt-long"
            size={56}
            color="#C9BCA5"
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
          borderColor: 'rgba(194,91,78,0.45)',
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
          <MaterialIcons name="lock" size={14} color="#C25B4E" />
          <Text style={styles.payNowText}>Pay Now</Text>
        </Pressable>
      ) : null}
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#4A3423',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 6,
  },
  emptySub: {
    color: '#8A7A63',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 22,
  },
  emptyBtn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: '#FBF6EA',
    borderWidth: 1.5,
    borderColor: '#8A6240',
  },
  emptyBtnText: { color: '#8A6240', fontSize: 14, fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8D5B0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitleWrap: { flex: 1 },
  cardTitle: { color: '#2B2B2B', fontSize: 14, fontWeight: '800' },
  cardId: { color: '#8A7A63', fontSize: 11, marginTop: 2 },
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
  cardMeta: { color: '#8A7A63', fontSize: 12 },
  cardTracking: {
    color: '#8A7A63',
    fontSize: 12,
    marginTop: 6,
  },
  cardHintOrange: {
    color: '#B58A2A',
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
    backgroundColor: 'rgba(194,91,78,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(194,91,78,0.35)',
  },
  payNowText: { color: '#C25B4E', fontSize: 13, fontWeight: '800' },
});
