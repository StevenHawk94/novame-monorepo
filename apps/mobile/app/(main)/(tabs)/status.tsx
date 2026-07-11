import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DIMENSION_IDS, DIMENSIONS, type DimensionId } from '@novame/domain';
import { gemStage, GEM_STAGE_COUNT } from '@novame/engine';
import { useTheme } from '../../../src/theme/use-theme';
import {
  fetchGems,
  getCachedGems,
  totalGems,
  type GemsByDimension,
} from '../../../src/lib/status-api';

const STAGE_NAMES = ['Exploring', 'Growing', 'Maturing', 'Confident', 'Complete'];

export default function StatusScreen() {
  const { theme } = useTheme();
  const c = theme.colors;

  // Cache-first: render immediately from cache, then refresh from server.
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

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bgPrimary }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.header, { color: c.textPrimary }]}>Growth</Text>

        {/* ---- portrait (placeholder until art lands) ---- */}
        <View style={[styles.portrait, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <Text style={[styles.portraitStage, { color: c.textMuted }]}>Stage {stage}</Text>
          <Text style={[styles.portraitName, { color: c.textSecondary }]}>
            {STAGE_NAMES[stage - 1]}
          </Text>
        </View>

        {/* ---- total + stage progress ---- */}
        <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: c.textSecondary }]}>Total gems</Text>
            <Text style={[styles.totalValue, { color: c.textPrimary }]}>{total}</Text>
          </View>
          <View style={styles.stageRow}>
            {Array.from({ length: GEM_STAGE_COUNT }, (_, i) => i + 1).map((s) => (
              <View key={s} style={styles.stageNode}>
                <View
                  style={[
                    styles.stageDot,
                    {
                      backgroundColor: s <= stage ? c.brand.primary : c.progressTrack,
                      borderColor: s === stage ? c.brand.primary : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.stageDotText,
                      { color: s <= stage ? '#FFFFFF' : c.textMuted },
                    ]}
                  >
                    {s}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={[styles.stageCaption, { color: c.textMuted }]}>
            Stage {stage} of {GEM_STAGE_COUNT}
          </Text>
        </View>

        {/* ---- eight-dimension gems ---- */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Growth gems</Text>
        <View style={styles.grid}>
          {DIMENSION_IDS.map((id: DimensionId) => {
            const dim = DIMENSIONS[id];
            return (
              <View
                key={id}
                style={[styles.gemCard, { backgroundColor: c.bgCard, borderColor: c.border }]}
              >
                <View style={[styles.gemDot, { backgroundColor: dim.color }]} />
                <View style={styles.gemInfo}>
                  <Text style={[styles.gemName, { color: c.textPrimary }]}>{dim.nameEn}</Text>
                  <Text style={[styles.gemValue, { color: c.textSecondary }]}>
                    {gems[id]} gems
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.footer, { color: c.textMuted }]}>
          Every reflection adds a little. Keep going.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { fontSize: 28, fontFamily: 'Inter_700Bold', marginTop: 8, marginBottom: 16 },

  portrait: {
    height: 220,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  portraitStage: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  portraitName: { fontSize: 20, fontFamily: 'Inter_600SemiBold' },

  card: { borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 24 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  totalLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  totalValue: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  stageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stageNode: { alignItems: 'center' },
  stageDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageDotText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  stageCaption: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 14 },

  sectionTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gemCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  gemDot: { width: 32, height: 32, borderRadius: 16, marginRight: 12 },
  gemInfo: { flex: 1 },
  gemName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  gemValue: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },

  footer: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 16 },
});
