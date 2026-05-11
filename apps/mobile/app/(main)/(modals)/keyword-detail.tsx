/**
 * Keyword detail modal — Stage 3.9.B.2 + Stage 6 polish
 *
 * Opened from the Collection sub-tab when the user taps a collected
 * keyword cell. Renders a parallax carousel of every wisdom_card the
 * user has published under that keyword, using FlippableCard for
 * each. Reuses fetchWisdoms (the same data source as Growth > My
 * Logs) and filters client-side by keyword_id slug.
 *
 * Stage 6 changes (Stage 3.9.B.2.glow.bugfix):
 *   - Removed the standalone `centerGlow` View overlay. It sat in
 *     front of the FlippableCard and clipped the top of the card's
 *     shadow halo. FlippableCard now ships its own domain-colored
 *     boxShadow glow that rotates with the 3D flip, so no external
 *     glow layer is needed.
 *   - Added swipe-vs-tap isolation. While Carousel is mid-pan,
 *     FlippableCard's tap-to-flip is disabled so a horizontal swipe
 *     doesn't accidentally trigger a flip on the card being scrolled
 *     past.
 *   - Card width now goes through getStandardCardWidth() so this
 *     screen matches every other place a FlippableCard renders.
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
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { getStandardCardWidth } from '@/lib/card-dimensions';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = getStandardCardWidth(SCREEN_W);

export default function KeywordDetailModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    slug?: string;
    name?: string;
    color?: string;
  }>();
  const slug = params.slug ?? '';
  const name = params.name ?? '';

  const [userId, setUserId] = useState<string | null>(null);
  const [wisdoms, setWisdoms] = useState<WisdomLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [centerIdx, setCenterIdx] = useState(0);

  // Stage 6 swipe-vs-tap: Carousel sets isScrolling=true on pan-begin
  // and resets ~250ms after settle. FlippableCard receives it as
  // `disabled` and ignores tap during that window.
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, []);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)/assets');
  };

  // Parse the category prefix from the slug so we can render the
  // matching category-back image behind the FlippableCard back face.
  const category = useMemo(() => slug.split('-')[0] ?? 'mind', [slug]);
  const backFilename = `${category}-back.webp`;

  const renderItem = ({ item }: { item: WisdomLog; index: number }) => {
    return (
      <View style={styles.itemWrap}>
        <FlippableCard
          frontFilename={`${slug}-front.webp`}
          backFilename={backFilename}
          quoteShort={item.card?.quote_short ?? ''}
          insightFull={item.card?.insight_full ?? ''}
          width={CARD_W}
          disabled={isScrolling}
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
              height={(CARD_W * 15) / 10 + 60}
              data={wisdoms}
              renderItem={renderItem}
              mode="parallax"
              modeConfig={{
                parallaxScrollingScale: 1,
                parallaxScrollingOffset: SCREEN_W - CARD_W - 30,
                parallaxAdjacentItemScale: 0.75,
              }}
              onSnapToItem={(i) => setCenterIdx(i)}
              onScrollStart={() => {
                if (scrollSettleTimerRef.current) {
                  clearTimeout(scrollSettleTimerRef.current);
                  scrollSettleTimerRef.current = null;
                }
                setIsScrolling(true);
              }}
              onScrollEnd={() => {
                scrollSettleTimerRef.current = setTimeout(() => {
                  setIsScrolling(false);
                }, 250);
              }}
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
  // Stage 6: removed `centerGlow` style — FlippableCard's own boxShadow
  // halo replaces it.
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