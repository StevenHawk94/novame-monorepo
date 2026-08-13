import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { ItemSprite } from '@/components/ui/item-sprite';
import { haptics } from '@/lib/haptics';
import {
  fetchTheirPatterns,
  type PatternDimension,
  type PatternRange,
  type TheirPatterns,
} from '@/lib/patterns-api';

const RANGES: { days: PatternRange; label: string }[] = [
  { days: 7, label: '7 Days' },
  { days: 30, label: '30 Days' },
  { days: 90, label: '3 Months' },
];

const DIMENSION_META: Record<string, { emoji: string; color: string }> = {
  mood: { emoji: '🌤️', color: '#F9DFA7' },
  energy: { emoji: '⚡', color: '#F8CFAE' },
  stress: { emoji: '🌊', color: '#CFE3EA' },
  openness: { emoji: '💬', color: '#E5D4EF' },
  connection: { emoji: '🤝', color: '#F5D1D8' },
  enjoyment: { emoji: '✨', color: '#DDE8BD' },
};

function trendIcon(trend: string): keyof typeof MaterialIcons.glyphMap {
  if (trend.endsWith('_up')) return 'trending-up';
  if (trend.endsWith('_down')) return 'trending-down';
  if (trend === 'same') return 'trending-flat';
  return 'more-horiz';
}

export default function TheirPatternsScreen() {
  const router = useRouter();
  const [range, setRange] = useState<PatternRange>(30);
  const [data, setData] = useState<TheirPatterns | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const appliedRecommendation = useRef(false);

  const load = useCallback(async (days: PatternRange) => {
    setLoading(true);
    const result = await fetchTheirPatterns(days);
    if (
      !appliedRecommendation.current &&
      result?.recommendedDays &&
      result.recommendedDays !== days
    ) {
      appliedRecommendation.current = true;
      setRange(result.recommendedDays);
      return;
    }
    setData(result);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(range); }, [load, range]));
  useEffect(() => setExpanded(null), [range]);

  function openMoment(dimension: PatternDimension, index: number) {
    const moment = dimension.related[index];
    if (!moment?.reflectId) return;
    void haptics.light();
    router.push({
      pathname: '/(main)/friend-reflect-detail',
      params: {
        friendName: data?.partnerName || 'They',
        friendUserId: data?.partnerUserId || '',
        createdAt: `${moment.date}T12:00:00Z`,
        detailsJson: JSON.stringify([{ itemId: moment.itemId || '', text: moment.excerpt }]),
      },
    });
  }

  const emptyCopy = data?.state === 'unpaired'
    ? 'Connect with someone first to begin seeing their patterns.'
    : data?.state === 'unavailable'
      ? "Their patterns aren't available right now."
      : "There aren't enough moments to show a pattern yet.";

  const showEmptyState = !data ||
    data.state === 'unpaired' ||
    data.state === 'unavailable';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Their Patterns</Text>
          <Text style={styles.subtitle}>Changes across their recent moments</Text>
        </View>
      </View>

      <View style={styles.rangeStrip}>
        {RANGES.map((option) => {
          const active = range === option.days;
          return (
            <Pressable
              key={option.days}
              onPress={() => { void haptics.light(); setRange(option.days); }}
              style={[styles.range, active && styles.rangeActive]}
            >
              <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#7A4A3A" /></View>
      ) : showEmptyState ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🌱</Text>
          <Text style={styles.emptyTitle}>Patterns take a little time</Text>
          <Text style={styles.emptyText}>{emptyCopy}</Text>
        </View>
      ) : data ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEyebrow}>OVERALL SUMMARY</Text>
            <Text style={styles.summaryText}>{data.summary}</Text>
            <Text style={styles.summaryFoot}>
              {data.state === 'building_baseline' || data.state === 'no_moments'
                ? 'Patterns will become clearer as more moments are recorded.'
                : `Compared with the previous ${range === 90 ? '3 months' : `${range} days`}.`}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Six Dimensions</Text>
          {data.dimensions.map((dimension) => {
            const meta = DIMENSION_META[dimension.key];
            const open = expanded === dimension.key;
            return (
              <Pressable
                key={dimension.key}
                onPress={() => { void haptics.light(); setExpanded(open ? null : dimension.key); }}
                style={styles.dimensionCard}
              >
                <View style={[styles.dimensionIcon, { backgroundColor: meta.color }]}>
                  <Text style={styles.dimensionEmoji}>{meta.emoji}</Text>
                </View>
                <View style={styles.dimensionBody}>
                  <View style={styles.dimensionTop}>
                    <Text style={styles.dimensionName}>{dimension.label}</Text>
                    <View style={styles.trendPill}>
                      <MaterialIcons name={trendIcon(dimension.trend)} size={17} color="#69452F" />
                      <Text style={styles.trendText}>{dimension.trendLabel}</Text>
                    </View>
                  </View>
                  <Text style={styles.dimensionSummary}>{dimension.summary}</Text>

                  {open ? (
                    <View style={styles.detail}>
                      <Text style={styles.evidenceText}>
                        Based on {dimension.evidenceCount} visible {dimension.evidenceCount === 1 ? 'moment' : 'moments'} across {dimension.dayCount} {dimension.dayCount === 1 ? 'day' : 'days'} in this period.
                      </Text>
                      {dimension.themes.length > 0 ? (
                        <View style={styles.themeRow}>
                          {dimension.themes.map((theme) => (
                            <View key={theme.topic} style={styles.themeChip}>
                              <Text style={styles.themeText}>{theme.topic} · {theme.count}</Text>
                            </View>
                          ))}
                        </View>
                      ) : dimension.trend !== 'same' && dimension.trend !== 'current_only' && dimension.trend !== 'insufficient' ? (
                        <Text style={styles.noTheme}>There isn't a clear theme behind this change yet.</Text>
                      ) : null}

                      {dimension.related.length > 0 ? (
                        <View style={styles.relatedSection}>
                          <Text style={styles.relatedTitle}>Related Moments</Text>
                          {dimension.related.map((moment, index) => (
                            <View key={moment.id} style={styles.momentRow}>
                              {moment.itemId ? (
                                <ItemSprite itemId={moment.itemId} size={48} radius={12} />
                              ) : (
                                <View style={styles.momentFallback}><Text>✦</Text></View>
                              )}
                              <View style={styles.momentCopy}>
                                <Text style={styles.momentDate}>{new Date(`${moment.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                                <Text style={styles.momentText} numberOfLines={2}>{moment.excerpt}</Text>
                              </View>
                              {moment.reflectId && moment.itemId ? (
                                <Pressable onPress={() => openMoment(dimension, index)} style={styles.viewButton}>
                                  <Text style={styles.viewButtonText}>View</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={22} color="#8A6240" />
              </Pressable>
            );
          })}
          <Text style={styles.privacyNote}>Only moments they’ve chosen to share can shape these patterns.</Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FDF1E8' },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#7A4A3A', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 24, fontFamily: 'Inter_800ExtraBold' },
  subtitle: { color: 'rgba(255,255,255,0.84)', fontSize: 12.5, fontFamily: 'Inter_500Medium', marginTop: 2 },
  rangeStrip: { flexDirection: 'row', margin: 16, padding: 5, borderRadius: 24, backgroundColor: '#FFF9ED', borderWidth: 1.5, borderColor: '#5B3B27' },
  range: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 18 },
  rangeActive: { backgroundColor: '#503524' },
  rangeText: { color: '#87674F', fontSize: 13, fontFamily: 'Inter_700Bold' },
  rangeTextActive: { color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 42, paddingBottom: 70 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#3F2D20', textAlign: 'center' },
  emptyText: { marginTop: 8, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_500Medium', color: '#8B735F', textAlign: 'center' },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  summaryCard: { backgroundColor: '#7A4A3A', borderRadius: 24, padding: 20, marginBottom: 22 },
  summaryEyebrow: { color: '#F5CDA8', fontSize: 11, letterSpacing: 1.2, fontFamily: 'Inter_800ExtraBold', marginBottom: 10 },
  summaryText: { color: '#FFFFFF', fontSize: 20, lineHeight: 28, fontFamily: 'Inter_700Bold' },
  summaryFoot: { color: 'rgba(255,255,255,0.72)', fontSize: 12.5, fontFamily: 'Inter_500Medium', marginTop: 12 },
  sectionTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#3F2D20', marginBottom: 10, paddingHorizontal: 2 },
  dimensionCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FFF9F0', borderRadius: 20, padding: 14, marginBottom: 11, borderWidth: 1, borderColor: '#E9CBB8' },
  dimensionIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  dimensionEmoji: { fontSize: 23 },
  dimensionBody: { flex: 1 },
  dimensionTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  dimensionName: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#30231A' },
  trendPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F3E2D2', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  trendText: { fontSize: 11.5, fontFamily: 'Inter_700Bold', color: '#69452F' },
  dimensionSummary: { marginTop: 7, fontSize: 13.5, lineHeight: 20, fontFamily: 'Inter_500Medium', color: '#6F5A48' },
  detail: { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#E9D8CB' },
  evidenceText: { fontSize: 12.5, lineHeight: 19, fontFamily: 'Inter_600SemiBold', color: '#765E4B' },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  themeChip: { backgroundColor: '#F5D9BE', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  themeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#67432C' },
  noTheme: { marginTop: 9, fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_500Medium', color: '#8B735F', fontStyle: 'italic' },
  relatedSection: { marginTop: 15, gap: 8 },
  relatedTitle: { fontSize: 13.5, fontFamily: 'Inter_800ExtraBold', color: '#3F2D20' },
  momentRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderRadius: 15, padding: 9 },
  momentFallback: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#F0E8DE', alignItems: 'center', justifyContent: 'center' },
  momentCopy: { flex: 1 },
  momentDate: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#99775D' },
  momentText: { marginTop: 2, fontSize: 12.5, lineHeight: 17, fontFamily: 'Inter_500Medium', color: '#403027' },
  viewButton: { backgroundColor: '#60412E', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 },
  viewButtonText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: 'Inter_700Bold' },
  privacyNote: { textAlign: 'center', color: '#987C67', fontSize: 11.5, lineHeight: 17, fontFamily: 'Inter_500Medium', paddingHorizontal: 24, marginTop: 8 },
});
