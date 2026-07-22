import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { DIMENSION_IDS, DIMENSIONS } from '@novame/domain';
import { gemStage, GEM_STAGE_BOUNDS, GEM_STAGE_COUNT } from '@novame/engine';
import { haptics } from '../../../src/lib/haptics';
import {
  fetchGems,
  getCachedGems,
  totalGems,
  type GemsByDimension,
} from '../../../src/lib/status-api';

/**
 * Me — the growth page (design: Me.png). Top: the current stage's portrait
 * art (color-block placeholder until the six stage illustrations land) under
 * a "Growth Journey" banner; a gear opens the settings center. Middle: the
 * six-stage milestone timeline with check nodes (bounds from the engine).
 * Bottom: the 8 dimension tiles (dark cards, ⚡score each). Pure display;
 * data comes entirely from the gems system (PRD 7.2).
 */
const STAGE_NAMES = ['Exploring', 'Growing', 'Maturing', 'Confident', 'Transcendent', 'Complete'];
// Stage-art placeholder tones, one per stage, until the illustrations land.
const STAGE_TONES = ['#3A3A44', '#41455A', '#3E5A50', '#5A4E3E', '#54405A', '#5A3E46'];

const DIMENSION_EMOJI: Record<string, string> = {
  expression: '🎨', awareness: '🌱', momentum: '⚔️', direction: '🧭',
  steadiness: '🗡️', confidence: '✨', gratitude: '🌸', connection: '🐿️',
};

export default function StatusScreen() {
  const router = useRouter();
  const [gems, setGems] = useState<GemsByDimension>(() => getCachedGems());

  useEffect(() => {
    let active = true;
    fetchGems().then((fresh) => {
      if (active) setGems(fresh);
    });
    return () => {
      active = false;
    };
  }, []);

  const total = totalGems(gems);
  const stage = gemStage(total);

  // Node label = the score that completes that stage; the final stage never
  // exits, so it reads MAX.
  const milestones = [...GEM_STAGE_BOUNDS.map(String), 'MAX'];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ---- stage portrait (placeholder until the six illustrations land) ---- */}
        <View style={[styles.hero, { backgroundColor: STAGE_TONES[stage - 1] }]}>
          <View style={styles.heroBanner}>
            <Text style={styles.heroBannerEmoji}>{'🐾'}</Text>
            <Text style={styles.heroBannerText}>Growth Journey</Text>
          </View>
          <Pressable
            onPress={() => { void haptics.light(); router.push('/(main)/(modals)/me'); }}
            style={styles.heroGear}
            hitSlop={8}
          >
            <MaterialIcons name="settings" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.heroCenter}>
            <Text style={styles.heroStageNum}>Stage {stage} of {GEM_STAGE_COUNT}</Text>
            <Text style={styles.heroStageName}>{STAGE_NAMES[stage - 1]}</Text>
            <Text style={styles.heroTotal}>{total} gems</Text>
          </View>
        </View>

        {/* ---- six-stage milestone timeline ---- */}
        <View style={styles.timeline}>
          {milestones.map((label, i) => {
            const stageNo = i + 1;
            const passed = stage > stageNo || (stageNo === GEM_STAGE_COUNT && stage === GEM_STAGE_COUNT);
            const current = stage === stageNo && !passed;
            return (
              <View key={label} style={styles.timelineNodeWrap}>
                {i > 0 && (
                  <View style={[styles.timelineLink, (passed || current) && styles.timelineLinkOn]} />
                )}
                <View
                  style={[
                    styles.timelineNode,
                    passed && styles.timelineNodeDone,
                    current && styles.timelineNodeCurrent,
                  ]}
                >
                  {passed ? (
                    <MaterialIcons name="check" size={14} color="#FFFFFF" />
                  ) : (
                    <View style={styles.timelineNodeDot} />
                  )}
                </View>
                <Text style={[styles.timelineLabel, current && styles.timelineLabelCurrent]}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ---- 8 dimension tiles ---- */}
        <View style={styles.grid}>
          {DIMENSION_IDS.map((d) => (
            <View key={d} style={styles.cell}>
              <View style={styles.dimTile}>
                <Text style={styles.dimEmoji}>{DIMENSION_EMOJI[d] ?? '💠'}</Text>
              </View>
              <Text style={styles.dimName}>{DIMENSIONS[d].nameEn}</Text>
              <Text style={styles.dimScore}>{'⚡'} {gems[d] ?? 0}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6EBD3' },
  scroll: { paddingBottom: 24 },

  hero: {
    height: 300, marginBottom: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  heroBanner: {
    position: 'absolute', top: 12, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#4A3220', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9,
  },
  heroBannerEmoji: { fontSize: 16 },
  heroBannerText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  heroGear: {
    position: 'absolute', top: 12, right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  heroCenter: { alignItems: 'center', gap: 4 },
  heroStageNum: { fontSize: 15, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.75)' },
  heroStageName: { fontSize: 32, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  heroTotal: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  timeline: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 18, marginBottom: 18,
  },
  timelineNodeWrap: { alignItems: 'center', flex: 1 },
  timelineLink: {
    position: 'absolute', top: 12, right: '50%', left: '-50%',
    height: 3, backgroundColor: '#E4D2B0',
  },
  timelineLinkOn: { backgroundColor: '#E58A7E' },
  timelineNode: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#E4D2B0', alignItems: 'center', justifyContent: 'center',
  },
  timelineNodeDone: { backgroundColor: '#E58A7E' },
  timelineNodeCurrent: { backgroundColor: '#E58A7E', borderWidth: 3, borderColor: '#4A3220' },
  timelineNodeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  timelineLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#6B5A45', marginTop: 6 },
  timelineLabelCurrent: { color: '#4A3220', fontSize: 13 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, justifyContent: 'space-between',
  },
  cell: { width: '23%', alignItems: 'center', marginBottom: 18 },
  dimTile: {
    width: '100%', aspectRatio: 0.9, borderRadius: 14, backgroundColor: '#4A4A52',
    alignItems: 'center', justifyContent: 'center',
  },
  dimEmoji: { fontSize: 30 },
  dimName: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', marginTop: 7, textAlign: 'center' },
  dimScore: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#6B5A45', marginTop: 2 },
});
