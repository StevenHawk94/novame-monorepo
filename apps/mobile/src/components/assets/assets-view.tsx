/**
 * Assets sub-tab — Stage 3.9.B.3 (Stage 6 visual refresh)
 *
 * The "Manifest Your Wisdom" main view: banner header, "Your Journey"
 * progress section with two unlock bars (Words + Cards Type), product
 * cards (Wisdom Book + Wisdom Cards), and Order History entry.
 *
 * Visual model (refreshed):
 *   - Progress cards: dark navy panel with a tinted border, large
 *     branded icon on the left, label + sub on the right, percentage
 *     pill upper-right.
 *   - Product cards: deep-purple body with the cover image on top
 *     against a light frame; full descriptive title; CTA pill at the
 *     bottom (Locked = teal, Order = pink, Continue = orange when a
 *     wisdom-cards selection is pending).
 *
 * Data source: shared state from the Assets tab parent (no fetch
 * here). totalWords is summed client-side from wisdoms.text. Once
 * stage 5 wires the server-side last_book_applied_at timestamp,
 * we'll filter wisdoms by created_at > that value to subtract
 * already-shipped books from the available word count.
 *
 * 3.9.B.3 stops at the main view. Tap on a product card or Order
 * History button currently opens stub modal routes added in
 * 3.9.B.4-6.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import {
  fetchAppConfig,
  getCachedConfig,
  isCacheStale,
} from '@/lib/app-config-api';
import { getProductAssetSource } from '@/lib/asset-cache';
import type { AssetsTabSharedState } from '@/lib/assets-tab-shared';
import { fetchOrders, type Order } from '@/lib/orders-api';
import { supabase } from '@/lib/supabase';
import { haptics } from '@/lib/haptics';

const BOOK_ICON = require('../../../assets/images/product/book-icon.webp');
const CARD_ICON = require('../../../assets/images/product/card-icon.webp');

type Props = {
  shared: AssetsTabSharedState;
};

export function AssetsView({ shared }: Props) {
  const { totalWords, collectedKw } = shared;
  const [orders, setOrders] = useState<Order[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

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
        const res = await fetchOrders(userId);
        if (!cancelled) setOrders(res.orders ?? []);
      } catch (e) {
        console.warn('[assets] fetch orders failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Stage A (dynamic config): read unlock thresholds from cached
  // app_config. Background-refresh once on mount when cache is stale
  // (1h TTL). Result is eventual consistency -- new thresholds appear
  // on the next page visit, not the current render. payment-stub
  // (sub-step A3.3) handles strict refresh for the checkout flow.
  const config = getCachedConfig();
  useEffect(() => {
    if (isCacheStale()) void fetchAppConfig();
  }, []);

  // Stage 3.9.B.3 stub: until stage 5 lands the server-side
  // last_book_applied_at field, we just show total words. Word reset
  // logic ("each successful order zeroes the count") activates then.
  const availableWords = totalWords;
  const bookProgress = Math.min((availableWords / config.book_unlock_words) * 100, 100);
  const bookUnlocked = availableWords >= config.book_unlock_words;

  const cardsProgress = Math.min((collectedKw / config.cards_unlock_count) * 100, 100);
  const cardsUnlocked = collectedKw >= config.cards_unlock_count;

  const pendingCardsOrder = useMemo(
    () =>
      orders.find(
        (o) =>
          o.product_type === 'wisdom_cards' && o.status === 'pending_selection',
      ) ?? null,
    [orders],
  );

  const onOpenBook = () => {
    router.push({
      pathname: '/(main)/(modals)/product-detail',
      params: { product: 'wisdom_book' },
    });
  };

  const onOpenCards = () => {
    router.push({
      pathname: '/(main)/(modals)/product-detail',
      params: { product: 'wisdom_cards' },
    });
  };

  const onOpenOrders = () => {
    void haptics.light();
    router.push('/(main)/(modals)/order-history');
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Banner */}
      <LinearGradient
        colors={['#7C3AED', '#9333EA', '#A855F7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.banner}
      >
        <Text style={styles.bannerTitle}>Manifest Your Wisdom</Text>
        <Text style={styles.bannerSubtitle}>
          Bring Your Wisdom Assets to Life
        </Text>
      </LinearGradient>

      <Text style={styles.sectionTitle}>Your Journey</Text>

      {/* Words progress (Wisdom Book) */}
      <ProgressCard
        iconSource={BOOK_ICON}
        accent="#F472B6"
        countLabel={availableWords.toLocaleString()}
        totalLabel={config.book_unlock_words.toLocaleString()}
        unit="Words"
        sub="To unlock your wisdom book"
        progress={bookProgress}
      />

      {/* Cards Type progress (Wisdom Cards) */}
      <ProgressCard
        iconSource={CARD_ICON}
        accent="#A855F7"
        countLabel={String(collectedKw)}
        totalLabel={String(config.cards_unlock_count)}
        unit="Cards Type"
        sub="To unlock your wisdom cards deck"
        progress={cardsProgress}
      />

      {/* Product cards */}
      <View style={styles.productRow}>
        <ProductCell
          imgSource={getProductAssetSource('product-book-cover')}
          title="Personalized Book of Your Growth Journey"
          unlocked={bookUnlocked}
          pending={false}
          onPress={onOpenBook}
        />
        <ProductCell
          imgSource={getProductAssetSource('product-cards-cover')}
          title="Personalized Card Deck of Your Growth Wisdom"
          unlocked={cardsUnlocked}
          pending={!!pendingCardsOrder}
          onPress={onOpenCards}
        />
      </View>

      {/* Order History entry */}
      <Pressable
        onPress={onOpenOrders}
        style={({ pressed }) => [
          styles.historyBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <MaterialIcons name="receipt-long" size={18} color="rgba(255,255,255,0.55)" />
        <Text style={styles.historyText}>Order History</Text>
        {orders.length > 0 ? (
          <View style={styles.historyBadge}>
            <Text style={styles.historyBadgeText}>{orders.length}</Text>
          </View>
        ) : null}
      </Pressable>
    </ScrollView>
  );
}

function ProgressCard({
  iconSource,
  accent,
  countLabel,
  totalLabel,
  unit,
  sub,
  progress,
}: {
  iconSource: number;
  accent: string;
  countLabel: string;
  totalLabel: string;
  unit: string;
  sub: string;
  progress: number;
}) {
  return (
    <View style={[styles.progressCard, { borderColor: `${accent}55` }]}>
      <Image source={iconSource} style={styles.progressIcon} contentFit="contain" />
      <View style={styles.progressBody}>
        <View style={styles.progressTopRow}>
          <Text style={styles.progressLabel}>
            <Text style={[styles.progressCount, { color: accent }]}>
              {countLabel}/{totalLabel}
            </Text>{' '}
            <Text style={styles.progressUnit}>{unit}</Text>
          </Text>
          <View style={styles.percentPill}>
            <MaterialIcons name="star" size={11} color="#FACC15" />
            <Text style={styles.percentPillText}>{Math.round(progress)}%</Text>
          </View>
        </View>
        <Text style={styles.progressSub}>{sub}</Text>
        <View style={styles.progressTrack}>
          <LinearGradient
            colors={[accent, `${accent}AA`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${progress}%` }]}
          />
        </View>
      </View>
    </View>
  );
}

function ProductCell({
  imgSource,
  title,
  unlocked,
  pending,
  onPress,
}: {
  imgSource: ImageSourcePropType;
  title: string;
  unlocked: boolean;
  pending: boolean;
  onPress: () => void;
}) {
  // CTA appearance: pending overrides unlocked; otherwise Locked/Order
  // map to teal / pink to match the design comp.
  const ctaText = pending ? 'Continue' : unlocked ? 'Order' : 'Locked';
  const ctaBg = pending
    ? '#F97316'
    : unlocked
    ? '#EC4899'
    : '#5EEAD4';
  const ctaTextColor = pending || unlocked ? '#FFFFFF' : '#0F172A';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.productCell,
        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.productImgWrap}>
        <Image source={imgSource} style={styles.productImg} contentFit="cover" cachePolicy="memory" />
        {!unlocked && !pending ? (
          <View style={styles.productLockOverlay}>
            <MaterialIcons name="lock" size={32} color="rgba(255,255,255,0.6)" />
          </View>
        ) : null}
        {pending ? (
          <View style={styles.productPendingOverlay}>
            <MaterialIcons name="schedule" size={28} color="#FB923C" />
          </View>
        ) : null}
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productTitle} numberOfLines={2}>
          {title}
        </Text>
        <View style={[styles.productCta, { backgroundColor: ctaBg }]}>
          <Text style={[styles.productCtaText, { color: ctaTextColor }]}>
            {ctaText}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 32,
  },
  banner: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    marginTop: 4,
    marginBottom: 20,
    borderRadius: 16,
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },
  bannerSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    marginLeft: 4,
  },
  // Progress card: dark panel with accent-tinted border, big icon
  // on the left, content on the right.
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15,11,46,0.6)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 14,
  },
  progressIcon: {
    width: 56,
    height: 56,
  },
  progressBody: {
    flex: 1,
  },
  progressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressLabel: {
    flex: 1,
  },
  progressCount: {
    fontSize: 18,
    fontWeight: '900',
  },
  progressUnit: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  percentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  percentPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  progressSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 8,
  },
  progressTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  // Product row + cell: purple body, image on top, descriptive title
  // and CTA at the bottom.
  productRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    marginBottom: 16,
  },
  productCell: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    overflow: 'hidden',
  },
  productImgWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
    position: 'relative',
  },
  productImg: {
    width: '100%',
    height: '100%',
  },
  productLockOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  productPendingOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249,115,22,0.18)',
  },
  productInfo: {
    padding: 12,
    minHeight: 88,
    justifyContent: 'space-between',
  },
  productTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
    marginBottom: 10,
  },
  productCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  productCtaText: {
    fontSize: 12,
    fontWeight: '800',
  },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  historyText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
  },
  historyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.18)',
    marginLeft: 4,
  },
  historyBadgeText: {
    color: '#C084FC',
    fontSize: 11,
    fontWeight: '800',
  },
});
