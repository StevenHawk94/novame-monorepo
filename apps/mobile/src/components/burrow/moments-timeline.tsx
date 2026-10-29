import { BurrowBackButton } from './burrow-back-button';
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { Image } from './burrow-image';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { historyDayLabel, mergeHistory, type HistoryRow } from '@/lib/burrow-history';
import { momentsCache } from '@/lib/moments-cache';
import { momentDescription, momentKind, momentLocalDate } from '@/lib/burrow-moments-model';
import { BURROW_MOMENT_ICONS } from '@/lib/burrow-ui-assets';
import { ITEM_IMAGES } from '@/lib/item-images.g';
import { TAP_DAY_IMAGES } from '@/lib/tap-day-images.g';
import { orderedTapDayItems } from '@/lib/tap-day-display-order';
import { markBurrowUpdatesSeen } from '@/lib/burrow-attention';
import {UserAvatar} from '@/components/ui/user-avatar';

type Filter = 'all' | 'you' | 'partner';
type EventRow = Extract<HistoryRow, { event_type: string }>;
const timeFormatters = new Map<string,Intl.DateTimeFormat>();

function timeLabel(value: string, timezone: string) {
  try {
    if(!timeFormatters.has(timezone)) {
      if(timeFormatters.size>=4)timeFormatters.clear();
      timeFormatters.set(timezone,new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }));
    }
    return timeFormatters.get(timezone)!.format(new Date(value));
  }
  catch { return ''; }
}

function CoupleMark() {
  return <View pointerEvents="none" style={styles.coupleMark}>
    <View style={[styles.personHead, { left: 8 }]} /><View style={[styles.personHead, { right: 8 }]} />
    <View style={[styles.personBody, { left: 2 }]} /><View style={[styles.personBody, { right: 2 }]} />
    <Text style={styles.markHeart}>♥</Text>
  </View>;
}

function MomentAvatar({ person,otherUserId }: { person: MajorUpdateBootstrap['profile'] | MajorUpdateBootstrap['partner'];otherUserId?:string }) {
  return <UserAvatar userId={person?.id} otherUserId={otherUserId} name={person?.display_name} avatarUrl={person?.avatar_url} isDefaultAvatar={person?.is_default_avatar} size={38}/>;
}

const MomentCard = memo(function MomentCard({ row, data, timezone }: { row: EventRow; data: MajorUpdateBootstrap; timezone: string }) {
  const kind = momentKind(row)!;
  const me = row.actor_id === data.profile.id;
  const person = me ? data.profile : data.partner;
  // Record bodies are already permission-filtered by bootstrap/history. Never
  // fetch a private record or message just to expand an informational event.
  const description = row.event_type === 'adventure_record_saved' && row.record
    ? row.record.body : momentDescription(row, data.profile.id, data.partner?.display_name?.trim() || 'Your person',data.catalog);
  const items = useMemo(() => orderedTapDayItems(kind === 'log-day' ? row.record?.items ?? [] : []), [kind, row.record?.items]);
  const hasDescription = !!description.trim();
  const selections = items.length > 0 && <View style={styles.items}><View style={styles.itemFlow}>{items.map(item => {
    // Use the same complete map as the picker, including all five people.
    // Keep the base map only as a compatibility fallback for historical IDs.
    const source = TAP_DAY_IMAGES[item.itemId] ?? ITEM_IMAGES[item.itemId];
    return <View key={item.itemId} style={styles.item} accessible accessibilityRole="text" accessibilityLabel={item.label}>
      <View style={styles.itemSeparator} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text accessible={false} style={styles.itemDot}>•</Text>
      </View>
      {source ? <Image source={source} contentFit="contain" style={styles.itemImage} accessible={false} />
        : <Text accessible={false} style={styles.itemFallback}>✦</Text>}
      <Text style={styles.itemLabel}>{item.label}</Text>
    </View>;
  })}</View></View>;
  return <View style={styles.momentRow}>
    <Image source={BURROW_MOMENT_ICONS[kind]} contentFit="contain" style={styles.eventIcon} accessibilityLabel={`${kind} icon`} />
    <View style={styles.eventCard}>
      <Text style={styles.time}>{timeLabel(row.created_at, timezone).toUpperCase()}</Text>
      <View style={items.length ? [styles.eventBody, styles.eventBodyWithItems] : styles.eventBody}>
        <View style={styles.avatar}><MomentAvatar key={person?.id ?? 'unknown'} person={person} otherUserId={me?data.partner?.id:data.profile.id}/></View>
        <View style={styles.eventTextColumn}>
          {hasDescription && <Text style={styles.description}>{description}</Text>}
          {selections}
        </View>
      </View>
    </View>
  </View>;
},(a,b)=>a.row===b.row&&a.timezone===b.timezone&&a.data.profile===b.data.profile&&a.data.partner===b.data.partner&&a.data.catalog===b.data.catalog);

/** Only persisted completion events enter this timeline; opening an activity never does. */
export function MomentsTimeline({ data }: { data: MajorUpdateBootstrap }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [filter, setFilter] = useState<Filter>('all');
  const {page,loading,refreshing:manualRefreshing,error}=useSyncExternalStore(momentsCache.subscribe,
    ()=>momentsCache.read(data),()=>momentsCache.read(data));
  const timezone = page?.timezone || data.profile.timezone_name || 'UTC';
  const normalized=useRef({timezone:'',rows:new Map<string,{source:MajorUpdateBootstrap['moments'][number];row:HistoryRow}>()});
  const bootstrapRows = useMemo<HistoryRow[]>(() => {
    const timezone=data.profile.timezone_name||'UTC',before=normalized.current;
    const next=new Map<string,{source:MajorUpdateBootstrap['moments'][number];row:HistoryRow}>();
    const rows=data.moments.map(source=>{
      const cached=before.timezone===timezone?before.rows.get(source.id):undefined;
      const row=cached?.source===source?cached.row:{...source,localDate:momentLocalDate(source.created_at,timezone)};
      next.set(source.id,{source,row});return row;
    });
    normalized.current={timezone,rows:next};return rows;
  }, [data.moments, data.profile.timezone_name]);

  // The global sync owner prepares this cache even before this screen mounts.
  // Focus only acknowledges the reminder; it never initiates a history read.
  const load = (more:boolean) => more ? momentsCache.more(data) : momentsCache.refresh(data);

  // Bootstrap contains lightweight event summaries, not the authorized record
  // bodies/items. History must win for matching IDs (including record:null);
  // otherwise the summary erases the user's journal on every bootstrap update.
  const rows = useMemo(() => page ? mergeHistory(bootstrapRows, page.rows) : bootstrapRows, [bootstrapRows, page]);
  useEffect(()=>{if(focused&&page)markBurrowUpdatesSeen(data,'moments',page.rows.map(row=>`${row.id}:${row.created_at}`));},[focused,data,page]);
  const visible = useMemo(()=>{
    const gameSessions = new Set<string>();
    return rows.filter((row): row is EventRow => {
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
  },[rows,filter,data.profile.id]);
  const groups = useMemo(()=>{
  const sections: { day: string; data: EventRow[] }[] = [];
  for (const row of visible) {
    const last = sections[sections.length - 1];
    if (last?.day === row.localDate) last.data.push(row);
    else sections.push({ day: row.localDate, data: [row] });
  }
  return sections;
  },[visible]);

  return <View style={styles.root}>
    <Image source={BURROW_BACKGROUNDS.common} contentFit="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
    <View style={[StyleSheet.absoluteFillObject, styles.tint]} pointerEvents="none" />
    <SectionList<EventRow, { day: string; data: EventRow[] }> style={styles.scroll}
      sections={groups} keyExtractor={row => row.id}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} stickySectionHeadersEnabled={false}
      contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 6, paddingBottom: Math.max(insets.bottom, 20) }}
      refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={() => void load(false)} tintColor="#FFF8EC" />}
      renderSectionHeader={({ section }) => <View style={styles.virtualSection}><Text accessibilityRole="header" style={styles.day}>{historyDayLabel(section.day, data.localDate).toUpperCase()}</Text></View>}
      renderItem={({ item }) => <View style={styles.virtualRow}><View pointerEvents="none" style={styles.virtualLine} /><MomentCard row={item} data={data} timezone={timezone} /></View>}
      ListHeaderComponent={<>
      <View style={styles.header}>
        <BurrowBackButton light accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.navigate('/(main)/(tabs)' as Href)} />
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
        {!visible.length && <View style={styles.empty}><Text style={styles.emptyTitle}>Little moments will live here</Text><Text style={styles.emptyCopy}>Both of your activities will appear on this timeline</Text></View>}
        {error && !visible.length && <Pressable onPress={() => void load(false)} style={styles.retry}><Text style={styles.retryText}>Couldn’t refresh moments · Tap to retry</Text></Pressable>}
        {page?.hasMore && !loading && <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.more}><Text style={styles.moreText}>More moments</Text></Pressable>}
      </View>}
    />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#4D291B' }, scroll: { flex: 1 }, tint: { backgroundColor: '#27130D91' },
  header: { paddingHorizontal: 20, paddingBottom: 32, gap: 22 },
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
  virtualLine: { position: 'absolute', left: 29, top: 0, bottom: 0, width: 3, backgroundColor: '#E8D5C5' },
  filter: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 25 }, filterActive: { backgroundColor: '#C15E3D' },
  filterText: { color: '#503122', fontSize: 16 }, filterTextActive: { color: '#FFF9F2', fontWeight: '800' },
  day: { color: '#704630', fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  momentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, eventIcon: { width: 27, height: 27, zIndex: 1 },
  eventCard: { flex: 1, minHeight: 78, borderRadius: 19, backgroundColor: '#FFFDFA', paddingHorizontal: 13, paddingVertical: 10, gap: 4,
    shadowColor: '#A5775C', shadowOpacity: .05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8 },
  time: { color: '#8A7061', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  eventBody: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', backgroundColor: '#B87955', alignItems: 'center', justifyContent: 'center' },
  eventBodyWithItems: { alignItems: 'flex-start' },
  avatarImage: { width: '100%', height: '100%' },
  eventTextColumn: { flex: 1, gap: 2 }, description: { color: '#2D1A15', fontSize: 15.5, lineHeight: 21 },
  // The negative leading gutter clips only each wrapped line's first dot.
  // Dots stay attached to their icon/label, so none wrap onto a line alone;
  // native flex layout handles width/font changes without JS measurement.
  items: { overflow: 'hidden' },
  itemFlow: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -14, rowGap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%', minHeight: 26 },
  itemSeparator: { width: 14, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  itemDot: { color: '#ABA69D', fontSize: 15, lineHeight: 20 },
  itemImage: { width: 22, height: 22, marginRight: 5, flexShrink: 0 },
  itemFallback: { width: 22, marginRight: 5, textAlign: 'center', color: '#C15E3D', fontSize: 18 },
  itemLabel: { color: '#79675B', fontSize: 13.5, lineHeight: 20, flexShrink: 1 },
  empty: { padding: 25, alignItems: 'center', gap: 6 }, emptyTitle: { color: '#503122', fontSize: 19, fontWeight: '800' }, emptyCopy: { color: '#8A7061', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { alignItems: 'center', padding: 12 }, retryText: { color: '#A34C36', fontSize: 13 },
  more: { alignSelf: 'center', paddingHorizontal: 26, paddingVertical: 11, borderRadius: 20, backgroundColor: '#57352A' }, moreText: { color: '#FFF8EE', fontWeight: '700' },
});
