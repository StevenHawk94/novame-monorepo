import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '../../src/theme/use-theme';
import { getCachedBags, RARITY_COLOR } from '../../src/lib/bags-api';

/**
 * Item detail (C8, screen 2). The item's memories -- one per time it was matched
 * in a reflection -- newest first, each showing the excerpt and when it was
 * collected. Reads from the cached bags data (the grid just fetched it), keyed
 * by the itemId param. Emoji placeholder until sprite art.
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function ItemDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const { itemId } = useLocalSearchParams<{ itemId: string }>();

  const item = useMemo(() => getCachedBags().find((it) => it.itemId === itemId), [itemId]);

  if (!item) {
    return (
      <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
        </Pressable>
        <View style={styles.center}>
          <Text style={{ color: c.textSecondary }}>Item not found.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>

      <View style={styles.head}>
        <View style={[styles.bigIcon, { backgroundColor: c.bgCard, borderColor: RARITY_COLOR[item.rarity] }]}>
          <Text style={styles.bigEmoji}>{item.emoji}</Text>
        </View>
        <View style={styles.headText}>
          <Text style={[styles.name, { color: c.textPrimary }]}>{item.displayName}</Text>
          <Text style={[styles.memCount, { color: c.brand.primary }]}>
            {item.memories.length} {item.memories.length === 1 ? 'Memory' : 'Memories'}
          </Text>
          <Text style={[styles.rarity, { color: RARITY_COLOR[item.rarity] }]}>
            {item.rarity[0].toUpperCase() + item.rarity.slice(1)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.memList} showsVerticalScrollIndicator={false}>
        {item.memories.map((m, i) => (
          <View key={i} style={[styles.memCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={[styles.memIcon, { backgroundColor: c.bgCardAlt }]}>
              <Text style={styles.memEmoji}>{item.emoji}</Text>
            </View>
            <View style={styles.memBody}>
              <Text style={[styles.memExcerpt, { color: c.textPrimary }]}>{m.excerpt}</Text>
              <Text style={[styles.memDate, { color: c.textMuted }]}>{formatDate(m.createdAt)}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  head: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8, marginBottom: 24 },
  bigIcon: {
    width: 80, height: 80, borderRadius: 20, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  bigEmoji: { fontSize: 40 },
  headText: { flex: 1 },
  name: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  memCount: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  rarity: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },

  memList: { paddingBottom: 32, gap: 12 },
  memCard: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, padding: 14, gap: 14 },
  memIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  memEmoji: { fontSize: 24 },
  memBody: { flex: 1, justifyContent: 'center' },
  memExcerpt: { fontSize: 15, fontFamily: 'Inter_500Medium', lineHeight: 21, marginBottom: 4 },
  memDate: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
