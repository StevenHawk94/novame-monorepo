import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { fetchReflectFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';
import { getCachedBags } from '@/lib/bags-api';

/**
 * Reflect detail (from My Logs / an item's memories). The full reflection text
 * plus the "Memories Created" -- the items that reflection gathered, shown as a
 * grid of emoji with counts. Read from the cached feed by reflectId; the items
 * are resolved from the cached bags by walking each item's memories for a
 * matching reflectId.
 */
export default function ReflectDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reflectId } = useLocalSearchParams<{ reflectId: string }>();
  const [feed, setFeed] = useState<FeedDay[]>([]);

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

  // Items this reflection gathered: walk cached bags, collect items whose
  // memories include this reflectId (precise per-reflect attribution).
  const gathered = useMemo(() => {
    const out: { emoji: string; name: string }[] = [];
    for (const item of getCachedBags()) {
      const times = item.memories.filter((m) => m.reflectId === reflectId).length;
      for (let i = 0; i < times; i++) out.push({ emoji: item.emoji, name: item.displayName });
    }
    return out;
  }, [reflectId]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Reflection card */}
        <View style={styles.card}>
          {entry && (
            <View style={styles.dateRow}>
              <MaterialIcons name="calendar-today" size={15} color="#8A6240" />
              <Text style={styles.date}>{entry.dateLabel}</Text>
            </View>
          )}
          <Text style={styles.body}>{entry?.body ?? 'This reflection is no longer available.'}</Text>
        </View>

        {/* Memories Created */}
        {gathered.length > 0 && (
          <View style={styles.memCard}>
            <Text style={styles.memTitle}>Memories Created</Text>
            <View style={styles.memGrid}>
              {gathered.map((g, i) => (
                <View key={i} style={styles.memItem}>
                  <Text style={styles.memEmoji}>{g.emoji}</Text>
                  <Text style={styles.memCount}>x1</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Done */}
      <View style={[styles.doneWrap, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.doneLabel}>Done</Text>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.8 }]}>
          <MaterialIcons name="check" size={26} color="#C77D3A" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7E4D5', paddingHorizontal: 16 },
  scroll: { paddingBottom: 24, gap: 16, paddingTop: 8 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22,
    shadowColor: '#8A6D3B', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  date: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4A3423' },
  body: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#3A2E1A', lineHeight: 24 },

  memCard: {
    backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20,
    shadowColor: '#8A6D3B', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  memTitle: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2A2A2A', textAlign: 'center', marginBottom: 16 },
  memGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 },
  memItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memEmoji: { fontSize: 26 },
  memCount: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#6B5A45' },

  doneWrap: { alignItems: 'center', gap: 8 },
  doneLabel: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#C77D3A' },
  doneBtn: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#8A6D3B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
});
