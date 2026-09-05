import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { DateRangeCalendar } from '@/components/ui/date-range-calendar';
import { GridBackground } from '@/components/ui/grid-background';
import {
  fetchConnectionHistory,
  fetchMoreConnectionHistory,
  getCachedConnectionHistory,
  subscribeConnectionHistory,
  type ConnectionHistoryCard,
  type ConnectionHistorySection,
} from '@/lib/friends-api';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';

const TABS: { key: ConnectionHistorySection; label: string }[] = [
  { key: 'missed', label: 'What You May Have Missed' },
  { key: 'world', label: 'Their World Lately' },
  { key: 'ways_in', label: 'Ways In' },
  { key: 'between', label: 'Between You Lately' },
];

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function HistoryCard({ card }: { card: ConnectionHistoryCard }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.badge}>
          <MaterialIcons name="chat-bubble" size={16} color="#C7644F" />
          <Text style={styles.badgeText}>{card.label}</Text>
        </View>
        <Text style={styles.dateText}>{shortDate(card.date)}</Text>
      </View>
      {!!card.title && <Text style={styles.headline}>{card.title}</Text>}
      <Text style={styles.body}>{card.observation}</Text>
      {!!card.meaning && <Text style={styles.supporting}>{card.meaning}</Text>}
      {!!card.takeaway && card.section === 'between' && (
        <Text style={styles.supporting}>{card.takeaway}</Text>
      )}
      {!!card.takeaway && card.section === 'ways_in' && (
        <View style={styles.actionRow}>
          <MaterialIcons name="chat-bubble-outline" size={18} color="#8C523D" />
          <Text style={styles.actionText}>{card.takeaway}</Text>
        </View>
      )}
    </View>
  );
}

export default function ConnectionHistoryScreen() {
  const router = useRouter();
  const isPaid = useSubscriptionTier() !== 'free';
  const initialHistory = useMemo(() => getCachedConnectionHistory(), []);
  const [tab, setTab] = useState<ConnectionHistorySection>('missed');
  const [cards, setCards] = useState<ConnectionHistoryCard[]>(
    initialHistory?.ok ? initialHistory.cards : [],
  );
  const [loading, setLoading] = useState(isPaid && !initialHistory);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialHistory?.ok && initialHistory.hasMore === true);
  const [nextBeforeCreatedAt, setNextBeforeCreatedAt] = useState(
    initialHistory?.ok ? initialHistory.nextBeforeCreatedAt ?? null : null,
  );
  const [nextBeforeId, setNextBeforeId] = useState(
    initialHistory?.ok ? initialHistory.nextBeforeId ?? null : null,
  );
  const [error, setError] = useState<'network' | 'unavailable' | 'unpaired' | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [appliedStart, setAppliedStart] = useState<string | null>(null);
  const [appliedEnd, setAppliedEnd] = useState<string | null>(null);

  const applyResult = useCallback((result: Awaited<ReturnType<typeof fetchConnectionHistory>>) => {
    if (!result.ok) {
      setError('network');
    } else if (!result.paired) {
      setCards([]);
      setError('unpaired');
    } else if (result.unavailable) {
      setCards([]);
      setError('unavailable');
    } else {
      setCards(result.cards);
      setHasMore(result.hasMore === true);
      setNextBeforeCreatedAt(result.nextBeforeCreatedAt ?? null);
      setNextBeforeId(result.nextBeforeId ?? null);
      setError(null);
    }
  }, []);

  const load = useCallback(async () => {
    if (!isPaid) {
      setLoading(false);
      return;
    }
    if (!getCachedConnectionHistory()) setLoading(true);
    const result = await fetchConnectionHistory({ force: true });
    applyResult(result);
    setLoading(false);
  }, [applyResult, isPaid]);

  useEffect(() => {
    if (!isPaid) {
      setLoading(false);
      return undefined;
    }
    const cached = getCachedConnectionHistory();
    if (cached) applyResult(cached);
    const unsubscribe = subscribeConnectionHistory((result) => {
      applyResult(result);
      setLoading(false);
    });
    if (!cached) void load();
    return unsubscribe;
  }, [applyResult, isPaid, load]);

  const shown = useMemo(() => cards.filter((card) => (
    card.section === tab
    && (!appliedStart || card.date >= appliedStart)
    && (!appliedEnd || card.date <= appliedEnd)
  )), [appliedEnd, appliedStart, cards, tab]);
  const activeRangeLabel = appliedStart
    ? appliedEnd && appliedEnd !== appliedStart
      ? `${shortDate(appliedStart)} – ${shortDate(appliedEnd)}`
      : shortDate(appliedStart)
    : null;

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextBeforeCreatedAt) return;
    setLoadingMore(true);
    try {
      const result = await fetchMoreConnectionHistory({
        ok: true, paired: true, cards, hasMore,
        nextBeforeCreatedAt, nextBeforeId,
      });
      applyResult(result);
    } finally {
      setLoadingMore(false);
    }
  }, [applyResult, cards, hasMore, loadingMore, nextBeforeCreatedAt, nextBeforeId]);

  // If the current tab/date filter has no card in the loaded chunk, continue
  // paging until one appears or history is exhausted. This keeps filtering
  // correct without downloading the full archive on every open.
  useEffect(() => {
    if (isPaid && !loading && !error && shown.length === 0 && hasMore && !loadingMore) {
      void loadMore();
    }
  }, [error, hasMore, isPaid, loadMore, loading, loadingMore, shown.length]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.headerSafe} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => { void haptics.pageClose(); router.back(); }}
            style={styles.backButton}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back" size={27} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>History</Text>
            <Text style={styles.subtitle}>The little things worth remembering</Text>
          </View>
          <Pressable
            onPress={() => {
              if (!isPaid) {
                void haptics.pageOpen();
                router.push('/(main)/(modals)/subscription-paywall' as never);
                return;
              }
              void haptics.pageOpen();
              setRangeStart(appliedStart);
              setRangeEnd(appliedEnd);
              setCalendarOpen(true);
            }}
            style={styles.calendarButton}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Filter Connection History by date"
          >
            <Image source={ICONS.calendar} style={styles.calendarIcon} resizeMode="contain" />
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        <GridBackground />
        <View style={styles.tabsWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {TABS.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => { void haptics.light(); setTab(item.key); }}
                style={[styles.tab, tab === item.key && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item.key }}
              >
                <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {!isPaid ? (
          <View style={styles.center}>
            <MaterialIcons name="lock" size={48} color="#7A4A3A" />
            <Text style={styles.emptyTitle}>Keep your Connection history</Text>
            <Text style={styles.emptyText}>Join Plus to revisit the thoughtful details that appeared over time.</Text>
            <Pressable
              onPress={() => {
                void haptics.pageOpen();
                router.push('/(main)/(modals)/subscription-paywall' as never);
              }}
              style={styles.plusButton}
            >
              <Text style={styles.plusButtonText}>Join Burrow Plus</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#8C523D" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>
              {error === 'unpaired' ? 'Pair with someone first' : error === 'unavailable' ? 'History isn’t available yet' : 'Couldn’t load History'}
            </Text>
            <Text style={styles.emptyText}>
              {error === 'network' ? 'Please check your connection and try again.' : 'New Connection cards will appear here when they become available.'}
            </Text>
            {error === 'network' && (
              <Pressable onPress={() => void load()} style={styles.retryButton}>
                <Text style={styles.retryText}>Try Again</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.list, shown.length === 0 && styles.emptyList]}
            scrollEventThrottle={160}
            onScroll={({ nativeEvent }) => {
              const remaining = nativeEvent.contentSize.height
                - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
              if (remaining < 180) void loadMore();
            }}
          >
            {!!activeRangeLabel && (
              <View style={styles.rangePill}>
                <MaterialIcons name="date-range" size={17} color="#7A4A3A" />
                <Text style={styles.rangeText}>{activeRangeLabel}</Text>
                <Pressable
                  onPress={() => {
                    void haptics.light();
                    setRangeStart(null);
                    setRangeEnd(null);
                    setAppliedStart(null);
                    setAppliedEnd(null);
                  }}
                  hitSlop={8}
                >
                  <MaterialIcons name="close" size={18} color="#7A4A3A" />
                </Pressable>
              </View>
            )}
            {shown.length > 0 ? shown.map((card) => (
              <HistoryCard key={card.id} card={card} />
            )) : (
              <View style={styles.centerInScroll}>
                <Text style={styles.emptyTitle}>Nothing here yet</Text>
                <Text style={styles.emptyText}>
                  {activeRangeLabel
                    ? 'No cards were generated in this date range.'
                    : 'New cards in this section will be saved here automatically.'}
                </Text>
              </View>
            )}
            {loadingMore && <ActivityIndicator style={{ marginVertical: 16 }} color="#8C523D" />}
          </ScrollView>
        )}
      </View>

      <DateRangeCalendar
        visible={calendarOpen}
        start={rangeStart}
        end={rangeEnd}
        onChange={(start, end) => { setRangeStart(start); setRangeEnd(end); }}
        onClose={() => setCalendarOpen(false)}
        onDone={(start, end) => {
          setAppliedStart(start);
          setAppliedEnd(end);
        }}
        doneLabel="Show history"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7A4A3A' },
  headerSafe: { backgroundColor: '#7A4A3A' },
  header: {
    minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#7A4A3A',
  },
  backButton: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  subtitle: { marginTop: 2, fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.9)' },
  calendarButton: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  calendarIcon: { width: 44, height: 44 },
  content: { flex: 1, backgroundColor: '#F8D9B8' },
  tabsWrap: { paddingVertical: 18 },
  tabs: { gap: 14, paddingHorizontal: 18 },
  tab: {
    minWidth: 220, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14,
    alignItems: 'center', backgroundColor: 'rgba(140,82,61,0.72)',
  },
  tabActive: { backgroundColor: '#8C523D' },
  tabText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.78)' },
  tabTextActive: { color: '#FFFFFF' },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  emptyList: { flexGrow: 1 },
  card: { borderRadius: 24, padding: 22, backgroundColor: '#FFF8EA' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 14,
    backgroundColor: '#F8DB8B', paddingHorizontal: 12, paddingVertical: 8, maxWidth: '78%',
  },
  badgeText: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#7B4A24' },
  dateText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#4B382A' },
  headline: { marginTop: 18, fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2F2118' },
  body: { marginTop: 16, fontSize: 17, lineHeight: 25, fontFamily: 'Inter_500Medium', color: '#251B15' },
  supporting: { marginTop: 10, fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_500Medium', color: '#765C48' },
  actionRow: { marginTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  actionText: { flex: 1, fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_600SemiBold', color: '#7A4A3A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 14 },
  centerInScroll: { flex: 1, minHeight: 330, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#4C331B', textAlign: 'center' },
  emptyText: { fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_500Medium', color: '#806853', textAlign: 'center' },
  plusButton: { marginTop: 10, borderRadius: 20, backgroundColor: '#8C523D', paddingHorizontal: 28, paddingVertical: 15 },
  plusButtonText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  retryButton: { marginTop: 6, borderRadius: 18, backgroundColor: '#8C523D', paddingHorizontal: 24, paddingVertical: 13 },
  retryText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  rangePill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FFF8EA',
  },
  rangeText: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#7A4A3A' },
});
