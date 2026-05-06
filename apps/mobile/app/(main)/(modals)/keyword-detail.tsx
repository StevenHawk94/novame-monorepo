/**
 * Keyword detail modal — Stage 3.9.B.2
 *
 * Opened from the Collection sub-tab when the user taps a collected
 * keyword cell. Renders a parallax carousel of every wisdom_card the
 * user has published under that keyword, using FlippableCard for
 * each. Reuses fetchWisdoms (the same data source as Growth > My
 * Logs) and filters client-side by keyword_id slug.
 *
 * Visual model:
 *   - Full-screen modal with cards-background.webp behind a dark
 *     overlay
 *   - Header: back button + keyword name + card count
 *   - Body: react-native-reanimated-carousel in parallax mode so the
 *     side cards are smaller, dimmed, and slightly behind the center
 *     card — matching the old web carousel
 *   - Footer hint: "Tap to flip · Swipe to browse"
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ImageBackground } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Carousel from 'react-native-reanimated-carousel';

import { FlippableCard } from '@/components/cards/FlippableCard';
import { fetchWisdoms, type WisdomLog } from '@/lib/wisdoms-api';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.min(270, SCREEN_W - 80);

export default function KeywordDetailModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    slug?: string;
    name?: string;
    color?: string;
  }>();
  const slug = params.slug ?? '';
  const name = params.name ?? '';
  const accentColor = params.color ?? '#A855F7';

  const [userId, setUserId] = useState<string | null>(null);
  const [wisdoms, setWisdoms] = useState<WisdomLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [centerIdx, setCenterIdx] = useState(0);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!userId || !slug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWisdoms(userId, { limit: 200 });
        if (cancelled) return;
        const filtered = (res.wisdoms ?? []).filter(
          (w) => w.card?.keyword_id === slug,
        );
        setWisdoms(filtered);
      } catch (e) {
        console.warn('[keyword-detail] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, slug]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  // Parse the category prefix from the slug so we can render the
  // matching category-back image behind the FlippableCard back face.
  const category = useMemo(() => slug.split('-')[0] ?? 'mind', [slug]);
  const backFilename = `${category}-back.webp`;

  const renderItem = ({ item, index }: { item: WisdomLog; index: number }) => {
    const isCenter = index === centerIdx;
    return (
      <View style={styles.itemWrap}>
        {isCenter ? (
          <View
            style={[
              styles.centerGlow,
              { shadowColor: accentColor },
            ]}
          />
        ) : null}
        <FlippableCard
          frontFilename={`${slug}-front.webp`}
          backFilename={backFilename}
          quoteShort={item.card?.quote_short ?? ''}
          insightFull={item.card?.insight_full ?? ''}
          width={CARD_W}
        />
      </View>
    );
  };

  return (
    <ImageBackground
      source={{ uri: 'https://media.novameapp.com/cards/cards-background.webp' }}
      style={styles.root}
    >
      <View style={[styles.tint, { paddingTop: insets.top + 8 }]} />

      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8 },
        ]}
      >
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{name}</Text>
          <Text style={styles.headerSub}>
            {loading
              ? 'Loading…'
              : `${wisdoms.length} card${wisdoms.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator size="large" color="#FFFFFF" />
        ) : wisdoms.length === 0 ? (
          <View style={styles.emptyWrap}>
            <MaterialIcons
              name="style"
              size={48}
              color="rgba(255,255,255,0.2)"
            />
            <Text style={styles.emptyText}>
              No cards in this collection yet
            </Text>
          </View>
        ) : (
          <>
            <Carousel
              loop={false}
              width={SCREEN_W}
              height={(CARD_W * 15) / 10 + 20}
              data={wisdoms}
              renderItem={renderItem}
              mode="parallax"
              modeConfig={{
                parallaxScrollingScale: 1,
                parallaxScrollingOffset: SCREEN_W - CARD_W - 30,
                parallaxAdjacentItemScale: 0.75,
              }}
              onSnapToItem={(i) => setCenterIdx(i)}
            />
            <Text style={styles.hint}>Tap to flip · Swipe to browse</Text>
            {wisdoms.length > 1 ? (
              <Text style={styles.idxText}>
                {centerIdx + 1} / {wisdoms.length}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  tint: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(15,11,46,0.55)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centerGlow: {
    position: 'absolute',
    width: CARD_W + 12,
    height: (CARD_W * 15) / 10 + 12,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 10,
    marginTop: 8,
  },
  idxText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  emptyWrap: {
    alignItems: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginTop: 12,
  },
});
