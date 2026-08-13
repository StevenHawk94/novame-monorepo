import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { ItemSprite } from '@/components/ui/item-sprite';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import {
  fetchTheirPatterns,
  getCachedTheirPatterns,
  shouldRefreshTheirPatterns,
  type PatternDimension,
  type PatternScorePeriod,
  type TheirPatterns,
} from '@/lib/patterns-api';

type PageTab = 'week' | 'trends';
type DimensionKey = PatternDimension['key'];

const DIMENSION_META: Record<DimensionKey, { emoji: string; color: string; line: string }> = {
  mood: { emoji: '🌤️', color: '#F9DFA7', line: '#D59434' },
  energy: { emoji: '⚡', color: '#F8CFAE', line: '#D97845' },
  stress: { emoji: '🌊', color: '#CFE3EA', line: '#548CA0' },
  openness: { emoji: '💬', color: '#E5D4EF', line: '#9066A7' },
  connection: { emoji: '🤝', color: '#F5D1D8', line: '#BE6677' },
  enjoyment: { emoji: '✨', color: '#DDE8BD', line: '#789747' },
};

function trendIcon(trend: string): keyof typeof MaterialIcons.glyphMap {
  if (trend.endsWith('_up')) return 'trending-up';
  if (trend.endsWith('_down')) return 'trending-down';
  if (trend === 'same') return 'trending-flat';
  return 'more-horiz';
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function periodLabel(period: Pick<PatternScorePeriod, 'startDate' | 'endDate'>): string {
  return `${shortDate(period.startDate)} – ${shortDate(period.endDate)}`;
}

function ScoreChart({ periods, dimension }: { periods: PatternScorePeriod[]; dimension: DimensionKey }) {
  const width = 300;
  const height = 96;
  const padX = 10;
  const padY = 10;
  const values = periods.map((period) => period.scores[dimension]);
  const available = values
    .map((score, index) => ({ score, index }))
    .filter((point): point is { score: number; index: number } => point.score != null);
  const x = (index: number) => periods.length <= 1
    ? width / 2
    : padX + index * ((width - padX * 2) / (periods.length - 1));
  const y = (score: number) => padY + (5 - score) * ((height - padY * 2) / 4);
  const points = available.map((point) => `${x(point.index)},${y(point.score)}`).join(' ');
  const lineColor = DIMENSION_META[dimension].line;

  if (available.length === 0) {
    return <View style={styles.noChart}><Text style={styles.noChartText}>Not enough data to show a score yet.</Text></View>;
  }

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {[1, 3, 5].map((score) => (
          <Line key={score} x1={padX} x2={width - padX} y1={y(score)} y2={y(score)} stroke="#E8D7C9" strokeWidth="1" />
        ))}
        {available.length > 1 ? <Polyline points={points} fill="none" stroke={lineColor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {available.map((point) => (
          <Circle key={point.index} cx={x(point.index)} cy={y(point.score)} r="4" fill={lineColor} stroke="#FFF9F0" strokeWidth="2" />
        ))}
      </Svg>
      <View style={styles.chartDates}>
        <Text style={styles.chartDate}>{periods[0] ? shortDate(periods[0].startDate) : ''}</Text>
        <Text style={styles.chartDate}>{periods.at(-1) ? shortDate(periods.at(-1)!.endDate) : ''}</Text>
      </View>
    </View>
  );
}

export default function TheirPatternsScreen() {
  const router = useRouter();
  const cachedAtMount = getCachedTheirPatterns();
  const [tab, setTab] = useState<PageTab>('week');
  const [data, setData] = useState<TheirPatterns | null>(cachedAtMount);
  const [loading, setLoading] = useState(cachedAtMount == null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!shouldRefreshTheirPatterns() || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!getCachedTheirPatterns()) setLoading(true);
    try {
      setData(await fetchTheirPatterns(7));
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

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
  const showEmptyState = !data || data.state === 'unpaired' || data.state === 'unavailable';
  const history = data?.history ?? [];
  const trendPeriods = data?.currentScores ? [...history, data.currentScores] : history;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.headerSafe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={10}>
            <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Their Patterns</Text>
            <Text style={styles.subtitle}>Changes across their recent moments</Text>
          </View>
          <Pressable onPress={() => { void haptics.light(); setHistoryOpen(true); }} style={styles.calendarButton} hitSlop={10}>
            <Image source={ICONS.patternCalendar} style={styles.calendarIcon} resizeMode="contain" />
          </Pressable>
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.content} edges={['bottom']}>
        <View style={styles.tabStrip}>
          {([['week', 'This Week'], ['trends', 'Score Trends']] as const).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => { void haptics.light(); setTab(key); }}
              style={[styles.tab, tab === key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color="#7A4A3A" /></View>
        ) : showEmptyState ? (
          <View style={styles.center}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyTitle}>Patterns take a little time</Text>
            <Text style={styles.emptyText}>{emptyCopy}</Text>
          </View>
        ) : tab === 'week' && data ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryEyebrow}>CURRENT 7-DAY SUMMARY</Text>
              <Text style={styles.summaryText}>{data.summary}</Text>
              <Text style={styles.summaryFoot}>
                {data.currentStart && data.currentEnd ? periodLabel({ startDate: data.currentStart, endDate: data.currentEnd }) : 'Most recent 7 days'}
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
                  <View style={[styles.dimensionIcon, { backgroundColor: meta.color }]}><Text style={styles.dimensionEmoji}>{meta.emoji}</Text></View>
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
                        <Text style={styles.evidenceText}>Based on {dimension.evidenceCount} visible {dimension.evidenceCount === 1 ? 'moment' : 'moments'} across {dimension.dayCount} {dimension.dayCount === 1 ? 'day' : 'days'} in this period.</Text>
                        {dimension.themes.length > 0 ? (
                          <View style={styles.themeRow}>{dimension.themes.map((theme) => <View key={theme.topic} style={styles.themeChip}><Text style={styles.themeText}>{theme.topic} · {theme.count}</Text></View>)}</View>
                        ) : null}
                        {dimension.related.length > 0 ? (
                          <View style={styles.relatedSection}>
                            <Text style={styles.relatedTitle}>Related Moments</Text>
                            {dimension.related.map((moment, index) => (
                              <View key={moment.id} style={styles.momentRow}>
                                {moment.itemId ? <ItemSprite itemId={moment.itemId} size={48} radius={12} /> : <View style={styles.momentFallback}><Text>✦</Text></View>}
                                <View style={styles.momentCopy}>
                                  <Text style={styles.momentDate}>{shortDate(moment.date)}</Text>
                                  <Text style={styles.momentText} numberOfLines={2}>{moment.excerpt}</Text>
                                </View>
                                {moment.reflectId && moment.itemId ? <Pressable onPress={() => openMoment(dimension, index)} style={styles.viewButton}><Text style={styles.viewButtonText}>View</Text></Pressable> : null}
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
        ) : data ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.trendIntro}>
              <Text style={styles.trendIntroTitle}>How their patterns change</Text>
              <Text style={styles.trendIntroText}>Weekly scores range from 1 to 5 and only use moments they chose to share.</Text>
            </View>
            {data.dimensions.map((dimension) => (
              <View key={dimension.key} style={styles.chartCard}>
                <View style={styles.chartHeader}>
                  <View style={[styles.chartIcon, { backgroundColor: DIMENSION_META[dimension.key].color }]}><Text>{DIMENSION_META[dimension.key].emoji}</Text></View>
                  <Text style={styles.chartTitle}>{dimension.label}</Text>
                  <Text style={styles.chartScore}>{data.currentScores?.scores[dimension.key]?.toFixed(1) ?? '—'}</Text>
                </View>
                <ScoreChart periods={trendPeriods} dimension={dimension.key} />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </SafeAreaView>

      <Modal visible={historyOpen} transparent animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView style={styles.historySheet} edges={['bottom']}>
            <View style={styles.historyHeader}>
              <View><Text style={styles.historyTitle}>Pattern History</Text><Text style={styles.historySubtitle}>Completed weeks with visible records</Text></View>
              <Pressable onPress={() => setHistoryOpen(false)} style={styles.modalClose}><MaterialIcons name="close" size={23} color="#FFFFFF" /></Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.historyList}>
              {history.length === 0 ? (
                <View style={styles.historyEmpty}><Text style={styles.emptyEmoji}>📅</Text><Text style={styles.emptyTitle}>No weekly history yet</Text><Text style={styles.emptyText}>A week appears here only when it contains shared moments.</Text></View>
              ) : [...history].reverse().map((period) => {
                const key = `${period.startDate}:${period.endDate}`;
                const open = historyExpanded === key;
                return (
                  <Pressable key={key} onPress={() => setHistoryExpanded(open ? null : key)} style={styles.historyRow}>
                    <View style={styles.historyRowTop}>
                      <View><Text style={styles.historyPeriod}>{periodLabel(period)}</Text><Text style={styles.historyEvidence}>{period.evidenceCount} visible {period.evidenceCount === 1 ? 'moment' : 'moments'}</Text></View>
                      <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={24} color="#7A4A3A" />
                    </View>
                    {open ? <View style={styles.historyScores}>{(Object.keys(DIMENSION_META) as DimensionKey[]).map((dimension) => <View key={dimension} style={styles.historyScore}><Text style={styles.historyScoreLabel}>{DIMENSION_META[dimension].emoji} {dimension[0].toUpperCase() + dimension.slice(1)}</Text><Text style={styles.historyScoreValue}>{period.scores[dimension]?.toFixed(1) ?? '—'}</Text></View>)}</View> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7A4A3A' },
  headerSafe: { backgroundColor: '#7A4A3A' },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#7A4A3A', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  headerButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  calendarButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  calendarIcon: { width: 36, height: 36 },
  headerCopy: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 24, fontFamily: 'Inter_800ExtraBold' },
  subtitle: { color: 'rgba(255,255,255,0.84)', fontSize: 12.5, fontFamily: 'Inter_500Medium', marginTop: 2 },
  content: { flex: 1, backgroundColor: '#FDF1E8' },
  tabStrip: { flexDirection: 'row', margin: 16, padding: 5, borderRadius: 24, backgroundColor: '#FFF9ED', borderWidth: 1.5, borderColor: '#5B3B27' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 18 },
  tabActive: { backgroundColor: '#503524' },
  tabText: { color: '#87674F', fontSize: 13, fontFamily: 'Inter_700Bold' },
  tabTextActive: { color: '#FFFFFF' },
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
  trendIntro: { backgroundColor: '#FFF9F0', borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E9CBB8' },
  trendIntroTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#3F2D20' },
  trendIntroText: { marginTop: 5, fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium', color: '#765E4B' },
  chartCard: { backgroundColor: '#FFF9F0', borderRadius: 20, padding: 14, marginBottom: 11, borderWidth: 1, borderColor: '#E9CBB8' },
  chartHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  chartIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  chartTitle: { flex: 1, fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#30231A' },
  chartScore: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#7A4A3A' },
  noChart: { height: 96, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: '#E8D7C9' },
  noChartText: { fontSize: 12.5, fontFamily: 'Inter_500Medium', color: '#987C67' },
  chartDates: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, marginTop: -2 },
  chartDate: { fontSize: 10.5, fontFamily: 'Inter_600SemiBold', color: '#9A806C' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(35,22,15,0.56)', justifyContent: 'flex-end' },
  historySheet: { maxHeight: '82%', backgroundColor: '#FDF1E8', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#7A4A3A', padding: 20 },
  historyTitle: { color: '#FFFFFF', fontSize: 22, fontFamily: 'Inter_800ExtraBold' },
  historySubtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 3 },
  modalClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  historyList: { padding: 16, paddingBottom: 28 },
  historyEmpty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 54 },
  historyRow: { backgroundColor: '#FFF9F0', borderRadius: 18, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#E9CBB8' },
  historyRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyPeriod: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#3F2D20' },
  historyEvidence: { marginTop: 3, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#8B735F' },
  historyScores: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#E9D8CB' },
  historyScore: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F5E6D8', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 7 },
  historyScoreLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#674C38' },
  historyScoreValue: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#7A4A3A' },
});
