import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { MONSTERS } from '@novame/engine';
import { haptics } from '@/lib/haptics';
import { CARD_BACK, CARD_FRONTS, deckFor, type TameCard } from '@/lib/tame-cards';

/**
 * Skills — the Tame Enemy card library (2026-07-31 design).
 *
 * Eight fixed decks, one per monster: themed card fronts with the damage
 * number in the circle. A theme strip switches decks; tapping a card flips
 * it over (shared Back.webp) to read the counter-argument it lands with in
 * battle.
 */
export default function SkillsPage() {
  const router = useRouter();
  const [monsterId, setMonsterId] = useState(MONSTERS[0].id);
  const [flipped, setFlipped] = useState<TameCard | null>(null);

  const activeMonster = MONSTERS.find((m) => m.id === monsterId) ?? MONSTERS[0];
  const deck = deckFor(monsterId);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#6B5A45" />
        </Pressable>
        <Text style={styles.title}>Skill Cards</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* theme strip: one chip per monster deck */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripScroll}
        contentContainerStyle={styles.strip}
      >
        {MONSTERS.map((m) => {
          const on = m.id === monsterId;
          return (
            <Pressable
              key={m.id}
              onPress={() => { void haptics.selection(); setMonsterId(m.id); }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {m.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.deckHint}>
        Ten cards to talk {activeMonster.name} down. Tap a card to read it.
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
        {deck.map((card) => (
          <Pressable
            key={card.cardId}
            onPress={() => { void haptics.light(); setFlipped(card); }}
            style={styles.cardWrap}
          >
            <ExpoImage source={CARD_FRONTS[card.monsterId]} style={styles.cardImg} contentFit="cover" />
            <View style={styles.cardScore}>
              <Text style={styles.cardScoreText}>{card.damage}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* flipped card: the counter-argument on the shared back */}
      {flipped !== null && (
        <Pressable style={styles.zoomBackdrop} onPress={() => setFlipped(null)}>
          <View style={styles.zoomCardWrap}>
            <ExpoImage source={CARD_BACK} style={StyleSheet.absoluteFill} contentFit="cover" />
            <View style={styles.zoomInner}>
              <Text style={styles.zoomArgument}>{flipped.argument}</Text>
            </View>
            <View style={styles.zoomScore}>
              <Text style={styles.zoomScoreText}>{flipped.damage}</Text>
            </View>
          </View>
          <Text style={styles.zoomHint}>Tap anywhere to close.</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6E7C8' },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#3A2E1A' },

  stripScroll: { flexGrow: 0 },
  strip: { paddingHorizontal: 14, gap: 8, paddingVertical: 6 },
  chip: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1.5, borderColor: '#E0CBA0',
  },
  chipOn: { backgroundColor: '#4A3220', borderColor: '#4A3220' },
  chipText: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#6B5A45' },
  chipTextOn: { color: '#FFF6DE' },

  deckHint: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: '#8A7A63',
    textAlign: 'center', marginTop: 6, marginBottom: 8, paddingHorizontal: 24,
  },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12,
    paddingHorizontal: 14, paddingBottom: 40,
  },
  cardWrap: { width: 104, height: 156, borderRadius: 12, overflow: 'hidden' },
  cardImg: { width: '100%', height: '100%' },
  cardScore: {
    position: 'absolute', right: 5, bottom: 5, width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#FFF6E8', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#3A2E1A',
  },
  cardScoreText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },

  zoomBackdrop: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30,22,12,0.8)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  zoomCardWrap: { width: 320, height: 480, borderRadius: 22, overflow: 'hidden' },
  zoomInner: { flex: 1, justifyContent: 'center', paddingHorizontal: 34, paddingVertical: 44 },
  zoomArgument: { fontSize: 15.5, fontFamily: 'Inter_700Bold', color: '#1F1B16', lineHeight: 23 },
  zoomScore: {
    position: 'absolute', right: 14, bottom: 14, width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFF6E8', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#3A2E1A',
  },
  zoomScoreText: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  zoomHint: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.75)' },
});
