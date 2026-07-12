import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '@/theme/use-theme';
import { fetchBags, getCachedBags, RARITY_COLOR, type CollectedItem } from '@/lib/bags-api';
import { fetchReflectFeed, formatDayLabel, type FeedDay } from '@/lib/reflect-feed-api';

const CATEGORIES = ['all', 'food', 'drink', 'nature', 'object', 'animal'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Bags (C8 + C11b). Two views toggled top-right: the Collection grid (items six
 * per row, tap for memories) and the Reflect Feed (the user's own reflections
 * grouped by day, with the emoji of what they gathered). The feed is private --
 * friends see only the emoji glimpse, never these words.
 */
export default function BagsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [items, setItems] = useState<CollectedItem[]>(() => getCachedBags());
  const [category, setCategory] = useState<Category>('all');
  const [view, setView] = useState<'collection' | 'feed'>('collection');
  const [feed, setFeed] = useState<FeedDay[]>([]);

  useFocusEffect(
    useCallback(() => {
      void fetchBags().then(setItems);
      void fetchReflectFeed().then(setFeed);
    }, []),
  );

  const shown = category === 'all' ? items : items.filter((it) => it.category === category);

  function openItem(item: CollectedItem) {
    router.push({ pathname: '/(main)/item-detail', params: { itemId: item.itemId } });
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bgPrimary }]} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.textPrimary }]}>
            {view === 'collection' ? 'Collection' : 'Reflect Feed'}
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {view === 'collection'
              ? "Items you've gathered from your reflections"
              : 'Your days, one at a time'}
          </Text>
        </View>
        <Pressable
          onPress={() => setView((v) => (v === 'collection' ? 'feed' : 'collection'))}
          hitSlop={8}
          style={[styles.viewToggle, { backgroundColor: c.bgCard, borderColor: c.border }]}
        >
          <MaterialIcons name={view === 'collection' ? 'view-day' : 'grid-view'} size={20} color={c.brand.primary} />
        </Pressable>
      </View>

      {view === 'collection' && (
        <>
          <View style={styles.chipBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {CATEGORIES.map((cat) => {
                const active = cat === category;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={[styles.chip, { backgroundColor: active ? c.brand.primary : c.bgCard, borderColor: c.border }]}
                  >
                    <Text style={[styles.chipText, { color: active ? '#FFFFFF' : c.textSecondary }]}>
                      {cat === 'all' ? 'All' : cat[0].toUpperCase() + cat.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {shown.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>{'\u{1F392}'}</Text>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                {items.length === 0
                  ? 'Write reflections to start collecting the little things in your days.'
                  : 'Nothing in this category yet.'}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.gridScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.grid}>
                {shown.map((item) => (
                  <Pressable key={item.itemId} onPress={() => openItem(item)} style={styles.cell}>
                    <View style={[styles.itemCard, { backgroundColor: c.bgCard, borderColor: RARITY_COLOR[item.rarity] }]}>
                      <Text style={styles.itemEmoji}>{item.emoji}</Text>
                    </View>
                    <View style={[styles.countBadge, { backgroundColor: c.bgCardAlt }]}>
                      <Text style={[styles.countText, { color: c.textSecondary }]}>x{item.count}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </>
      )}

      {view === 'feed' && (
        feed.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>{'\u{1F4D6}'}</Text>
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              Your reflections will gather here, one day at a time.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.feedScroll} showsVerticalScrollIndicator={false}>
            {feed.map((day) => (
              <View key={day.date} style={[styles.dayCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
                <Text style={[styles.dayDate, { color: c.brand.primary }]}>{formatDayLabel(day.date)}</Text>
                {day.reflects.map((r) => (
                  <Text key={r.id} style={[styles.dayBody, { color: c.textSecondary }]} numberOfLines={3}>
                    {r.body}
                  </Text>
                ))}
                {day.itemEmoji.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayEmojiRow}>
                    {day.itemEmoji.map((e, i) => (
                      <Text key={i} style={styles.dayEmoji}>{e}</Text>
                    ))}
                  </ScrollView>
                )}
              </View>
            ))}
          </ScrollView>
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 8, paddingBottom: 12, paddingHorizontal: 4 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold' },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 4 },

  chipBar: { height: 44 },
  viewToggle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  feedScroll: { paddingVertical: 12, paddingBottom: 32 },
  dayCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  dayDate: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  dayBody: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 6 },
  dayEmojiRow: { marginTop: 8 },
  dayEmoji: { fontSize: 26, marginRight: 8 },
  chips: { gap: 8, paddingHorizontal: 4, alignItems: 'center' },
  chip: { height: 34, paddingHorizontal: 16, borderRadius: 17, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  gridScroll: { paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '16.66%', alignItems: 'center', marginBottom: 16, paddingHorizontal: 3 },
  itemCard: { width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  itemEmoji: { fontSize: 26 },
  countBadge: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, minWidth: 28, alignItems: 'center' },
  countText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
});
