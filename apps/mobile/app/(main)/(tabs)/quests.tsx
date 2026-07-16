import { useCallback, useMemo, useState } from 'react';
import {
  Alert, Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { themesForScope, type QuestTheme } from '@novame/domain';

import { ICONS } from '@/lib/icons';
import { fetchQuestStatus, getCachedStatus, type QuestStatus } from '@/lib/quests-api';

type Scope = 'self' | 'friend';

// Real illustrated theme icons (assets/Icons) + an accent color per theme.
const THEME_ART: Record<string, { icon: ImageSourcePropType; color: string }> = {
  custom: { icon: ICONS.ThemeCustom, color: '#8B7FD9' },
  fitness: { icon: ICONS.ThemeFitness, color: '#2E5CB8' },
  weight_loss: { icon: ICONS.ThemeWeightLoss, color: '#E8899B' },
  study: { icon: ICONS.ThemeStudy, color: '#5AA469' },
  work: { icon: ICONS.ThemeWork, color: '#8A6D4B' },
  parenting: { icon: ICONS.ThemeParenting, color: '#E0A94E' },
  water: { icon: ICONS.ThemeWater, color: '#6BA3D6' },
  mindfulness: { icon: ICONS.ThemeMindfulness, color: '#C9993E' },
  write_own: { icon: ICONS.ThemeWriteOwn, color: '#7BB661' },
};
const FALLBACK_ART = { icon: ICONS.ThemeCustom, color: '#E0A94E' };

/**
 * Weekly Quests -- the quest picker (replaces the old Skills tab; the skill
 * cards now live in the companion sheet). No active plan -> pick a theme (Self
 * or Friend). An active plan -> the 7-day checklist (built next; shown here as a
 * summary placeholder). Warm flat theme to match the Home art; a short banner
 * slot is reserved up top for the Quests banner art.
 */
export default function QuestsScreen() {
  const [scope, setScope] = useState<Scope>('self');
  const [status, setStatus] = useState<QuestStatus>(() => getCachedStatus());

  useFocusEffect(
    useCallback(() => {
      void fetchQuestStatus().then(setStatus);
    }, []),
  );

  const themes = useMemo(() => themesForScope(scope), [scope]);
  const custom = themes.find((t) => t.isCustom);
  const standard = themes.filter((t) => !t.isCustom);

  function onPickTheme(theme: QuestTheme) {
    // Step 5 wires this to the 20-task picker -> pick 7 -> start.
    Alert.alert(theme.title, 'The task picker is coming in the next step.');
  }

  if (status.active && status.plan) {
    const p = status.plan;
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>7-Day Daily Plan</Text>
        </View>
        <View style={styles.activeCard}>
          <Text style={styles.activeTitle}>{p.title}</Text>
          <Text style={styles.activeDay}>Day {p.day}/7</Text>
          <Text style={styles.activeNote}>The daily checklist is coming in the next step.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Short banner art drops in here when ready. */}
        <View style={styles.bannerSlot} />

        <View style={styles.header}>
          <Text style={styles.title}>Weekly Quests</Text>
          <Text style={styles.subtitle}>Select your main goal of the week, finish and get rewards!</Text>
        </View>

        <View style={styles.toggle}>
          {(['self', 'friend'] as Scope[]).map((s) => {
            const active = scope === s;
            return (
              <Pressable key={s} onPress={() => setScope(s)} style={[styles.toggleBtn, active && styles.toggleBtnActive]}>
                <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
                  {s === 'self' ? 'Self Quests' : 'Friend Quests'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {custom && (
          <Pressable onPress={() => onPickTheme(custom)} style={styles.customCard}>
            <Image source={THEME_ART.custom.icon} style={styles.themeIcon} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <View style={styles.customTitleRow}>
                <Text style={styles.themeTitle}>{custom.title}</Text>
                <View style={styles.plusPill}>
                  <MaterialIcons name="workspace-premium" size={12} color="#FFFFFF" />
                  <Text style={styles.plusText}>PLUS</Text>
                </View>
              </View>
              <Text style={styles.themeSubtitle}>{custom.subtitle}</Text>
            </View>
          </Pressable>
        )}

        <Text style={styles.hint}>Choose 1 theme  ·  20 tasks inside  ·  pick 7 for the next 7 days</Text>

        {standard.map((theme) => {
          const art = THEME_ART[theme.key] ?? FALLBACK_ART;
          const isStart = !!theme.isWriteOwn;
          return (
            <View key={theme.key} style={styles.themeCard}>
              <Image source={art.icon} style={styles.themeIcon} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={styles.themeTitle}>{theme.title}</Text>
                <Text style={styles.themeSubtitle}>{theme.subtitle}</Text>
              </View>
              <Pressable onPress={() => onPickTheme(theme)} style={[styles.themeBtn, { backgroundColor: art.color }]}>
                <Text style={styles.themeBtnText}>{isStart ? 'Start' : 'Preview'}</Text>
              </Pressable>
            </View>
          );
        })}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const CREAM = '#FBF3E6';
const CARD = '#FFFFFF';
const TEXT = '#4A3B2A';
const MUTED = '#9A8A76';
const ORANGE = '#F2A03D';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  scroll: { paddingHorizontal: 16, paddingBottom: 16 },

  bannerSlot: { height: 96, borderRadius: 18, backgroundColor: '#F0E4D0', marginTop: 4, marginBottom: 16, overflow: 'hidden' },

  header: { paddingBottom: 14, paddingHorizontal: 4 },
  title: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 6 },

  toggle: { flexDirection: 'row', backgroundColor: '#EFE4D2', borderRadius: 26, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 22, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: ORANGE },
  toggleText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#8A7A64' },
  toggleTextActive: { color: '#FFFFFF' },

  customCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD, borderRadius: 18,
    padding: 16, marginBottom: 14, borderWidth: 1.5, borderColor: '#EBD9F5',
  },
  customTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: ORANGE,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  plusText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', letterSpacing: 0.5 },

  hint: { fontSize: 12.5, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center', marginBottom: 14 },

  themeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD, borderRadius: 18,
    padding: 14, marginBottom: 12,
  },
  themeIcon: { width: 46, height: 46 },
  themeTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  themeSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  themeBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  themeBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  activeCard: { backgroundColor: CARD, borderRadius: 18, padding: 20, marginHorizontal: 16, gap: 6 },
  activeTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  activeDay: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: ORANGE },
  activeNote: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },
});
