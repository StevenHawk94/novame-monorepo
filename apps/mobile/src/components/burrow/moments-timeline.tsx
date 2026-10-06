import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Image } from './burrow-image';
import { Feather } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { fetchBurrowHistory, historyDayLabel, mergeHistory, type HistoryPage, type HistoryRow } from '@/lib/burrow-history';
import { momentDescription, momentKind, momentLocalDate } from '@/lib/burrow-moments-model';
import { BURROW_MOMENT_ICONS } from '@/lib/burrow-ui-assets';
import { ITEM_IMAGES } from '@/lib/item-images.g';
import { sessionEpoch } from '@/lib/session-lifecycle';

type Filter = 'all' | 'you' | 'partner';
type EventRow = Extract<HistoryRow, { event_type: string }>;
let cachedPage: { epoch: number; scope: string; page: HistoryPage } | null = null;

function timeLabel(value: string, timezone: string) {
  try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value)); }
  catch { return ''; }
}

function destination(row: EventRow): Href | null {
  switch (momentKind(row)) {
    case 'journal': case 'letter': case 'log-day': case 'rage':
      return { pathname: '/(main)/moment-detail', params: { id: row.id } } as Href;
    case 'game': return row.reference_type === 'game_session' && row.reference_id
      ? { pathname: '/(main)/game-room', params: { sessionId: row.reference_id } } as Href
      : '/(main)/game-room' as Href;
    default: return null;
  }
}

function CoupleMark() {
  return <View pointerEvents="none" style={styles.coupleMark}>
    <View style={[styles.personHead, { left: 8 }]} /><View style={[styles.personHead, { right: 8 }]} />
    <View style={[styles.personBody, { left: 2 }]} /><View style={[styles.personBody, { right: 2 }]} />
    <Text style={styles.markHeart}>♥</Text>
  </View>;
}

function MomentCard({ row, data, timezone }: { row: EventRow; data: MajorUpdateBootstrap; timezone: string }) {
  const kind = momentKind(row)!;
  const me = row.actor_id === data.profile.id;
  const name = me ? 'You' : data.partner?.display_name?.trim() || 'Your person';
  const avatar = me ? data.profile.avatar_url : data.partner?.avatar_url;
  const link = destination(row);
  const excerpt = kind === 'log-day' && row.record?.body ? row.record.body : null;
  const items = kind === 'log-day' ? row.record?.items.slice(0, 6) ?? [] : [];
  return <View style={styles.momentRow}>
    <Image source={BURROW_MOMENT_ICONS[kind]} contentFit="contain" style={styles.eventIcon} accessibilityLabel={`${kind} icon`} />
    <Pressable accessibilityRole={link ? 'button' : undefined} accessibilityLabel={momentDescription(row, data.profile.id, data.partner?.display_name?.trim() || 'Your person')}
      disabled={!link} onPress={() => { if (link) router.push(link); }} style={({ pressed }) => [styles.eventCard, pressed && styles.pressed]}>
      <Text style={styles.time}>{timeLabel(row.created_at, timezone).toUpperCase()}</Text>
      <View style={styles.eventBody}>
        <View style={styles.avatar}>{avatar ? <Image source={{ uri: avatar }} cachePolicy="memory-disk" contentFit="cover" style={styles.avatarImage} />
          : <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>}</View>
        <View style={styles.eventTextColumn}>
          {kind === 'log-day' && excerpt ? <><Text style={styles.eyebrow}>TAP YOUR DAY</Text><Text numberOfLines={3} style={styles.description}>{excerpt}</Text></>
            : <Text style={styles.description}>{momentDescription(row, data.profile.id, data.partner?.display_name?.trim() || 'Your person')}</Text>}
        </View>
        {link && kind !== 'log-day' && <Feather name="chevron-right" size={25} color="#9A8171" />}
      </View>
      {items.length > 0 && <View style={styles.items}>{items.map(item => <View key={item.itemId} style={styles.item}>
        {ITEM_IMAGES[item.itemId] ? <Image source={ITEM_IMAGES[item.itemId]} contentFit="contain" style={styles.itemImage} />
          : <Text style={styles.itemFallback}>✦</Text>}
      </View>)}</View>}
    </Pressable>
  </View>;
}

/** Only persisted completion events enter this timeline; opening an activity never does. */
export function MomentsTimeline({ data }: { data: MajorUpdateBootstrap }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const scope = `${data.profile.id}:${data.partner?.id ?? 'solo'}:${data.pairVersion ?? ''}`;
  const [filter, setFilter] = useState<Filter>('all');
  const [pageState, setPageState] = useState<{ scope: string; page: HistoryPage } | null>(() => {
    if (cachedPage?.epoch !== sessionEpoch()) cachedPage = null;
    return cachedPage?.scope === scope ? cachedPage : null;
  });
  const [loading, setLoading] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const timezone = pageState?.scope === scope ? pageState.page.timezone : data.profile.timezone_name || 'UTC';
  const page = pageState?.scope === scope ? pageState.page : null;
  const bootstrapRows = useMemo<HistoryRow[]>(() => data.moments.map(row => ({ ...row,
    localDate: momentLocalDate(row.created_at, data.profile.timezone_name || 'UTC'),
  })), [data.moments, data.profile.timezone_name]);

  const load = useCallback(async (more: boolean, manual = false) => {
    const token = ++generation.current;
    const epoch = sessionEpoch();
    setLoading(true); setError(false);
    if (manual) setManualRefreshing(true);
    try {
      const result = await fetchBurrowHistory('moments', data.partner?.id, more ? page?.next ?? null : null, '');
      if (token !== generation.current || epoch !== sessionEpoch()) return;
      setPageState(previous => {
        const next = { scope, page: { ...result,
          rows: more ? mergeHistory(previous?.scope === scope ? previous.page.rows : [], result.rows) : result.rows,
        } };
        cachedPage = { ...next, epoch };
        return next;
      });
    } catch { if (token === generation.current) setError(true); }
    finally { if (token === generation.current) { setLoading(false); setManualRefreshing(false); } }
  }, [data.partner?.id, page?.next?.at, page?.next?.id, scope]);

  useEffect(() => {
    if (focused) void load(false);
    return () => { generation.current++; };
    // Focus refreshes silently; cached history and bootstrap events paint first.
  }, [focused, scope, refresh]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setRefresh(value => value + 1); });
    return () => subscription.remove();
  }, []);

  const rows = useMemo(() => page ? mergeHistory(bootstrapRows, page.rows) : bootstrapRows, [bootstrapRows, page]);
  const gameSessions = new Set<string>();
  const visible = rows.filter((row): row is EventRow => {
    if (!('event_type' in row) || !momentKind(row)) return false;
    if (filter !== 'all' && (row.actor_id === data.profile.id) !== (filter === 'you')) return false;
    // Completion creates one row per player so personal filters work; the
    // shared All timeline should show the game itself only once.
    if (filter === 'all' && row.event_type === 'game_played' && row.reference_id) {
      if (gameSessions.has(row.reference_id)) return false;
      gameSessions.add(row.reference_id);
    }
    return true;
  });
  const groups: { day: string; rows: EventRow[] }[] = [];
  for (const row of visible) {
    const last = groups[groups.length - 1];
    if (last?.day === row.localDate) last.rows.push(row);
    else groups.push({ day: row.localDate, rows: [row] });
  }

  return <View style={styles.root}>
    <Image source={BURROW_BACKGROUNDS.common} contentFit="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
    <View style={[StyleSheet.absoluteFillObject, styles.tint]} pointerEvents="none" />
    <SectionList<EventRow, { day: string; data: EventRow[] }> style={styles.scroll}
      sections={groups.map(group => ({ day: group.day, data: group.rows }))} keyExtractor={row => row.id}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} stickySectionHeadersEnabled={false}
      contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 6, paddingBottom: Math.max(insets.bottom, 20) }}
      refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={() => void load(false, true)} tintColor="#FFF8EC" />}
      renderSectionHeader={({ section }) => <View style={styles.virtualSection}><Text accessibilityRole="header" style={styles.day}>{historyDayLabel(section.day, data.localDate).toUpperCase()}</Text></View>}
      renderItem={({ item }) => <View style={styles.virtualRow}><View pointerEvents="none" style={styles.virtualLine} /><MomentCard row={item} data={data} timezone={timezone} /></View>}
      ListHeaderComponent={<>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.navigate('/(main)/(tabs)' as Href)} style={styles.back}>
          <Feather name="arrow-left" size={30} color="#FFF9EF" />
        </Pressable>
        <View style={styles.titleRow}><View><Text style={styles.title}>Moments</Text><Text style={styles.subtitle}>Little things between you two</Text></View><CoupleMark /></View>
      </View>
      <View style={[styles.panel, { minHeight: 0, flexGrow: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
        <View style={styles.filters}>{(['all', 'you', 'partner'] as const).filter(value => value !== 'partner' || !!data.partner).map(value =>
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
            style={[styles.filter, filter === value && styles.filterActive]}>
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value === 'all' ? 'All' : value === 'you' ? 'You' : data.partner?.display_name?.split(' ')[0] || 'Partner'}</Text>
          </Pressable>)}</View>
      </View></>}
      ListFooterComponent={<View style={[styles.panel, { minHeight: 40, flexGrow: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}>
        {!visible.length && <View style={styles.empty}><Text style={styles.emptyTitle}>Little moments will live here</Text><Text style={styles.emptyCopy}>After you finish an activity together, it will appear on this timeline.</Text></View>}
        {error && !visible.length && <Pressable onPress={() => setRefresh(value => value + 1)} style={styles.retry}><Text style={styles.retryText}>Couldn’t refresh moments · Tap to retry</Text></Pressable>}
        {page?.hasMore && !loading && <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.more}><Text style={styles.moreText}>More moments</Text></Pressable>}
      </View>}
    />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#4D291B' }, scroll: { flex: 1 }, tint: { backgroundColor: '#27130D91' },
  header: { paddingHorizontal: 20, paddingBottom: 32, gap: 22 }, back: { width: 44, height: 42, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#FFFBF4', fontSize: 32, fontWeight: '800' }, subtitle: { color: '#FFF6EA', fontSize: 17, marginTop: 5 },
  coupleMark: { width: 57, height: 56 }, personHead: { position: 'absolute', top: 17, width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFF0D9' },
  personBody: { position: 'absolute', bottom: 3, width: 26, height: 24, borderTopLeftRadius: 17, borderTopRightRadius: 17, backgroundColor: '#FFF0D9' },
  markHeart: { position: 'absolute', top: 0, left: 19, color: '#F18B79', fontSize: 22 },
  panel: { flexGrow: 1, minHeight: 570, marginHorizontal: 5, borderTopLeftRadius: 23, borderTopRightRadius: 23, borderBottomLeftRadius: 23, borderBottomRightRadius: 23,
    backgroundColor: '#FFF8ED', paddingHorizontal: 17, paddingTop: 16, paddingBottom: 24, gap: 16 },
  filters: { flexDirection: 'row', borderWidth: 1, borderColor: '#E4D3C3', borderRadius: 28, backgroundColor: '#F7EFE6', padding: 2, minHeight: 48 },
  virtualSection: { marginHorizontal: 5, paddingHorizontal: 17, paddingTop: 14, paddingBottom: 9, backgroundColor: '#FFF8ED' },
  virtualRow: { marginHorizontal: 5, paddingHorizontal: 17, paddingBottom: 11, backgroundColor: '#FFF8ED' },
  virtualLine: { position: 'absolute', left: 43, top: 0, bottom: 0, width: 3, backgroundColor: '#E8D5C5' },
  filter: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 25 }, filterActive: { backgroundColor: '#C15E3D' },
  filterText: { color: '#503122', fontSize: 16 }, filterTextActive: { color: '#FFF9F2', fontWeight: '800' },
  dayGroup: { gap: 9, marginTop: 2 }, day: { color: '#704630', fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  timeline: { gap: 11 }, timelineLine: { position: 'absolute', top: 0, bottom: 0, left: 26, width: 3, borderRadius: 2, backgroundColor: '#E8D5C5' },
  momentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, eventIcon: { width: 54, height: 54, zIndex: 1 },
  eventCard: { flex: 1, minHeight: 78, borderRadius: 19, backgroundColor: '#FFFDFA', paddingHorizontal: 13, paddingVertical: 10, gap: 4,
    shadowColor: '#A5775C', shadowOpacity: .05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8 }, pressed: { opacity: .75 },
  time: { color: '#8A7061', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  eventBody: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', backgroundColor: '#B87955', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' }, avatarInitial: { color: '#FFF9EF', fontWeight: '800', fontSize: 18 },
  eventTextColumn: { flex: 1, gap: 2 }, description: { color: '#2D1A15', fontSize: 15.5, lineHeight: 21 }, eyebrow: { color: '#8B5E46', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  items: { marginLeft: 48, flexDirection: 'row', gap: 6, paddingTop: 5 }, item: { width: 34, height: 34, borderRadius: 7, backgroundColor: '#F7F0E6', alignItems: 'center', justifyContent: 'center' },
  itemImage: { width: 30, height: 30 }, itemFallback: { color: '#C15E3D', fontSize: 24 },
  empty: { padding: 25, alignItems: 'center', gap: 6 }, emptyTitle: { color: '#503122', fontSize: 19, fontWeight: '800' }, emptyCopy: { color: '#8A7061', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { alignItems: 'center', padding: 12 }, retryText: { color: '#A34C36', fontSize: 13 },
  more: { alignSelf: 'center', paddingHorizontal: 26, paddingVertical: 11, borderRadius: 20, backgroundColor: '#57352A' }, moreText: { color: '#FFF8EE', fontWeight: '700' },
});
