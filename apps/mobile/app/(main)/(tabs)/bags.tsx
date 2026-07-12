import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { useTheme } from '@/theme/use-theme';
import { fetchBags, getCachedBags, RARITY_COLOR, type CollectedItem } from '@/lib/bags-api';

const CATEGORIES = ['all', 'food', 'drink', 'nature', 'object', 'animal'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Bags -- the item collection grid (C8, screen 1).
 *
 * Items collected from reflections, six per row, each with a count badge. Tap
 * an item to see its memories. Emoji is a placeholder until sprite art lands;
 * the layout and data are real. Category chips filter the grid.
 */
export default function BagsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [items, setItems] = useState<CollectedItem[]>(() => getCachedBags());
  const [category, setCategory] = useState<Category>('all');

  useFocusEffect(
    useCallback(() => {
      void fetchBags().then(setItems);
    }, []),
  );

  const shown = category === 'all' ? items : items.filter((it) => it.category === category);

  function openItem(item: CollectedItem) {
    router.push({ pathname: '/(main)/item-detail', params: { itemId: item.itemId } });
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bgPrimary }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.textPrimary }]}>Collection</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Items you've gathered from your reflections
        </Text>
      </View>

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {CATEGORIES.map((cat) => {
          const active = cat === category;
          return (
            <Pressable
              key={cat}
              onPress={() => setCategory(cat)}
              style={[
                styles.chip,
                { backgroundColor: active ? c.brand.primary : c.bgCard, borderColor: c.border },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#FFFFFF' : c.textSecondary }]}>
                {cat === 'all' ? 'All' : cat[0].toUpperCase() + cat.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'\ud83c\udf92'}</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 8, paddingBottom: 12, paddingHorizontal: 4 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold' },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 4 },

  chips: { gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  gridScroll: { paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 6 per row: each cell 1/6 width.
  cell: { width: '16.66%', alignItems: 'center', marginBottom: 16, paddingHorizontal: 3 },
  itemCard: {
    width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  itemEmoji: { fontSize: 26 },
  countBadge: {
    marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, minWidth: 28, alignItems: 'center',
  },
  countText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
});
