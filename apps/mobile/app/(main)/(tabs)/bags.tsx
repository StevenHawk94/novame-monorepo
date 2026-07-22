import { useCallback, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/lib/icons';
import { fetchBags, getCachedBags, type CollectedItem } from '@/lib/bags-api';
import { ItemSheet, type ItemSheetRef } from '@/components/main/item-sheet';

// Six category slots. Icons are placeholders until the real category art + the
// final item taxonomy land; the first slot ("all") shows everything.
const CATEGORIES: { key: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'all', icon: 'apps' },
  { key: 'food', icon: 'restaurant' },
  { key: 'drink', icon: 'local-cafe' },
  { key: 'nature', icon: 'eco' },
  { key: 'object', icon: 'category' },
  { key: 'animal', icon: 'pets' },
];

/**
 * Bags -- the Collection grid. The user's gathered items, six per row, tapped
 * for that item's memories. A category strip filters the grid; "My Logs" (top
 * right) opens the Reflect Feed. Warm light theme to match the Home art.
 */
export default function BagsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<CollectedItem[]>(() => getCachedBags());
  const [category, setCategory] = useState<string>('all');
  const itemSheetRef = useRef<ItemSheetRef>(null);

  useFocusEffect(
    useCallback(() => {
      void fetchBags().then(setItems);
    }, []),
  );

  const shown = category === 'all' ? items : items.filter((it) => it.category === category);

  function openItem(item: CollectedItem) {
    itemSheetRef.current?.present(item.itemId);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header: pet + title + My Logs */}
      <View style={styles.header}>
        <Image source={ICONS.interact} style={styles.petAvatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Memories Collection</Text>
        </View>
        <Pressable
          onPress={() => router.push('/(main)/my-logs')}
          style={({ pressed }) => [styles.myLogsBtn, pressed && styles.myLogsPressed]}
          hitSlop={8}
        >
          <MaterialIcons name="menu-book" size={18} color="#FFFFFF" />
          <Text style={styles.myLogsText}>My Logs</Text>
        </Pressable>
      </View>

      <Text style={styles.availNote}>All items are sharable with your friends</Text>

      {/* Category strip */}
      <View style={styles.catStrip}>
        {CATEGORIES.map((cat) => {
          const active = cat.key === category;
          return (
            <Pressable
              key={cat.key}
              onPress={() => setCategory(cat.key)}
              style={[styles.catChip, active && styles.catChipActive]}
            >
              <MaterialIcons name={cat.icon} size={22} color={active ? '#8A5A2B' : '#D8B48A'} />
            </Pressable>
          );
        })}
      </View>

      {/* Grid */}
      {shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{'\u{1F392}'}</Text>
          <Text style={styles.emptyText}>
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
                <View style={styles.itemCard}>
                  <Text style={styles.itemEmoji}>{item.emoji}</Text>
                  {item.count > 1 && (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>
                        x{item.count > 99 ? '99+' : item.count}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <ItemSheet ref={itemSheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FBF3E8', paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 8 },
  petAvatar: { width: 52, height: 52 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: '#3A2A1A' },
  subtitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#B57BC9', marginTop: 1 },
  myLogsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#EF9A4D', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#B5762B', shadowOpacity: 0.3, shadowRadius: 0, shadowOffset: { width: 2, height: 3 },
  },
  myLogsPressed: { transform: [{ translateX: 1 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  myLogsText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },

  availNote: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#9A8770', marginTop: 6, marginBottom: 14, paddingHorizontal: 4 },

  catStrip: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 8, marginBottom: 16,
    shadowColor: '#8A6D3B', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  catChip: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  catChipActive: { backgroundColor: '#F6E7D0', borderWidth: 2, borderColor: '#E8C9A0' },

  gridScroll: { paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '16.66%', alignItems: 'center', marginBottom: 10, paddingHorizontal: 3 },
  itemCard: {
    width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#8A6D3B', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  itemEmoji: { fontSize: 28 },
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
