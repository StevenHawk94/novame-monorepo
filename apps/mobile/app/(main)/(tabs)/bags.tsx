import { useMemo, useEffect, useCallback, useRef, useState } from 'react';
import { FlatList, ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { fetchBags, getCachedBags, type CollectedItem } from '@/lib/bags-api';
import { ItemSheet, type ItemSheetRef } from '@/components/main/item-sheet';
import { ItemSprite } from '@/components/ui/item-sprite';
import { ITEM_DICTIONARY } from '@novame/engine';
import { PROMPT_CATEGORIES } from '@/lib/guided-catalog.g';
import { itemsForGuidedCategory } from '@/lib/guided-prompts';
import { OffsetCard } from '@/components/ui/offset-card';
import { useWindowDimensions } from 'react-native';

// 2026-08-08: "all" + the SAME 11 categories Object Reflect uses (guided
// prompt categories) — membership resolves through itemsForGuidedCategory,
// which already appends OTA manifest additions.
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PROMPT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
];

/**
 * Bags -- the Collection grid (design 2026-07-22, 1:1): framed-photo header
 * icon + "Memories Collection", orange offset My Logs button, the sharable
 * note, a cream bordered category strip (active slot = dark pill), then the
 * item grid, six per row on lavender tiles.
 */
export default function BagsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // Adaptive grid: aim for ~62pt cells, clamp 5..10 per row (phones land on
  // 5-6, tablets spread wider instead of inflating tiles).
  const numColumns = Math.min(10, Math.max(5, Math.floor((width - 32) / 62)));
  const tileSize = Math.floor((width - 32) / numColumns) - 6;
  const cellWidth = `${100 / numColumns}%` as const;
  const [items, setItems] = useState<CollectedItem[]>(() => getCachedBags());
  // Wait-state gate: with no cache yet, show a quiet spinner instead of the
  // empty-state copy while the first fetch is in flight.
  const [loaded, setLoaded] = useState(() => getCachedBags().length > 0);
  const [category, setCategory] = useState<string>('all');
  const itemSheetRef = useRef<ItemSheetRef>(null);

  useFocusEffect(
    useCallback(() => {
      void fetchBags().then((it) => {
        setItems(it);
        setLoaded(true);
      });
    }, []),
  );

  const categoryIds = useMemo(
    () => (category === 'all' ? null : new Set(itemsForGuidedCategory(category))),
    [category],
  );
  const shown =
    categoryIds === null ? items : items.filter((it) => categoryIds.has(it.itemId));

  // Incremental loading (2026-08-08): big collections froze the old
  // render-everything ScrollView. A virtualized list shows 100 tiles and
  // appends 100 more as the user nears the bottom.
  const PAGE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [category]);
  const paged = shown.slice(0, visibleCount);

  function openItem(item: CollectedItem) {
    itemSheetRef.current?.present(item.itemId);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header: framed photo + title + My Logs */}
      <View style={styles.header}>
        <Image source={ICONS.memory} style={styles.headerIcon} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>Memories{'\n'}Collection</Text>
        </View>
        <OffsetCard
          color="#C96F2A"
          offset={4}
          radius={18}
          onPress={() => router.push('/(main)/my-logs')}
          cardStyle={styles.myLogsCard}
        >
          <Image source={ICONS.sharedMemories} style={styles.myLogsIcon} resizeMode="contain" />
          <Text style={styles.myLogsText}>My Logs</Text>
        </OffsetCard>
      </View>

      <Text style={styles.availNote}>All items are sharable with your friends</Text>

      {/* Category strip: cream, thin ink border; active slot is the dark pill.
          Horizontal scroll — All + 11 Object Reflect categories. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catStripScroll}
        contentContainerStyle={styles.catStrip}
      >
        {CATEGORIES.map((cat) => {
          const active = cat.key === category;
          return (
            <Pressable
              key={cat.key}
              onPress={() => setCategory(cat.key)}
              style={[styles.catChip, active && styles.catChipActive]}
            >
              {cat.key === 'all' ? (
                <MaterialIcons name="apps" size={22} color={active ? '#FFF6DE' : '#B99C6B'} />
              ) : (
                <Text style={[styles.catLabel, active && styles.catLabelActive]} numberOfLines={2}>
                  {cat.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Grid */}
      {shown.length === 0 && !loaded ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#8A6240" />
        </View>
      ) : shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'\u{1F392}'}</Text>
          <Text style={styles.emptyText}>
            {items.length === 0
              ? 'Write reflections to start collecting the little things in your days.'
              : 'Nothing in this category yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          key={numColumns}
          data={paged}
          keyExtractor={(it) => it.itemId}
          numColumns={numColumns}
          contentContainerStyle={styles.gridScroll}
          showsVerticalScrollIndicator={false}
          onEndReached={() => setVisibleCount((c) => Math.min(c + PAGE, shown.length))}
          onEndReachedThreshold={0.6}
          initialNumToRender={40}
          maxToRenderPerBatch={40}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => (
            <Pressable onPress={() => openItem(item)} style={[styles.cell, { width: cellWidth }]}>
              <View style={styles.itemCard}>
                <ItemSprite itemId={item.itemId} size={tileSize} radius={18} />
                {item.count > 1 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>
                      x{item.count > 99 ? '99+' : item.count}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      )}

      <ItemSheet ref={itemSheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FEF5F1', paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 10, paddingBottom: 2 },
  headerIcon: { width: 56, height: 56 },
  title: { fontSize: 27, lineHeight: 33, fontFamily: 'Inter_800ExtraBold', color: '#4A2E17' },
  myLogsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#F0913D', paddingHorizontal: 16, paddingVertical: 13,
  },
  myLogsIcon: { width: 24, height: 24 },
  myLogsText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },

  availNote: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#2E2418', marginTop: 8, marginBottom: 16, paddingHorizontal: 2 },

  catStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF8E3', borderRadius: 30, borderWidth: 1.5, borderColor: '#3E2C1A',
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 18,
  },
  catStripScroll: { flexGrow: 0 },
  catChip: { minWidth: 52, height: 46, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  catChipActive: { backgroundColor: '#4A3423' },
  catLabelActive: { color: '#FFF6DE' },
  catLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#8A6B3F', textAlign: 'center' },
  catPlaceholder: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(74,52,35,0.06)' },

  gridScroll: { paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', marginBottom: 10, paddingHorizontal: 3 },
  itemCard: { width: '100%', aspectRatio: 1, borderRadius: 18, backgroundColor: '#F4F1F8', alignItems: 'center', justifyContent: 'center' },
  // Duplicate count, PRD 4.2: corner badge, capped at 99+.
  countBadge: {
    position: 'absolute', right: -2, bottom: -2,
    backgroundColor: '#4A3423', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  countBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter_800ExtraBold' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#9A8770', textAlign: 'center', lineHeight: 22 },
});
