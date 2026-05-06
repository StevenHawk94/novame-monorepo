/**
 * Assets sub-tab — Stage 3.9.B.3
 *
 * The "Manifest Your Wisdom" main view: shows two unlock progress
 * bars (Words and Cards Type), two product cards (Wisdom Book and
 * Wisdom Cards), and an Order History entry button.
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
  BOOK_UNLOCK_WORDS,
  CARDS_UNLOCK_COUNT,
} from '@novame/core';
import type { AssetsTabSharedState } from '@/lib/assets-tab-shared';
import { fetchOrders, type Order } from '@/lib/orders-api';
import { supabase } from '@/lib/supabase';

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

  // Stage 3.9.B.3 stub: until stage 5 lands the server-side
  // last_book_applied_at field, we just show total words. Word reset
  // logic ("each successful order zeroes the count") activates then.
  const availableWords = totalWords;
  const bookProgress = Math.min((availableWords / BOOK_UNLOCK_WORDS) * 100, 100);
  const bookUnlocked = availableWords >= BOOK_UNLOCK_WORDS;

  const cardsProgress = Math.min((collectedKw / CARDS_UNLOCK_COUNT) * 100, 100);
  const cardsUnlocked = collectedKw >= CARDS_UNLOCK_COUNT;

  // A pending wisdom_cards order means the user paid but hasn't yet
  // chosen which 48 cards to print. We surface this on the cards
  // product cell.
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

      {/* Words progress (Wisdom Book) */}
      <ProgressCard
        icon="edit-note"
        gradient={['#34D399', '#3B82F6']}
        label={`${availableWords.toLocaleString()}/${BOOK_UNLOCK_WORDS.toLocaleString()} Words`}
        sub="To unlock your wisdom book"
        progress={bookProgress}
        barGradient={['#34D399', '#3B82F6']}
      />

      {/* Cards Type progress (Wisdom Cards) */}
      <ProgressCard
        icon="style"
        gradient={['#7C3AED', '#6D28D9']}
        label={`${collectedKw}/${CARDS_UNLOCK_COUNT} Cards Type`}
        sub="To unlock your wisdom cards deck"
        progress={cardsProgress}
        barGradient={['#A855F7', '#7C3AED']}
      />

      {/* Product cards */}
      <View style={styles.productRow}>
        <ProductCell
          imgSource={require('../../../assets/images/product/book-cover.webp')}
          title="Wisdom Book"
          stat={`${availableWords.toLocaleString()}/${BOOK_UNLOCK_WORDS.toLocaleString()}`}
          unlocked={bookUnlocked}
          pending={false}
          onPress={onOpenBook}
        />
        <ProductCell
          imgSource={require('../../../assets/images/product/cards-cover.webp')}
          title="Wisdom Cards"
          stat={
            pendingCardsOrder
              ? 'Selection pending'
              : `${collectedKw}/${CARDS_UNLOCK_COUNT}`
          }
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
  icon,
  gradient,
  label,
  sub,
  progress,
  barGradient,
}: {
  icon: 'edit-note' | 'style';
  gradient: [string, string];
  label: string;
  sub: string;
  progress: number;
  barGradient: [string, string];
}) {
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.progressCard}
    >
      <View style={styles.progressHeader}>
        <MaterialIcons name={icon} size={18} color="rgba(255,255,255,0.85)" />
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <LinearGradient
          colors={barGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.progressFill, { width: `${progress}%` }]}
        />
      </View>
      <Text style={styles.progressSub}>{sub}</Text>
    </LinearGradient>
  );
}

function ProductCell({
  imgSource,
  title,
  stat,
  unlocked,
  pending,
  onPress,
}: {
  imgSource: number;
  title: string;
  stat: string;
  unlocked: boolean;
  pending: boolean;
  onPress: () => void;
}) {
  const cta = pending ? 'Continue' : unlocked ? 'Order' : 'Locked';
  const ctaColor = pending
    ? '#F97316'
    : unlocked
    ? '#22C55E'
    : 'rgba(255,255,255,0.35)';
  const ctaBg = pending
    ? 'rgba(249,115,22,0.18)'
    : unlocked
    ? 'rgba(34,197,94,0.18)'
    : 'rgba(255,255,255,0.06)';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.productCell,
        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.productImgWrap}>
        <Image source={imgSource} style={styles.productImg} contentFit="cover" />
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
        <Text style={styles.productTitle}>{title}</Text>
        <Text style={styles.productStat}>{stat}</Text>
        <View style={[styles.productCta, { backgroundColor: ctaBg }]}>
          <Text style={[styles.productCtaText, { color: ctaColor }]}>{cta}</Text>
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
    marginBottom: 18,
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
  progressCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 6,
    flex: 1,
  },
  progressPercent: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
  },
  progressTrack: {
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '500',
  },
  productRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    marginBottom: 16,
  },
  productCell: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  productImgWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'rgba(0,0,0,0.04)',
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
  },
  productTitle: {
    color: '#1A1A1A',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  productStat: {
    color: '#888',
    fontSize: 11,
    marginBottom: 8,
  },
  productCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  productCtaText: {
    fontSize: 11,
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
