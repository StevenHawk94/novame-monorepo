import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import { fetchReflectFeed, getCachedFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';
import { fetchBags, getCachedBags } from '@/lib/bags-api';

/**
 * My Logs -- the Reflect Feed (design 2026-07-22, 1:1): journal icon +
 * "Reflect Feed" title, a "By Date" pill top right, then one cream card per
 * reflection -- calendar date, the entry, the gathered items on bordered
 * tiles (+N overflow in green), and a dark View Detail pill. Private to the
 * user (friends only ever see the emoji glimpse elsewhere).
 *
 * The back arrow is not in the mock but the route is pushed -- kept small so
 * the screen stays navigable.
 */
export default function MyLogsScreen() {
  const router = useRouter();
  const [feed, setFeed] = useState<FeedDay[]>(() => getCachedFeed());

  useFocusEffect(
    useCallback(() => {
      void fetchReflectFeed().then(setFeed);
      void fetchBags();
    }, []),
  );

  // Flatten day-grouped feed into individual reflect cards (each keeps its
  // day label + the day's gathered emoji).
  // Each reflection shows only the items IT gathered -- resolved precisely by
  // walking cached bags for memories whose reflectId matches this reflection,
  // not the day's aggregate (which would repeat every item on every card).
  const bags = getCachedBags();
  function itemsForReflect(reflectId: string): string[] {
    const out: string[] = [];
    for (const item of bags) {
      const n = item.memories.filter((m) => m.reflectId === reflectId).length;
      for (let i = 0; i < n; i++) out.push(item.itemId);
    }
    return out;
  }
  const entries = feed.flatMap((day) =>
    day.reflects.map((r) => ({
      id: r.id,
      body: r.body,
      dateLabel: formatDayLabel(day.date),
      items: itemsForReflect(r.id),
    })),
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header: journal + title + By Date */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <MaterialIcons name="arrow-back" size={24} color="#3A2A1A" />
        </Pressable>
        <Image source={ICONS.sharedMemories} style={styles.headerIcon} resizeMode="contain" />
        <Text style={styles.title}>Reflect Feed</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.byDatePill}>
          <Text style={styles.byDateText}>By Date</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color="#4A3423" />
        </View>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'\u{1F4D6}'}</Text>
          <Text style={styles.emptyText}>Your reflections will gather here, one day at a time.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {entries.map((e) => (
            <View key={e.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Image source={ICONS.calendar} style={styles.calendarIcon} resizeMode="contain" />
                <Text style={styles.cardDate}>{e.dateLabel}</Text>
              </View>
              <Text style={styles.cardBody} numberOfLines={4}>{e.body}</Text>
              <View style={styles.itemRow}>
                {e.items.slice(0, 5).map((id, i) => (
                  <View key={i} style={styles.itemTile}>
                    <ItemSprite itemId={id} size={44} radius={12} tileColor="#FFFDF4" />
                  </View>
                ))}
                {e.items.length > 5 && (
                  <View style={[styles.itemTile, styles.moreTile]}>
                    <Text style={styles.moreText}>+{e.items.length - 5}</Text>
                  </View>
                )}
              </View>
              <Pressable
                onPress={() => router.push({ pathname: '/(main)/reflect-detail', params: { reflectId: e.id } })}
                style={({ pressed }) => [styles.detailBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.detailText}>View Detail</Text>
                <MaterialIcons name="chevron-right" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAF1E6', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 16 },
  back: { paddingRight: 2 },
  headerIcon: { width: 46, height: 46 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: '#3A2A1A' },
  byDatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FFF9F2', borderRadius: 20, borderWidth: 1.5, borderColor: '#C9AE94',
    paddingLeft: 16, paddingRight: 10, paddingVertical: 10,
  },
  byDateText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#4A3423' },

  scroll: { paddingBottom: 24, gap: 16 },
  card: { backgroundColor: '#FDF3D9', borderRadius: 24, padding: 20 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  calendarIcon: { width: 26, height: 26 },
  cardDate: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E2418' },
  cardBody: { fontSize: 15.5, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 23, marginBottom: 14 },

  itemRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  itemTile: {
    borderRadius: 14, borderWidth: 1.5, borderColor: '#E4CFA7',
    backgroundColor: '#FFFDF4', padding: 2,
  },
  moreTile: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', padding: 0 },
  moreText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#3E7A3E' },

  // Design: solid dark-brown View Detail pill, white label, right-aligned.
  detailBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-end',
    borderRadius: 24, backgroundColor: '#4A3423',
    paddingHorizontal: 20, paddingVertical: 13,
  },
  detailText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#9A8770', textAlign: 'center', lineHeight: 22 },
});
