/**
 * Assets tab — Stage 3.9.B
 *
 * Two sub-tabs: Collection + Assets. State for the user's wisdoms
 * (and the per-keyword counts derived from them) lives here at the
 * parent level so both sub-tabs share a single fetch instead of
 * each querying /api/wisdoms separately.
 *
 * Data shared across both sub-tabs:
 *   - wisdoms      — the user's published wisdom logs
 *   - counts       — keyword_id slug → number of cards
 *   - totalWords   — sum of word counts across all wisdom texts
 *   - collectedKw  — number of unique keyword slugs (≤ 48)
 *
 * Sub-tab pattern matches Growth tab (3.9.A.2.1): pill labels with
 * a purple underline on the active tab.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CollectionView } from '@/components/assets/collection-view';
import { AssetsView } from '@/components/assets/assets-view';
import {
  fetchUserStatsWithCache,
  getCachedUserStats,
  type UserStats,
} from '@/lib/user-stats-api';
import { supabase } from '@/lib/supabase';
import type { AssetsTabSharedState } from '@/lib/assets-tab-shared';

type SubTab = 'collection' | 'assets';

function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function AssetsTab() {
  const insets = useSafeAreaInsets();
  const [subTab, setSubTab] = useState<SubTab>('collection');
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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.segHeader}>
        <Pressable onPress={() => setSubTab('collection')} style={styles.segBtn}>
          <Text
            style={[styles.segText, subTab === 'collection' && styles.segTextActive]}
          >
            Collection
          </Text>
          {subTab === 'collection' ? <View style={styles.segUnderline} /> : null}
        </Pressable>
        <Pressable onPress={() => setSubTab('assets')} style={styles.segBtn}>
          <Text
            style={[styles.segText, subTab === 'assets' && styles.segTextActive]}
          >
            Assets
          </Text>
          {subTab === 'assets' ? <View style={styles.segUnderline} /> : null}
        </Pressable>
      </View>

      {loading && !stats ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#A855F7" />
        </View>
      ) : subTab === 'collection' ? (
        <CollectionView shared={shared} />
      ) : (
        <AssetsView shared={shared} />
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
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  segBtn: {
    paddingVertical: 10,
    marginRight: 24,
    position: 'relative',
  },
  segText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 16,
    fontWeight: '700',
  },
  segTextActive: {
    color: '#C084FC',
  },
  segUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#A855F7',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
