/**
 * Payment stub modal — Stage 3.9.B.5
 *
 * Renders the full order summary (product, shipping address, totals)
 * and a stub Pay CTA. Real payment integration arrives in stage 5
 * — this view is what the user sees today after Continuing from the
 * shipping form.
 *
 * Inputs (route params from shipping-form):
 *   - product   : 'wisdom_book' | 'wisdom_cards'
 *   - shipping  : JSON-stringified ShippingState (from MMKV-persisted
 *                 form state)
 *
 * The stub button shows a temporary "Coming soon" message rather
 * than calling /api/orders or /api/book-payment so we don't pollute
 * the database with bogus pending orders during the transition.
 */
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import {
  PRINTED_BOOK_PRICE,
  WISDOM_CARDS_PRICE,
  SHIPPING_FEE,
} from '@novame/core';

type ShippingState = {
  name: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
};

const PRODUCT_TITLE: Record<'wisdom_book' | 'wisdom_cards', string> = {
  wisdom_book: 'Wisdom Book',
  wisdom_cards: 'Wisdom Cards',
};

export default function PaymentStubModal() {
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

  const price = product === 'wisdom_book' ? PRINTED_BOOK_PRICE : WISDOM_CARDS_PRICE;
  const total = price + SHIPPING_FEE;

  const onPay = () => {
    Alert.alert(
      'Coming soon',
      'In-app checkout is being rolled out. Please check back shortly.',
    );
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Payment</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: 120 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Order summary */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>{PRODUCT_TITLE[product]}</Text>
            <Text style={styles.cardValue}>${price.toFixed(2)}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Shipping</Text>
            <Text style={styles.cardValue}>
              {(SHIPPING_FEE as number) === 0
                ? 'Free'
                : `$${(SHIPPING_FEE as number).toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.cardRow}>
            <Text style={styles.cardTotalLabel}>Total</Text>
            <Text style={styles.cardTotalValue}>${total.toFixed(2)}</Text>
          </View>
        </View>

        {/* Ship to */}
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
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={onPay}
          style={({ pressed }) => [
            styles.cta,
            pressed && { opacity: 0.85 },
          ]}
        >
          <MaterialIcons name="lock" size={18} color="#FFFFFF" />
          <Text style={styles.ctaText}>Pay ${total.toFixed(2)}</Text>
        </Pressable>
      </View>
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
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  cardLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' },
  cardValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 8,
  },
  cardTotalLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  cardTotalValue: { color: '#C084FC', fontSize: 17, fontWeight: '900' },
  cardSection: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  shipName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  shipLine: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginBottom: 2 },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#A855F7',
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
