import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import { GridBackground } from '@/components/ui/grid-background';
import { fetchReflectFeed, getCachedFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';
import { haptics } from '@/lib/haptics';

/**
 * My Logs -- the Reflect Feed (design 2026-07-22, 1:1): journal icon +
 * "Reflect Feed" title, a "By Date" pill top right, then one cream card per
 * reflection -- calendar date, the entry and the gathered items on bordered
 * tiles (+N overflow in green). The whole card opens the private detail.
 *
 * The back arrow is not in the mock but the route is pushed -- kept small so
 * the screen stays navigable.
 */
export default function MyLogsScreen() {
  const router = useRouter();
  const [feed, setFeed] = useState<FeedDay[]>(() => getCachedFeed());
  const [loaded, setLoaded] = useState(() => getCachedFeed().length > 0);

  useFocusEffect(
    useCallback(() => {
      void fetchReflectFeed().then((f) => {
        setFeed(f);
        setLoaded(true);
      });
    }, []),
  );

  // Each feed row carries its own item ids. Logs therefore stay independent
  // from the much larger paginated Memories cache.
  // Calendar filter (2026-08-08): tap By Date → pick one day or a range.
  const [calOpen, setCalOpen] = useState(false);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);

  const entries = feed
    .flatMap((day) =>
      day.reflects.map((r) => ({
        id: r.id,
        body: r.body,
        date: day.date,
        dateLabel: formatDayLabel(day.date),
        items: r.itemIds,
      })),
    )
    .filter((e) => {
      if (!selStart) return true;
      const end = selEnd ?? selStart;
      return e.date >= selStart && e.date <= end;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const pillLabel = !selStart
    ? 'By Date'
    : !selEnd || selEnd === selStart
      ? formatDayLabel(selStart)
      : `${formatDayLabel(selStart)} – ${formatDayLabel(selEnd)}`;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <GridBackground base="#5A3B2A" line="#714E3A" cell={22} lineWidth={1.2} />
      {/* Header: journal + title + By Date */}
      <View style={styles.header}>
        <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} hitSlop={12} style={styles.back}>
          <MaterialIcons name="arrow-back" size={24} color="#FFF6E8" />
        </Pressable>
        <Image source={ICONS.sharedMemories} style={styles.headerIcon} resizeMode="contain" />
        <Text style={styles.title} numberOfLines={1}>Reflect Feed</Text>
        <Pressable onPress={() => { void haptics.pageOpen(); setCalOpen(true); }} style={styles.byDatePill}>
          <Text style={styles.byDateText} numberOfLines={1}>{pillLabel}</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color="#4A3423" />
        </Pressable>
      </View>

      {entries.length === 0 && !loaded ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#8A6240" />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'\u{1F4D6}'}</Text>
          <Text style={styles.emptyText}>Your reflections will gather here, one day at a time.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {entries.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => {
                void haptics.pageOpen();
                router.push({ pathname: '/(main)/reflect-detail', params: { reflectId: e.id } });
              }}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.82 }]}
            >
              <View style={styles.cardTop}>
                <Image source={ICONS.calendar} style={styles.calendarIcon} resizeMode="contain" />
                <Text style={styles.cardDate}>{e.dateLabel}</Text>
              </View>
              {!!e.body.trim() && (
                <Text style={styles.cardBody} numberOfLines={4}>{e.body.trim()}</Text>
              )}
              <View style={styles.itemRow}>
                {e.items.slice(0, 5).map((id, i) => (
                  <View key={i} style={styles.itemTile}>
                    <ItemSprite itemId={id} size={44} radius={12} />
                  </View>
                ))}
                {e.items.length > 5 && (
                  <View style={[styles.itemTile, styles.moreTile]}>
                    <Text style={styles.moreText}>+{e.items.length - 5}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {calOpen && (
        <CalendarSheet
          start={selStart}
          end={selEnd}
          onChange={(a, b) => { setSelStart(a); setSelEnd(b); }}
          onClose={() => setCalOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ---- Month calendar: tap once = a day, tap again = a range. ----
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function iso(y: number, m: number, d: number): string { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

function CalendarSheet({ start, end, onChange, onClose }: {
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>(() => {
    if (start) return { y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 };
    return { y: now.getFullYear(), m: now.getMonth() };
  });
  const first = new Date(ym.y, ym.m, 1);
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const lead = first.getDay(); // 0 = Sunday
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function tap(d: number) {
    const date = iso(ym.y, ym.m, d);
    if (!start || (start && end)) { onChange(date, null); return; }
    if (date < start) { onChange(date, null); return; }
    if (date === start) { onChange(date, null); return; }
    onChange(start, date);
  }

  const rangeEnd = end ?? start;
  return (
    <Pressable style={calStyles.backdrop} onPress={onClose}>
      <Pressable style={calStyles.card} onPress={() => {}}>
        <View style={calStyles.monthRow}>
          <Pressable onPress={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} hitSlop={10}>
            <MaterialIcons name="chevron-left" size={26} color="#4A3423" />
          </Pressable>
          <Text style={calStyles.monthLabel}>{monthLabel}</Text>
          <Pressable onPress={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} hitSlop={10}>
            <MaterialIcons name="chevron-right" size={26} color="#4A3423" />
          </Pressable>
        </View>
        <View style={calStyles.weekRow}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
            <Text key={i} style={calStyles.weekDay}>{w}</Text>
          ))}
        </View>
        <View style={calStyles.grid}>
          {cells.map((d, i) => {
            if (d === null) return <View key={i} style={calStyles.cell} />;
            const date = iso(ym.y, ym.m, d);
            const inRange = !!start && !!rangeEnd && date >= start && date <= rangeEnd;
            const isEdge = date === start || date === rangeEnd;
            return (
              <Pressable key={i} onPress={() => tap(d)} style={calStyles.cell}>
                <View style={[calStyles.day, inRange && calStyles.dayInRange, isEdge && calStyles.dayEdge]}>
                  <Text style={[calStyles.dayText, (inRange || isEdge) && calStyles.dayTextOn]}>{d}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={calStyles.btnRow}>
          <Pressable onPress={() => { void haptics.pageClose(); onChange(null, null); onClose(); }} style={calStyles.clearBtn}>
            <Text style={calStyles.clearText}>Clear</Text>
          </Pressable>
          <Pressable onPress={() => { void haptics.pageClose(); onClose(); }} style={calStyles.doneBtn}>
            <Text style={calStyles.doneText}>Done</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

const calStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(42,33,24,0.45)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#FDF6EC', borderRadius: 26, padding: 18 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthLabel: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E2418' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 12, fontFamily: 'Inter_700Bold', color: '#9A8770' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayInRange: { backgroundColor: '#EAD9BE' },
  dayEdge: { backgroundColor: '#4A3423' },
  dayText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#3A2E1A' },
  dayTextOn: { color: '#FFF6E8' },
  btnRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  clearBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  clearText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#8A6240' },
  doneBtn: { backgroundColor: '#4A3423', borderRadius: 20, paddingVertical: 12, paddingHorizontal: 28 },
  doneText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#5A3B2A', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 8, paddingBottom: 16 },
  back: { paddingRight: 2 },
  headerIcon: { width: 38, height: 38 },
  title: { flexShrink: 1, fontSize: 23, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  byDatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '36%', marginLeft: 'auto',
    backgroundColor: '#FBF3DF', borderRadius: 20,
    paddingLeft: 12, paddingRight: 8, paddingVertical: 9,
  },
  byDateText: { flexShrink: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4A3423' },

  scroll: { paddingBottom: 24, gap: 16 },
  card: { backgroundColor: '#FCF5EA', borderRadius: 24, padding: 20 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  calendarIcon: { width: 26, height: 26 },
  cardDate: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E2418' },
  cardBody: { fontSize: 15.5, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 23, marginBottom: 14 },

  itemRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  itemTile: { borderRadius: 14, backgroundColor: '#F4F1F8', padding: 2 },
  moreTile: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', padding: 0 },
  moreText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#3E7A3E' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: 'rgba(255,246,232,0.8)', textAlign: 'center', lineHeight: 22 },
});
