import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { themesForScope, type QuestTheme } from '@novame/domain';

import { ICONS } from '@/lib/icons';
import { fetchCosmetics, getCachedCosmetics } from '@/lib/cosmetics-api';
import { checkTask, fetchQuestStatus, getCachedStatus, type QuestStatus } from '@/lib/quests-api';

type Scope = 'self' | 'friend';

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
 * Weekly Quests. No active plan -> theme picker (Self/Friend). An active plan ->
 * the 7-day checklist: tapping a task completes it (one per calendar day, pays
 * clovers) and folds it into a collapsed "Completed" group at the top; all seven
 * pay a completion bonus. Warm flat theme to match the Home art.
 */
export default function QuestsScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('self');
  const [status, setStatus] = useState<QuestStatus>(() => getCachedStatus());
  const [balance, setBalance] = useState<number>(() => getCachedCosmetics().balance);
  const [checking, setChecking] = useState<number | null>(null);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchQuestStatus().then(setStatus);
      void fetchCosmetics().then((s) => setBalance(s.balance));
    }, []),
  );

  const themes = useMemo(() => themesForScope(scope), [scope]);
  const custom = themes.find((t) => t.isCustom);
  const standard = themes.filter((t) => !t.isCustom);

  function onPickTheme(theme: QuestTheme) {
    // Friend co-op plans (shared progress, invites) arrive with the friends
    // backend (P4). Until then, starting one would silently create a solo plan
    // that claims to be shared — block with an honest notice instead.
    if (scope === 'friend') {
      Alert.alert('Almost here', 'Friend quests are coming in the next update. Try a self quest for now!');
      return;
    }
    if (theme.isCustom) {
      router.push('/(main)/quest-custom' as never);
      return;
    }
    if (theme.isWriteOwn) {
      router.push('/(main)/quest-write-own' as never);
      return;
    }
    router.push({ pathname: '/(main)/quest-pick', params: { themeKey: theme.key } });
  }

  async function onCheck(index: number) {
    if (!status.plan || checking !== null) return;
    if (status.plan.checkedToday) {
      Alert.alert('Come back tomorrow', 'You can complete one task per day.');
      return;
    }
    setChecking(index);
    const res = await checkTask(index);
    setChecking(null);
    if (!res.ok) {
      if (res.error === 'already_checked_today') {
        Alert.alert('Come back tomorrow', 'You can complete one task per day.');
      } else {
        Alert.alert('Could not complete that', 'Please try again.');
      }
      return;
    }
    void fetchCosmetics().then((s) => setBalance(s.balance));
    if (res.allDone) {
      Alert.alert('Plan complete!', `You earned ${res.cloversEarned} clovers.`);
      void fetchQuestStatus().then(setStatus);
      return;
    }
    setStatus((cur) => {
      if (!cur.plan) return cur;
      const tasks = cur.plan.tasks.map((t, i) => (i === index ? { ...t, done: true } : t));
      return { ...cur, plan: { ...cur.plan, tasks, checkedToday: true, checkedCount: res.checkedCount } };
    });
  }

  // ---- Active plan: 7-day checklist ----
  if (status.active && status.plan) {
    const p = status.plan;
    const art = THEME_ART[p.themeKey] ?? FALLBACK_ART;
    const total = p.tasks.length || 7;
    const pct = Math.round((p.checkedCount / total) * 100);
    const indexed = p.tasks.map((t, i) => ({ t, i }));
    const done = indexed.filter((x) => x.t.done);
    const todo = indexed.filter((x) => !x.t.done);
    const canCheck = !p.checkedToday && checking === null;

    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.bannerSlot} />
          <View style={styles.header}>
            <Text style={styles.title}>7-Day Daily Plan</Text>
          </View>

          <View style={styles.planCard}>
            <Image source={art.icon} style={styles.planIcon} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <View style={styles.planTopRow}>
                <Text style={styles.planTitle}>{p.title}</Text>
                <View style={styles.balancePill}>
                  <Text style={styles.balanceNum}>{balance}</Text>
                  <Image source={ICONS.Clover} style={styles.cloverSm} resizeMode="contain" />
                </View>
              </View>
              <Text style={styles.planDay}>Day {p.day}/7</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.planBonus}>Complete all 7 days to earn 120 clovers</Text>
            </View>
          </View>

          {done.length > 0 && (
            <>
              <Pressable onPress={() => setCompletedExpanded((v) => !v)} style={styles.completedHeader}>
                <MaterialIcons name={completedExpanded ? 'expand-more' : 'chevron-right'} size={22} color={MUTED} />
                <Text style={styles.completedTitle}>Completed</Text>
                <View style={styles.completedCount}>
                  <Text style={styles.completedCountText}>{done.length}</Text>
                </View>
              </Pressable>
              {completedExpanded &&
                done.map(({ t, i }) => (
                  <View key={i} style={styles.doneRow}>
                    <Text style={styles.doneText}>{t.text}</Text>
                    <View style={styles.doneCheck}>
                      <MaterialIcons name="check" size={18} color="#FFFFFF" />
                    </View>
                  </View>
                ))}
            </>
          )}

          {todo.map(({ t, i }) => (
            <View key={i} style={styles.taskRow}>
              <Text style={styles.taskText}>{t.text}</Text>
              <View style={styles.rewardWrap}>
                <Text style={styles.rewardNum}>{t.reward}</Text>
                <Image source={ICONS.Clover} style={styles.cloverSm} resizeMode="contain" />
              </View>
              <Pressable
                onPress={() => onCheck(i)}
                disabled={!canCheck}
                style={[styles.checkBtn, canCheck ? styles.checkBtnReady : styles.checkBtnLocked]}
              >
                {checking === i ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialIcons name="check" size={22} color={canCheck ? '#FFFFFF' : '#C9BCA6'} />
                )}
              </Pressable>
            </View>
          ))}

          <Text style={styles.editHint}>You can edit your plan anytime.</Text>
          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- No active plan: theme picker ----
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
const GREEN = '#5AA469';

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

  planCard: { flexDirection: 'row', gap: 14, backgroundColor: CARD, borderRadius: 18, padding: 16, marginBottom: 14 },
  planIcon: { width: 52, height: 52 },
  planTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitle: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: TEXT, flex: 1 },
  balancePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  balanceNum: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  planDay: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED, marginTop: 2, marginBottom: 8 },
  progressTrack: { height: 10, borderRadius: 6, backgroundColor: '#EAE0CF', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6, backgroundColor: GREEN },
  planBonus: { fontSize: 12.5, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 8 },

  completedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 4, marginBottom: 2 },
  completedTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: MUTED },
  completedCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#E6DAC6', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  completedCountText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#7A6A52' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F5EEE0', borderRadius: 16, padding: 14, marginBottom: 10 },
  doneText: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED, textDecorationLine: 'line-through' },
  doneCheck: { width: 30, height: 30, borderRadius: 9, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },

  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderRadius: 16, padding: 14, marginBottom: 10 },
  taskText: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: TEXT, lineHeight: 21 },
  rewardWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rewardNum: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  cloverSm: { width: 18, height: 18 },
  checkBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  checkBtnReady: { backgroundColor: GREEN },
  checkBtnLocked: { backgroundColor: '#F0EADF', borderWidth: 2, borderColor: '#E0D5C2' },

  editHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginTop: 6 },
});
