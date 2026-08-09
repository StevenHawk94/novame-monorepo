import { useCallback, useMemo, useState } from 'react';
import { useWindowDimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { ItemSprite } from '@/components/ui/item-sprite';
import { fetchReflectFeed, getCachedFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';
import { getCachedBags } from '@/lib/bags-api';

/**
 * Reflect detail (design 2026-07-22, 1:1): dark-brown full screen, a white
 * card with the dated full reflection, then a "Memory Items Created" card --
 * the items that reflection gathered as sprite tiles with xN counts -- and a
 * round white close button. Read from the cached feed by reflectId; items
 * resolved from cached bags by matching each memory's reflectId.
 */
export default function ReflectDetailScreen() {
  const insets = useSafeAreaInsets();
  // Justified item grid (2026-08-08): ~72pt targets pick the column count,
  // then the tile size stretches so each full row spans the card exactly.
  const { width: winW } = useWindowDimensions();
  const memInner = winW - 36 - 40 - 8; // page pad(18x2) + memCard pad + memRow pad
  const memCols = Math.max(4, Math.floor((memInner + 14) / (72 + 14)));
  const memTile = Math.floor((memInner - (memCols - 1) * 14) / memCols);
  const router = useRouter();
  const { reflectId } = useLocalSearchParams<{ reflectId: string }>();
  // Cache-first: the pushed-from screen already had this feed cached.
  const [feed, setFeed] = useState<FeedDay[]>(() => getCachedFeed());

  useFocusEffect(
    useCallback(() => {
      void fetchReflectFeed().then(setFeed);
    }, []),
  );

  // Find the reflection + its day label.
  const entry = useMemo(() => {
    for (const day of feed) {
      const r = day.reflects.find((x) => x.id === reflectId);
      if (r) return { body: r.body, dateLabel: formatDayLabel(day.date) };
    }
    return null;
  }, [feed, reflectId]);

  // Items this reflection gathered, aggregated to (item, count) so a double
  // mention shows one tile with x2 rather than two x1 tiles.
  const gathered = useMemo(() => {
    const out: { itemId: string; count: number }[] = [];
    for (const item of getCachedBags()) {
      const times = item.memories.filter((m) => m.reflectId === reflectId).length;
      if (times > 0) out.push({ itemId: item.itemId, count: times });
    }
    return out;
  }, [reflectId]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Reflection card */}
        <View style={styles.card}>
          {entry && (
            <View style={styles.dateRow}>
              <Image source={ICONS.calendar} style={styles.calendarIcon} resizeMode="contain" />
              <Text style={styles.date}>{entry.dateLabel}</Text>
            </View>
          )}
          <Text style={styles.body}>{entry?.body ?? 'This reflection is no longer available.'}</Text>
        </View>

        {/* Memory Items Created */}
        {gathered.length > 0 && (
          <View style={styles.memCard}>
            <View style={styles.memTitleRow}>
              <Image source={ICONS.memory} style={styles.memTitleIcon} resizeMode="contain" />
              <Text style={styles.memTitle}>Memory Items Created</Text>
            </View>
            {/* Wrapping grid: every item visible, growing downward (no side-scroll). */}
            <View style={styles.memRow}>
              {gathered.map((g) => (
                <View key={g.itemId} style={styles.memItem}>
                  <ItemSprite itemId={g.itemId} size={memTile} radius={16} />
                  <Text style={styles.memCount}>x{g.count}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Close: white circle, dark X (mock) */}
      <View style={[styles.closeWrap, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
          <MaterialIcons name="close" size={28} color="#43301F" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#43301F', paddingHorizontal: 18 },
  scroll: { paddingBottom: 24, gap: 20, paddingTop: 8 },

  card: { backgroundColor: '#FDF9F1', borderRadius: 26, padding: 24 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  calendarIcon: { width: 28, height: 28 },
  date: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E2418' },
  body: { fontSize: 16, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 26 },

  memCard: { backgroundColor: '#FDF9F1', borderRadius: 26, padding: 20 },
  memTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  memTitleIcon: { width: 30, height: 30 },
  memTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#2A2118' },
  memRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 4 },
  memItem: { alignItems: 'center', gap: 6 },
  memCount: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4A3B2A' },

  closeWrap: { alignItems: 'center' },
  closeBtn: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
});
