import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { DIMENSIONS, DIMENSION_IDS, type DimensionId } from '@novame/domain';
import { fetchSkills, getCachedSkills, DIMENSION_COLOR, type Skill } from '@/lib/skills-api';

/**
 * Skills — the collected skill-card library (design: Skill List).
 *
 * Mock layout: brown banner title, a cream panel with a 3×3 grid — the 8
 * dimensions plus the 9th "Mega" group (universal cards usable on every
 * monster, arriving with the P1 fixed 81-card library, 9 per group). Each
 * cell shows a representative tile and its collected count. Tapping a group
 * lists that group's learned cards below the grid.
 *
 * Card art is a colored placeholder tile until the 81-card art lands.
 */
const CARDS_PER_GROUP = 9; // 9 groups × 9 cards = 81 (product ruling)

type GroupKey = DimensionId | 'mega';

const GROUP_EMOJI: Record<string, string> = {
  expression: '📣', awareness: '🪞', momentum: '🏃', direction: '🧭',
  steadiness: '🌊', confidence: '🔥', gratitude: '🌸', connection: '🤝',
  mega: '🌟',
};

export default function SkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>(() => getCachedSkills());
  const [selected, setSelected] = useState<GroupKey | null>(null);

  useFocusEffect(
    useCallback(() => {
      void fetchSkills().then(setSkills);
    }, []),
  );

  const groups = useMemo(() => {
    const byDim = new Map<GroupKey, Skill[]>();
    for (const id of DIMENSION_IDS) byDim.set(id, []);
    byDim.set('mega', []); // universal cards land with the P1 81-card library
    for (const sk of skills) {
      const key = (byDim.has(sk.dimension as GroupKey) ? sk.dimension : 'mega') as GroupKey;
      byDim.get(key)!.push(sk);
    }
    return byDim;
  }, [skills]);

  const selectedSkills = selected ? groups.get(selected) ?? [] : [];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#6B5A45" />
        </Pressable>
      </View>

      {/* Design: brown banner title */}
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>{'💪'}</Text>
        <Text style={styles.bannerText}>Skills to Tame Your Enemy</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.panel}>
          <View style={styles.grid}>
            {([...DIMENSION_IDS, 'mega'] as GroupKey[]).map((key) => {
              const list = groups.get(key) ?? [];
              const name = key === 'mega' ? 'Mega' : DIMENSIONS[key as DimensionId].nameEn;
              const color = key === 'mega' ? '#8B7FD9' : DIMENSION_COLOR[key] ?? '#C9BCA5';
              const on = selected === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelected((cur) => (cur === key ? null : key))}
                  style={styles.cell}
                >
                  <View
                    style={[
                      styles.cardTile,
                      { backgroundColor: color },
                      on && styles.cardTileOn,
                      list.length === 0 && styles.cardTileEmpty,
                    ]}
                  >
                    <Text style={styles.cardTileEmoji}>{GROUP_EMOJI[key]}</Text>
                  </View>
                  <Text style={styles.cellName}>{name}</Text>
                  <Text style={styles.cellCount}>
                    {Math.min(list.length, CARDS_PER_GROUP)}/{CARDS_PER_GROUP}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Selected group's learned cards */}
        {selected && (
          <View style={styles.detail}>
            {selectedSkills.length === 0 ? (
              <Text style={styles.detailEmpty}>
                {selected === 'mega'
                  ? 'Mega cards work on every monster — they arrive with the full card library.'
                  : 'Nothing learned here yet — keep reflecting and this group will fill up.'}
              </Text>
            ) : (
              selectedSkills.map((sk) => (
                <View
                  key={sk.skillId}
                  style={[styles.skillCard, sk.rarity === 'secret' && styles.skillCardSecret]}
                >
                  {sk.rarity === 'secret' && <Text style={styles.secretTag}>✨ Secret</Text>}
                  <Text style={styles.skillTitle}>{sk.title}</Text>
                  <Text style={styles.skillBody}>{sk.body}</Text>
                  {sk.source === 'friend' && (
                    <Text style={styles.taughtTag}>Taught by a friend</Text>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {skills.length === 0 && !selected && (
          <Text style={styles.emptyText}>
            As you reflect, the lessons you arrive at are saved here as skill cards you can
            carry into Tame Enemy.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6B79B', paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { paddingTop: 8, paddingBottom: 4, paddingHorizontal: 4 },

  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#4A3220', borderRadius: 18, paddingVertical: 14, marginBottom: 14,
  },
  bannerEmoji: { fontSize: 20 },
  bannerText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  scroll: { paddingBottom: 32 },
  panel: { backgroundColor: '#FDF3E1', borderRadius: 26, padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cell: { width: '31%', alignItems: 'center', marginBottom: 18 },
  cardTile: {
    width: '100%', aspectRatio: 0.72, borderRadius: 12, borderWidth: 3, borderColor: '#3B4A8F',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTileOn: { borderColor: '#2B2B2B', transform: [{ scale: 1.04 }] },
  cardTileEmpty: { opacity: 0.45 },
  cardTileEmoji: { fontSize: 34 },
  cellName: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', marginTop: 8 },
  cellCount: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#4A3B2A', marginTop: 1 },

  detail: { marginTop: 14, gap: 12 },
  detailEmpty: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: '#6B5A45',
    textAlign: 'center', lineHeight: 21, backgroundColor: '#FDF3E1',
    borderRadius: 16, padding: 18,
  },
  skillCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16 },
  skillCardSecret: { borderWidth: 2, borderColor: '#B57BC9' },
  secretTag: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#B57BC9', marginBottom: 6 },
  skillTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#2B2B2B', marginBottom: 6 },
  skillBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B5A45', lineHeight: 21 },
  taughtTag: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#8A6240', marginTop: 8 },

  emptyText: {
    fontSize: 15, fontFamily: 'Inter_500Medium', color: '#6B4A35',
    textAlign: 'center', lineHeight: 22, marginTop: 24, paddingHorizontal: 24,
  },
});
