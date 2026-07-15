import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { fetchReflectFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';

/**
 * My Logs -- the Reflect Feed. Every reflection the user has written, most
 * recent first, each card showing the day, the entry, and the emoji of what it
 * gathered. Tapping "View Detail" opens the full reflection. Private to the
 * user (friends only ever see the emoji glimpse elsewhere).
 */
export default function MyLogsScreen() {
  const router = useRouter();
  const [feed, setFeed] = useState<FeedDay[]>([]);

  useFocusEffect(
    useCallback(() => {
      void fetchReflectFeed().then(setFeed);
    }, []),
  );

  // Flatten day-grouped feed into individual reflect cards (each keeps its
  // day label + the day's gathered emoji).
  const entries = feed.flatMap((day) =>
    day.reflects.map((r) => ({
      id: r.id,
      body: r.body,
      dateLabel: formatDayLabel(day.date),
      emoji: day.itemEmoji,
    })),
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <MaterialIcons name="arrow-back" size={24} color="#3A2A1A" />
        </Pressable>
        <Image source={ICONS.interact} style={styles.petAvatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reflect Feed</Text>
          <Text style={styles.subtitle}>Your memories, one day at a time.</Text>
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
                <MaterialIcons name="calendar-today" size={15} color="#B57BC9" />
                <Text style={styles.cardDate}>{e.dateLabel}</Text>
              </View>
              <Text style={styles.cardBody} numberOfLines={3}>{e.body}</Text>
              <View style={styles.cardBottom}>
                <View style={styles.emojiRow}>
                  {e.emoji.slice(0, 5).map((em, i) => (
                    <View key={i} style={styles.emojiChip}>
                      <Text style={styles.emojiText}>{em}</Text>
                    </View>
                  ))}
                  {e.emoji.length > 5 && (
                    <View style={styles.emojiChip}>
                      <Text style={styles.moreText}>+{e.emoji.length - 5}</Text>
                    </View>
                  )}
                </View>
                <Pressable
                  onPress={() => router.push({ pathname: '/(main)/reflect-detail', params: { reflectId: e.id } })}
                  style={({ pressed }) => [styles.detailBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.detailText}>View Detail</Text>
                  <MaterialIcons name="chevron-right" size={16} color="#8B5CC7" />
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FBF3E8', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 14 },
  back: { paddingRight: 2 },
  petAvatar: { width: 48, height: 48 },
  title: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#3A2A1A' },
  subtitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#9A8770', marginTop: 1 },

  scroll: { paddingBottom: 24, gap: 14 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18,
    shadowColor: '#8A6D3B', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  cardDate: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#8B5CC7' },
  cardBody: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#5A4A3A', lineHeight: 22, marginBottom: 14 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emojiRow: { flexDirection: 'row', gap: 6, flex: 1, flexWrap: 'wrap' },
  emojiChip: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#FBF3E8',
    alignItems: 'center', justifyContent: 'center',
  },
  emojiText: { fontSize: 22 },
  moreText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#8B5CC7' },
  detailBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderRadius: 14, borderWidth: 1.5, borderColor: '#E0D0F0',
    paddingHorizontal: 14, paddingVertical: 10, marginLeft: 8,
  },
  detailText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#8B5CC7' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#9A8770', textAlign: 'center', lineHeight: 22 },
});
