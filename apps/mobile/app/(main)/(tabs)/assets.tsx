/**
 * Assets tab — Stage 3.9.B + Stage 6 swipe refresh.
 *
 * Two sub-tabs: Collection + Assets. State for the user's wisdoms
 * (and the per-keyword counts derived from them) lives here at the
 * parent level so both sub-tabs share a single fetch instead of
 * each querying /api/wisdoms separately.
 *
 * Stage 6: sub-tab switching now supports both tap (PagerTabBar) and
 * horizontal swipe (reanimated-carousel). The underline animates in
 * lockstep with the swipe progress. See PagerTabBar + growth.tsx for
 * symmetric implementation rationale.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Carousel, {
  type ICarouselInstance,
} from 'react-native-reanimated-carousel';
import { useSharedValue } from 'react-native-reanimated';

import { CollectionView } from '@/components/assets/collection-view';
import { AssetsView } from '@/components/assets/assets-view';
import { PagerTabBar } from '@/components/ui/pager-tab-bar';
import {
  fetchUserStatsWithCache,
  getCachedUserStats,
  type UserStats,
} from '@/lib/user-stats-api';
import { supabase } from '@/lib/supabase';
import type { AssetsTabSharedState } from '@/lib/assets-tab-shared';

type SubTab = 'collection' | 'assets';

const SCREEN_W = Dimensions.get('window').width;

export default function AssetsTab() {
  const insets = useSafeAreaInsets();
  const [subTab, setSubTab] = useState<SubTab>('collection');

  // Carousel control: ref for tap-driven scrollTo, sharedValue for the
  // tab-bar underline slide animation. Carousel v4.x accepts the
  // SharedValue directly via onProgressChange (no JS callback hop).
  const carouselRef = useRef<ICarouselInstance>(null);
  const scrollProgress = useSharedValue(0);

  const [userId, setUserId] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(
    () => getCachedUserStats(),
  );
  const [loading, setLoading] = useState(() => getCachedUserStats() === null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  const load = useMemo(
    () => async () => {
      if (!userId) return;
      // Stage 6 SWR cache-first. Don't toggle loading if we have cache.
      const hasCache = getCachedUserStats() !== null;
      try {
        const res = await fetchUserStatsWithCache(userId);
        setStats(res);
      } catch (e) {
        console.warn('[assets] fetch user-stats failed:', e);
      } finally {
        if (!hasCache) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  // Re-fetch when the tab regains focus so newly published wisdoms
  // immediately bump the Collection grid + Assets progress bars.
  useFocusEffect(
    useMemo(
      () => () => {
        if (userId) void load();
      },
      [userId, load],
    ),
  );

  const counts = stats?.keywordCounts ?? {};
  const totalWords = stats?.totalWords ?? 0;
  const collectedKw = stats?.uniqueKeywords ?? 0;

  const shared: AssetsTabSharedState = {
    wisdoms: [],
    counts,
    totalWords,
    collectedKw,
    loading,
  };

  // Carousel needs an explicit height. We compute the available
  // vertical space: full screen minus top safe area, minus the
  // sub-tab header (paddingTop 8 + tab height ~46 + baseline 2),
  // minus the bottom tab bar (~90 incl. safe-area). The carousel
  // children each contain their own scrolling content if needed.
  const screenH = Dimensions.get('window').height;
  const headerH = 56; // sub-tab strip total height
  const bottomTabH = 90;
  const carouselHeight = screenH - insets.top - headerH - bottomTabH;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.segHeader}>
        <PagerTabBar
          tabs={['Collection', 'Assets']}
          scrollProgress={scrollProgress}
          activeIndex={subTab === 'collection' ? 0 : 1}
          onTabPress={(i) => {
            const next: SubTab = i === 0 ? 'collection' : 'assets';
            setSubTab(next);
            carouselRef.current?.scrollTo({ index: i, animated: true });
          }}
        />
      </View>

      {loading && !stats ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : (
        <Carousel
          ref={carouselRef}
          loop={false}
          width={SCREEN_W}
          height={carouselHeight}
          data={[0, 1]}
          defaultIndex={subTab === 'collection' ? 0 : 1}
          // Direct SharedValue write -- worklet-driven, no JS hop.
          // This is the v4.x recommended pattern per the migration
          // guide. The bar underline reads this same sharedValue.
          onProgressChange={scrollProgress}
          onSnapToItem={(idx) => {
            const next: SubTab = idx === 0 ? 'collection' : 'assets';
            if (next !== subTab) setSubTab(next);
          }}
          // Horizontal-swipe gesture isolation: only activate the pan
          // once the user has moved >10pt horizontally. If they move
          // >5pt vertically first, the gesture fails -- letting the
          // inner ScrollView handle the swipe. iOS HIG default
          // thresholds.
          onConfigurePanGesture={(panGesture) => {
            'worklet';
            panGesture.activeOffsetX([-10, 10]);
            panGesture.failOffsetY([-5, 5]);
          }}
          renderItem={({ index }) => (
            <View style={{ flex: 1 }}>
              {index === 0 ? (
                <CollectionView shared={shared} />
              ) : (
                <AssetsView shared={shared} />
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  segHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
