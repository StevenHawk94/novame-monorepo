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

import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import {
  fetchWisdomCenter,
  type WisdomCenterData,
} from '@/lib/wisdom-center-api';
import { ScoreGauge } from '@/components/growth/score-gauge';
import { AvatarRow } from '@/components/growth/avatar-row';

/**
 * Growth Center overlay -- Stage 3.10.3 A.
 *
 * 4 sections (legacy capacitor WeeklyInsightOverlay default 'center' view):
 *   1. Your Wisdom Portrait -- italic AI-generated description.
 *   2. Better Self Match    -- big half-circle gauge (ScoreGauge).
 *   3. Ideal Self Progress  -- 2-column grid of aspireWord progress bars.
 *   4. Community Resonance  -- big number + AvatarRow + descriptor copy.
 *
 * Entry: Me page Better Self Match card "Details" -> /growth-center.
 *
 * Data: single GET /api/wisdom-center on mount, no cache. Refresh
 * happens automatically when the user closes + re-opens (low frequency,
 * acceptable cost).
 */

function getProgressColor(score: number): string {
  if (score >= 80) return '#22C55E';
  if (score >= 60) return '#EAB308';
  return '#EF4444';
}

export default function GrowthCenterModal() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<WisdomCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: sess }) => {
      if (cancelled) return;
      setUserId(sess.session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stage 6: useFocusEffect (not useEffect) so that returning from the
  // edit-aspire-words modal re-fetches the latest aspireWords +
  // recomputed better_self_score. Without focus-based re-fetch, the
  // page would show stale data after editing.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let cancelled = false;
      (async () => {
        setLoading(true);
        const res = await fetchWisdomCenter(userId);
        if (cancelled) return;
        if (res.kind === 'success') {
          setData(res.data);
          setError(null);
        } else {
          setError(res.message);
        }
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const handleEditAspireWords = () => {
    if (!data) return;
    void haptics.light();
    router.push({
      pathname: '/edit-aspire-words',
      params: { initial: JSON.stringify(data.aspireWords) },
    });
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
          <MaterialIcons name="close" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>Growth Center</Text>
        <Pressable
          onPress={handleEditAspireWords}
          style={styles.closeBtn}
          hitSlop={8}
          disabled={!data}
        >
          <MaterialIcons name="edit" size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerFlex}>
          <ActivityIndicator color="#A855F7" size="large" />
        </View>
      ) : error ? (
        <View style={styles.centerFlex}>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : !data ? (
        <View style={styles.centerFlex}>
          <Text style={styles.emptyText}>No data</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* 1. NovaMe Journey -- Stage 6: replaces AI-generated Wisdom Portrait
              with a fixed copy. Server still has wisdom_portrait column +
              data for rollback, but UI no longer reads it. */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialIcons name="auto-awesome" size={20} color="#A78BFA" />
              <Text style={styles.cardTitle}>NovaMe Journey</Text>
            </View>
            <Text style={styles.journeyText}>
              Your growth score reflects every entry and completed task. Stay consistent with your daily logs, complete your tasks, and become the best version of yourself!
            </Text>
          </View>

          {/* 2. Better Self Match */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialIcons name="star" size={20} color="#FBBF24" />
              <Text style={styles.cardTitle}>Better Self Match</Text>
            </View>
            <View style={styles.gaugeWrap}>
              <ScoreGauge score={data.betterSelfScore} />
            </View>
          </View>

          {/* 3. Ideal Self Progress */}
          {data.aspireWords.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialIcons name="trending-up" size={20} color="#4ADE80" />
                <Text style={styles.cardTitle}>Ideal Self Progress</Text>
              </View>
              <View style={styles.aspireGrid}>
                {data.aspireWords.map((word) => {
                  const sc = data.aspireScores[word] ?? 70;
                  const color = getProgressColor(sc);
                  return (
                    <View key={word} style={styles.aspireCell}>
                      <View style={styles.aspireRow}>
                        <Text style={styles.aspireWord} numberOfLines={1}>
                          {word}
                        </Text>
                        <Text style={[styles.aspireScore, { color }]}>
                          {sc}
                        </Text>
                      </View>
                      <View style={styles.aspireBarBg}>
                        <View
                          style={[
                            styles.aspireBarFg,
                            {
                              width: `${Math.min(100, Math.max(0, sc))}%`,
                              backgroundColor: color,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* 4. Community Resonance */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialIcons name="favorite" size={20} color="#F472B6" />
              <Text style={styles.cardTitle}>Community Resonance</Text>
            </View>
            <View style={styles.resonanceRow}>
              <Text style={styles.resonanceNumber}>
                {data.communityResonance.toLocaleString()}+
              </Text>
              <AvatarRow avatars={data.defaultAvatars} />
            </View>
            <Text style={styles.resonanceDesc}>
              people are working toward the same goals as you. Keep going!
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  centerFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  scroll: {
    paddingHorizontal: 20,
  },
  // Cards
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  // 1. Journey (Stage 6: replaces portraitText)
  journeyText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 22,
  },
  // 2. Gauge
  gaugeWrap: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  // 3. Aspire grid
  aspireGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  aspireCell: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 12,
  },
  aspireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  aspireWord: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
    paddingRight: 8,
  },
  aspireScore: {
    fontSize: 12,
    fontWeight: '700',
  },
  aspireBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  aspireBarFg: {
    height: '100%',
    borderRadius: 3,
  },
  // 4. Resonance
  resonanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
  },
  resonanceNumber: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
  },
  resonanceDesc: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    marginTop: 4,
  },
});
