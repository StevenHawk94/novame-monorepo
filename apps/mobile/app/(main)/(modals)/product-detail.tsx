/**
 * Product detail modal — Stage 3.9.B.4
 *
 * Vertical-scroll product detail. Receives ?product=wisdom_book or
 * ?product=wisdom_cards. Renders hero art, a feature/description
 * image (book-detail-1 / cards-detail-1), the price line, and an
 * Order CTA whose state depends on:
 *
 *   - locked       — below the unlock threshold; CTA shows progress
 *                   ("Need X / Y words" or "Collect X / 48 keywords")
 *                   and is disabled
 *   - in-progress  — wisdom_cards has a pending_selection order;
 *                   CTA disabled with "Order in progress"
 *   - unlocked     — routes to the shipping form (3.9.B.5)
 *
 * The unlock thresholds + word/keyword counts come straight from
 * the wisdoms feed and orders, fetched once when the modal opens
 * (mirrors the Assets tab parent so opening this modal directly
 * via deep link still works).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BOOK_UNLOCK_WORDS,
  CARDS_UNLOCK_COUNT,
  PRINTED_BOOK_PRICE,
  WISDOM_CARDS_PRICE,
  SHIPPING_FEE,
} from '@novame/core';
import { fetchWisdoms } from '@/lib/wisdoms-api';
import { fetchOrders, type Order } from '@/lib/orders-api';
import { supabase } from '@/lib/supabase';

type ProductKey = 'wisdom_book' | 'wisdom_cards';

const COPY: Record<ProductKey, { title: string; tagline: string }> = {
  wisdom_book: {
    title: 'Wisdom Book',
    tagline: 'A printed hardcover of every wisdom you have shared.',
  },
  wisdom_cards: {
    title: 'Wisdom Cards',
    tagline: 'A printed deck of 48 keyword cards from your collection.',
  },
};

function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function ProductDetailModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ product?: string }>();
  const product: ProductKey =
    params.product === 'wisdom_cards' ? 'wisdom_cards' : 'wisdom_book';

  const [userId, setUserId] = useState<string | null>(null);
  const [totalWords, setTotalWords] = useState(0);
  const [collectedKw, setCollectedKw] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [wRes, oRes] = await Promise.all([
          fetchWisdoms(userId, { limit: 200 }),
          fetchOrders(userId),
        ]);
        if (cancelled) return;
        const wisdoms = wRes.wisdoms ?? [];
        setTotalWords(wisdoms.reduce((s, w) => s + countWords(w.text), 0));
        const slugSet = new Set<string>();
        for (const w of wisdoms) {
          if (w.card?.keyword_id) slugSet.add(w.card.keyword_id);
        }
        setCollectedKw(slugSet.size);
        setOrders(oRes.orders ?? []);
      } catch (e) {
        console.warn('[product-detail] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const pendingCardsOrder = useMemo(
    () =>
      orders.find(
        (o) =>
          o.product_type === 'wisdom_cards' && o.status === 'pending_selection',
      ) ?? null,
    [orders],
  );

  const heroSource =
    product === 'wisdom_book'
      ? require('../../../assets/images/product/book-hero.webp')
      : require('../../../assets/images/product/cards-hero.webp');

  // Cards-detail-1 isn\'t shipped yet; until it lands we fall back to
  // the cards-hero image so the layout doesn\'t collapse.
  const detailSource =
    product === 'wisdom_book'
      ? require('../../../assets/images/product/book-detail-1.webp')
      : require('../../../assets/images/product/cards-hero.webp');

  // Resolve detail-image natural aspect ratio so the image renders
  // unclipped at full natural height. RNImage.resolveAssetSource
  // works for bundled require()'d assets.
  const detailMeta = RNImage.resolveAssetSource(detailSource);
  const detailAspectRatio =
    detailMeta && detailMeta.width && detailMeta.height
      ? detailMeta.width / detailMeta.height
      : 4 / 5;

  const price =
    product === 'wisdom_book' ? PRINTED_BOOK_PRICE : WISDOM_CARDS_PRICE;
  const total = price + SHIPPING_FEE;

  // Order CTA state machine.
  let ctaState: 'locked' | 'pending' | 'unlocked' = 'locked';
  let ctaLabel = '';

  if (product === 'wisdom_book') {
    if (totalWords >= BOOK_UNLOCK_WORDS) {
      ctaState = 'unlocked';
      ctaLabel = `Order — $${total.toFixed(2)}`;
    } else {
      ctaState = 'locked';
      ctaLabel = `Need ${totalWords.toLocaleString()} / ${BOOK_UNLOCK_WORDS.toLocaleString()} words`;
    }
  } else {
    if (pendingCardsOrder) {
      ctaState = 'pending';
      ctaLabel = 'Order in progress';
    } else if (collectedKw >= CARDS_UNLOCK_COUNT) {
      ctaState = 'unlocked';
      ctaLabel = `Order — $${total.toFixed(2)}`;
    } else {
      ctaState = 'locked';
      ctaLabel = `Collect ${collectedKw} / ${CARDS_UNLOCK_COUNT} keywords`;
    }
  }

  const onOrder = () => {
    if (ctaState !== 'unlocked') return;
    router.push({
      pathname: '/(main)/(modals)/shipping-form',
      params: { product },
    });
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      {/* Sticky header */}
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
        <Text style={styles.headerTitle}>{COPY[product].title}</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 140 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.heroCard}>
            <Image source={heroSource} style={styles.heroImg} contentFit="cover" />
          </View>

          {/* Tagline */}
          <Text style={styles.tagline}>{COPY[product].tagline}</Text>

          {/* Detail image (long-strip product story) — render at natural
              aspect ratio so nothing gets cropped. We pull the source
              dimensions via Image.resolveAssetSource and feed them as
              an aspectRatio style so the image fills width and the
              container height derives naturally. */}
          <View style={styles.detailCard}>
            <Image
              source={detailSource}
              style={[
                styles.detailImg,
                { aspectRatio: detailAspectRatio },
              ]}
              contentFit="contain"
            />
          </View>

          {/* Price block (only when unlocked / pending) */}
          {ctaState === 'unlocked' || ctaState === 'pending' ? (
          <View style={styles.priceBlock}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>{COPY[product].title}</Text>
              <Text style={styles.priceValue}>${price.toFixed(2)}</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Shipping</Text>
              <Text style={styles.priceValue}>
                {(SHIPPING_FEE as number) === 0 ? 'Free' : `$${(SHIPPING_FEE as number).toFixed(2)}`}
              </Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={styles.priceRow}>
              <Text style={styles.priceTotalLabel}>Total</Text>
              <Text style={styles.priceTotalValue}>${total.toFixed(2)}</Text>
            </View>
          </View>
          ) : null}
        </ScrollView>
      )}

      {/* Sticky CTA */}
      {!loading ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + 16 },
          ]}
        >
          <Pressable
            onPress={onOrder}
            disabled={ctaState !== 'unlocked'}
            style={({ pressed }) => [
              styles.ctaBtn,
              ctaState === 'unlocked' && pressed && { opacity: 0.85 },
            ]}
          >
            {ctaState === 'unlocked' ? (
              <LinearGradient
                colors={['#A855F7', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaUnlocked}
              >
                <MaterialIcons name="shopping-bag" size={18} color="#FFFFFF" />
                <Text style={styles.ctaUnlockedText}>{ctaLabel}</Text>
              </LinearGradient>
            ) : (
              <View style={styles.ctaLocked}>
                <MaterialIcons
                  name={ctaState === 'pending' ? 'schedule' : 'lock'}
                  size={18}
                  color="rgba(255,255,255,0.45)"
                />
                <Text style={styles.ctaLockedText}>{ctaLabel}</Text>
              </View>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
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
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  heroCard: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroImg: {
    width: '100%',
    height: '100%',
  },
  tagline: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 18,
  },
  detailCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 18,
  },
  detailImg: {
    width: '100%',
  },
  priceBlock: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  priceLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  priceValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  priceDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 8,
  },
  priceTotalLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  priceTotalValue: {
    color: '#C084FC',
    fontSize: 17,
    fontWeight: '900',
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
  ctaBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  ctaUnlocked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  ctaUnlockedText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  ctaLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  ctaLockedText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '700',
  },
});
