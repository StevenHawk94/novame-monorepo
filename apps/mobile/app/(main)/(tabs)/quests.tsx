import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { themesForScope, type QuestTheme } from '@novame/domain';

import { ICONS } from '@/lib/icons';
import { OffsetCard } from '@/components/ui/offset-card';
import { fetchCosmetics, getCachedCosmetics } from '@/lib/cosmetics-api';
import { checkTask, fetchQuestStatus, getCachedStatus, type QuestStatus } from '@/lib/quests-api';

type Scope = 'self' | 'friend';

const THEME_ART: Record<string, { icon: ImageSourcePropType; color: string }> = {
  custom: { icon: ICONS.ThemeCustom, color: '#8B7FD9' },
  fitness: { icon: ICONS.ThemeFitness, color: '#4D9DE8' },
  weight_loss: { icon: ICONS.ThemeWeightLoss, color: '#F2A0AC' },
  study: { icon: ICONS.ThemeStudy, color: '#5AA469' },
  work: { icon: ICONS.ThemeWork, color: '#8A6D4B' },
  parenting: { icon: ICONS.ThemeParenting, color: '#F2C14E' },
  water: { icon: ICONS.ThemeWater, color: '#6BA3D6' },
  mindfulness: { icon: ICONS.ThemeMindfulness, color: '#C9993E' },
  write_own: { icon: ICONS.ThemeWriteOwn, color: '#7BB661' },
};
const FALLBACK_ART = { icon: ICONS.ThemeCustom, color: '#F2C14E' };

/**
 * Weekly Quests (design 2026-07-23: mock layout on the app's dark-brown
 * ground; white offset cards as on Reflect, macaron accent per theme).
 * No active plan -> theme picker (Self/Friend). An active plan -> the 7-day
 * checklist: tapping a task completes it (one per calendar day, pays clovers)
 * and folds it into a collapsed "Completed" group at the top; all seven pay a
 * completion bonus.
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
      appAlert('Almost here', 'Friend quests are coming in the next update. Try a self quest for now!');
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
      appAlert('Come back tomorrow', 'You can complete one task per day.');
      return;
    }
    setChecking(index);
    const res = await checkTask(index);
    setChecking(null);
    if (!res.ok) {
      if (res.error === 'already_checked_today') {
        appAlert('Come back tomorrow', 'You can complete one task per day.');
      } else {
        appAlert('Could not complete that', 'Please try again.');
      }
      return;
    }
    void fetchCosmetics().then((s) => setBalance(s.balance));
    if (res.allDone) {
      appAlert('Plan complete!', `You earned ${res.cloversEarned} clovers.`);
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
          <View style={styles.header}>
            <Text style={styles.title}>7-Day Daily Plan</Text>
          </View>

          <OffsetCard color={OFFSET} offset={4} radius={20} cardStyle={styles.planCard} style={styles.cardGap}>
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
          </OffsetCard>

          {done.length > 0 && (
            <>
              <Pressable onPress={() => setCompletedExpanded((v) => !v)} style={styles.completedHeader}>
                <MaterialIcons name={completedExpanded ? 'expand-more' : 'chevron-right'} size={22} color={CREAM_MUTED} />
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
            <OffsetCard key={i} color={OFFSET} offset={4} radius={18} cardStyle={styles.taskRow} style={styles.rowGap}>
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
            </OffsetCard>
          ))}

          <Text style={styles.editHint}>You can edit your plan anytime.</Text>
          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- No active plan: theme picker ----
  // Self keeps the dark-brown ground; Friend flips the page to warm cream
  // (design call 2026-07-29), so text and card shadows adapt per scope.
  const isSelf = scope === 'self';
  const pageBg = isSelf ? BG : CREAM_BG;
  const cardOffset = isSelf ? OFFSET : CREAM_OFFSET;
  const titleColor = isSelf ? CREAM : INK;
  const mutedColor = isSelf ? CREAM_MUTED : '#8A7A63';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: pageBg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: titleColor }]}>Weekly Quests</Text>
          <Text style={[styles.subtitle, { color: mutedColor }]}>
            {isSelf
              ? 'Select your main goal of the week, finish and get rewards!'
              : 'Select the shared goal of the week and finish together!'}
          </Text>
        </View>

        {/* Self / Friend toggle: white pill strip, active segment dark brown */}
        <OffsetCard color={cardOffset} offset={4} radius={26} cardStyle={styles.toggle} style={styles.cardGap}>
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
        </OffsetCard>

        {custom && (
          <OffsetCard
            color={cardOffset}
            offset={4}
            radius={20}
            onPress={() => onPickTheme(custom)}
            cardStyle={styles.customCard}
            style={styles.cardGap}
          >
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
          </OffsetCard>
        )}

        <Text style={[styles.hint, { color: mutedColor }]}>Choose 1 theme  ·  20 tasks inside  ·  pick 7 for the next 7 days</Text>

        {standard.map((theme) => {
          const art = THEME_ART[theme.key] ?? FALLBACK_ART;
          const isStart = !!theme.isWriteOwn;
          return (
            <OffsetCard key={theme.key} color={cardOffset} offset={4} radius={20} cardStyle={styles.themeCard} style={styles.rowGap}>
              <Image source={art.icon} style={styles.themeIcon} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={styles.themeTitle}>{theme.title}</Text>
                <Text style={styles.themeSubtitle}>{theme.subtitle}</Text>
              </View>
              <Pressable onPress={() => onPickTheme(theme)} style={[styles.themeBtn, { backgroundColor: art.color }]}>
                <Text style={styles.themeBtnText}>{isStart ? 'Start' : 'Preview'}</Text>
              </Pressable>
            </OffsetCard>
          );
        })}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Dark-brown ground (user call 2026-07-23) + darker offset drop; white faces.
// Friend Quests picker flips to warm cream with a tan offset (2026-07-29).
const BG = '#4C331B';
const OFFSET = '#33220F';
const CREAM_BG = '#FFF6E8';
const CREAM_OFFSET = '#E5B57E';
const CARD = '#FFFFFF';
const TEXT = '#4A3B2A';
const MUTED = '#9A8A76';
const CREAM = '#FFF6E8';
const CREAM_MUTED = 'rgba(255,246,232,0.75)';
const ORANGE = '#F2A03D';
const GREEN = '#5AA469';
const INK = '#4A3423';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 16, paddingBottom: 16 },
  header: { paddingTop: 12, paddingBottom: 14, paddingHorizontal: 4 },
  title: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: CREAM },
  subtitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, marginTop: 6 },

  cardGap: { marginBottom: 12 },
  rowGap: { marginBottom: 8 },

  toggle: { flexDirection: 'row', backgroundColor: CARD, padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 22, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: INK },
  toggleText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#8A7A64' },
  toggleTextActive: { color: '#FFFFFF' },

  customCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD, padding: 16 },
  customTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: ORANGE,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  plusText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', letterSpacing: 0.5 },

  hint: { fontSize: 12.5, fontFamily: 'Inter_600SemiBold', color: CREAM_MUTED, textAlign: 'center', marginBottom: 14, marginTop: 4 },

  themeCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD, padding: 14 },
  themeIcon: { width: 46, height: 46 },
  themeTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  themeSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  themeBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  themeBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  planCard: { flexDirection: 'row', gap: 14, backgroundColor: CARD, padding: 16 },
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
  completedTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: CREAM_MUTED },
  completedCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,246,232,0.2)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  completedCountText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: CREAM },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,246,232,0.14)', borderRadius: 16, padding: 14, marginBottom: 10 },
  doneText: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, textDecorationLine: 'line-through' },
  doneCheck: { width: 30, height: 30, borderRadius: 9, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },

  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, padding: 14 },
  taskText: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: TEXT, lineHeight: 21 },
  rewardWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rewardNum: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: TEXT },
  cloverSm: { width: 18, height: 18 },
  checkBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  checkBtnReady: { backgroundColor: GREEN },
  checkBtnLocked: { backgroundColor: '#F0EADF', borderWidth: 2, borderColor: '#E0D5C2' },

  editHint: { fontSize: 13, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, textAlign: 'center', marginTop: 6 },
});
