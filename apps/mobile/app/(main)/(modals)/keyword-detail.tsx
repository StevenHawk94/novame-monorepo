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
import { getCachedKeywordDetail, setCachedKeywordDetail } from '@/lib/keyword-detail-cache';
import { apiClient } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { haptics } from '@/lib/haptics';

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
  // Cache-first: seed from the per-keyword cache so the carousel renders
  // instantly. loading is true only when there's no cache (first-ever open
  // of this keyword); otherwise we show cached cards and refresh silently.
  const cachedInitial = getCachedKeywordDetail(slug);
  const [wisdoms, setWisdoms] = useState<WisdomLog[]>(cachedInitial ?? []);
  const [loading, setLoading] = useState(cachedInitial === null);
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
        // Stage 5.WR.2 (Bug B fix): parallel-fetch published wisdoms
        // AND orphan cards. /api/wisdoms only returns cards that
        // join through the wisdoms table, so default / starter cards
        // (wisdom_id=NULL) never appear there. Query
        // /api/generate-abc-cards directly to pick up the user's
        // orphan cards by keyword and merge them in.
        const [wisdomsRes, orphanRes] = await Promise.all([
          fetchWisdoms(userId, { limit: 200 }),
          apiClient
            .get<{ success: boolean; cards: Array<{
              id: string;
              wisdom_id: string | null;
              keyword_id: string | null;
              quote_short: string | null;
              insight_full: string | null;
              wisdom_score: number | null;
              wisdom_emotion: string | null;
              card_b: string | null;
              card_c: string | null;
              task_1: string | null;
              task_2: string | null;
              created_at: string;
            }> }>(
              `/api/generate-abc-cards?userId=${encodeURIComponent(userId)}&keywordId=${encodeURIComponent(slug)}`,
            )
            .catch(() => ({ success: false, cards: [] })),
        ]);
        if (cancelled) return;

        const filteredWisdoms = (wisdomsRes.wisdoms ?? []).filter(
          (w) => w.card?.keyword_id === slug,
        );

        // Only pick up orphan cards (wisdom_id IS NULL) — non-orphan
        // ones are already in filteredWisdoms via the join above and
        // would duplicate.
        const orphanCards = (orphanRes.cards ?? []).filter(
          (c) => c.wisdom_id === null,
        );

        // Wrap each orphan card as a WisdomLog shape with text=null.
        // FlippableCard's renderItem only reads card.quote_short and
        // card.insight_full, so the missing text/description fields
        // don't break the carousel render.
        const orphanWisdoms: WisdomLog[] = orphanCards.map((c) => ({
          id: `starter-${c.id}`,
          created_at: c.created_at,
          text: null,
          description: null,
          categories: null,
          card: {
            id: c.id,
            keyword_id: c.keyword_id,
            quote_short: c.quote_short,
            insight_full: c.insight_full,
            wisdom_score: c.wisdom_score,
            wisdom_emotion: c.wisdom_emotion,
            card_b: c.card_b,
            card_c: c.card_c,
            task_1: c.task_1,
            task_2: c.task_2,
            // Stage 6: orphan starter cards predate the redesign and
            // have no reframe / reflective_question / aspire_impacts.
            // Setting null lets InsightView fall back to the legacy
            // splitTitleBody(card_b) render path for these.
            reframe: null,
            reflective_question: null,
            aspire_impacts: null,
            // Stage 6 Bug 3: orphan starter cards have no published
            // resonance; NULL hides Block 4a in InsightView (matches
            // the WisdomCardEmbed contract).
            community_count: null,
            // Stage 6 follow-up: orphan starter cards predate Section C
            // peer_comment generation; NULL hides the new chat-bubble
            // block in InsightView (matches WisdomCardEmbed contract).
            peer_comment: null,
          },
        }));

        // Orphans first (chronologically earliest), then published
        // wisdoms in newest-first order. This puts the action-
        // initiative starter card at the front of the carousel for
        // new users.
        const merged = [...orphanWisdoms, ...filteredWisdoms];
        setWisdoms(merged);
        setCachedKeywordDetail(slug, merged);
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
    void haptics.light();
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
      source={{ uri: 'https://media.novameapp.com/cards-background.webp' }}
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