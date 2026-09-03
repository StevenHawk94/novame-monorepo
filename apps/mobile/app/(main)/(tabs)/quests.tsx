import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { CLOVERS_PER_TASK, COMPLETION_BONUS, themesForScope, type QuestTheme } from '@novame/domain';

import { ICONS } from '@/lib/icons';
import { OffsetCard } from '@/components/ui/offset-card';
import { androidTabHeaderTypography } from '@/components/ui/tab-header-typography';
import { GridBackground } from '@/components/ui/grid-background';
import { CloverBurst } from '@/components/main/clover-burst';
import { ReflectCelebration } from '@/components/main/reflect-celebration';
import { FeatureGuideModal } from '@/components/main/feature-guide-modal';
import { haptics } from '@/lib/haptics';
import { useCompletionSound } from '@/lib/use-completion-sound';
import { optimisticCloverAward } from '@/lib/cosmetics-api';
import { sessionEpoch } from '@/lib/session-lifecycle';
import {
  checkTask,
  cacheQuestStatus,
  fetchQuestStatus,
  getCachedCustomTasks,
  getCachedStatus,
  type QuestStatus,
} from '@/lib/quests-api';


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
const QUEST_CELEBRATION_SOURCE = require('../../../assets/animations/quest-dense.json');

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
  const { play: playCompletionSound } = useCompletionSound();
  const [status, setStatus] = useState<QuestStatus>(() => getCachedStatus());
  // Optimistic check-off (2026-08-07): the row completes instantly with
  // confetti; the server call reconciles silently in the background.
  const [celebrationRun, setCelebrationRun] = useState({ key: 0, active: false });
  const [rewardRun, setRewardRun] = useState<{ key: number; taskAmount: number; bonusAmount: number } | null>(null);
  const celebrationPlaying = useRef(false);
  const celebrationKey = useRef(0);
  const rewardKey = useRef(0);
  const screenActive = useRef(true);
  const pendingPlanReward = useRef<number | null>(null);
  const checkInFlight = useRef(false);
  const statusRevision = useRef(0);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      screenActive.current = true;
      const revision = statusRevision.current;
      const epoch = sessionEpoch();
      void fetchQuestStatus().then((next) => {
        if (screenActive.current && epoch === sessionEpoch() && revision === statusRevision.current) setStatus(next);
      });
      return () => {
        screenActive.current = false;
        pendingPlanReward.current = null;
        // A tab is retained, not unmounted. Consume its visual event on exit;
        // returning to Quests must never replay a previous task completion.
        celebrationPlaying.current = false;
        celebrationKey.current += 1;
        setCelebrationRun({ key: celebrationKey.current, active: false });
        rewardKey.current += 1;
        setRewardRun(null);
      };
    }, []),
  );


  const themes = useMemo(() => themesForScope('self'), []);
  const custom = themes.find((t) => t.isCustom);
  const standard = themes.filter((t) => !t.isCustom);

  function onPickTheme(theme: QuestTheme) {
    void haptics.pageOpen();
    if (theme.isCustom) {
      const cachedTasks = getCachedCustomTasks();
      if (cachedTasks?.length) {
        router.push({
          pathname: '/(main)/quest-pick',
          params: {
            themeKey: 'custom',
            title: 'My Custom Plan',
            tasksJson: JSON.stringify(cachedTasks),
          },
        });
        return;
      }
      router.push('/(main)/quest-custom' as never);
      return;
    }
    if (theme.isWriteOwn) {
      router.push('/(main)/quest-write-own' as never);
      return;
    }
    router.push({ pathname: '/(main)/quest-pick', params: { themeKey: theme.key } });
  }

  function onCheck(index: number) {
    if (!status.plan || checkInFlight.current) return;
    if (status.plan.checkedToday) {
      appAlert('Come back tomorrow', 'You can complete one task per day.');
      return;
    }
    checkInFlight.current = true;
    const epoch = sessionEpoch();
    statusRevision.current += 1;

    // Optimistic: complete the row NOW — confetti, haptic, +clovers.
    void haptics.success();
    playCompletionSound();
    if (celebrationPlaying.current) celebrationKey.current += 1;
    celebrationPlaying.current = true;
    // Reveal the preloaded composition; a retry during a running effect gets
    // a fresh run without allowing the old completion callback to stop it.
    setCelebrationRun({ key: celebrationKey.current, active: true });
    const prevStatus = status;
    const finishingPlan = status.plan.checkedCount + 1 === status.plan.tasks.length;
    const taskReward = status.plan.tasks[index]?.reward ?? CLOVERS_PER_TASK;
    rewardKey.current += 1;
    const currentRewardKey = rewardKey.current;
    setRewardRun({
      key: currentRewardKey,
      taskAmount: taskReward,
      bonusAmount: finishingPlan ? COMPLETION_BONUS : 0,
    });
    const expectedAward = taskReward + (finishingPlan ? COMPLETION_BONUS : 0);
    const award = optimisticCloverAward(expectedAward);
    const tasks = status.plan.tasks.map((t, i) => (i === index ? { ...t, done: true } : t));
    const optimisticStatus: QuestStatus = {
      ...status,
      plan: {
        ...status.plan,
        tasks,
        checkedToday: true,
        checkedCount: status.plan.checkedCount + 1,
      },
    };
    setStatus(optimisticStatus);
    cacheQuestStatus(optimisticStatus);
    // Background reconcile: confirm with the server, roll back on rejection.
    void (async () => {
      try {
      const res = await checkTask(index);
      if (epoch !== sessionEpoch()) return;
      if (!res.ok) {
        setStatus(prevStatus);
        cacheQuestStatus(prevStatus);
        award.rollback();
        // A transport error can mean the server committed but the response
        // was lost. Re-read once so the first tap still converges to the
        // authoritative completed state without asking the user to retry.
        const revision = statusRevision.current;
        const authoritative = await fetchQuestStatus({ force: true });
        if (epoch !== sessionEpoch()) return;
        if (revision === statusRevision.current) setStatus(authoritative);
        const serverConfirmed = !!authoritative.plan?.tasks[index]?.done
          || (finishingPlan && !authoritative.active);
        checkInFlight.current = false;
        if (serverConfirmed) return;
        setRewardRun((current) => current?.key === currentRewardKey ? null : current);
        if (!screenActive.current) return;
        if (res.error === 'already_checked_today') {
          appAlert('Come back tomorrow', 'You can complete one task per day.');
        } else {
          appAlert('Could not complete that', 'Please check your connection and try again.');
        }
        return;
      }
      checkInFlight.current = false;
      award.commit(res.cloversEarned);
      if (res.allDone) {
        // Commit the reward immediately, but don't cover the falling confetti
        // with a dialog when a fast response completes the seventh task.
        if (screenActive.current) {
          if (celebrationPlaying.current) pendingPlanReward.current = res.cloversEarned;
          else appAlert('Plan complete!', `You earned ${res.cloversEarned} clovers.`);
        }
        void fetchQuestStatus({ force: true }).then(next => { if (epoch === sessionEpoch()) setStatus(next); });
        return;
      }
      // Align the count with the server's authoritative value.
      const confirmedStatus: QuestStatus = {
        ...optimisticStatus,
        plan: { ...optimisticStatus.plan!, checkedCount: res.checkedCount },
      };
      cacheQuestStatus(confirmedStatus);
      setStatus(confirmedStatus);
      } catch (error) {
        if (epoch !== sessionEpoch()) return;
        award.rollback();
        setStatus(prevStatus);
        cacheQuestStatus(prevStatus);
        setRewardRun((current) => current?.key === currentRewardKey ? null : current);
        if (screenActive.current) appAlert('Could not complete that', 'Please check your connection and try again.');
        console.warn('[quests] completion failed:', error);
      } finally {
        checkInFlight.current = false;
      }
    })();
  }

  // Same keyed sibling in BOTH page states. Finishing the seventh task may
  // switch to the picker while paper is still falling; don't unmount it.
  const celebration = (
    <View key="quest-celebration" style={styles.celebration} pointerEvents="none">
      <ReflectCelebration key={celebrationRun.key} active={celebrationRun.active} source={QUEST_CELEBRATION_SOURCE}
        onComplete={() => {
          if (!celebrationPlaying.current || celebrationKey.current !== celebrationRun.key) return;
          celebrationPlaying.current = false;
          celebrationKey.current += 1;
          setCelebrationRun({ key: celebrationKey.current, active: false });
          if (pendingPlanReward.current !== null && screenActive.current) {
            const reward = pendingPlanReward.current;
            pendingPlanReward.current = null;
            appAlert('Plan complete!', `You earned ${reward} clovers.`);
          }
        }} />
    </View>
  );

  // Match the reward language used by Small Wins and New Lens. On day seven,
  // keep the task reward and the weekly bonus as two distinct animations so
  // neither award is hidden inside a combined total.
  const rewardAnimation = useMemo(() => {
    if (!rewardRun) return null;
    const finish = () => {
      setRewardRun((current) => current?.key === rewardRun.key ? null : current);
    };
    return (
      <View key={`quest-reward-${rewardRun.key}`} style={styles.rewardOverlay} pointerEvents="none">
        <View style={styles.rewardBurstStack}>
          <CloverBurst
            key={`quest-task-reward-${rewardRun.key}`}
            amount={rewardRun.taskAmount}
            onDone={rewardRun.bonusAmount > 0 ? undefined : finish}
          />
          {rewardRun.bonusAmount > 0 && (
            <CloverBurst
              key={`quest-bonus-reward-${rewardRun.key}`}
              amount={rewardRun.bonusAmount}
              onDone={finish}
            />
          )}
        </View>
      </View>
    );
  }, [rewardRun]);

  // ---- Active plan: 7-day checklist ----
  if (status.active && status.plan) {
    const p = status.plan;
    const art = THEME_ART[p.themeKey] ?? FALLBACK_ART;
    const total = p.tasks.length || 7;
    const pct = Math.round((p.checkedCount / total) * 100);
    const indexed = p.tasks.map((t, i) => ({ t, i }));
    const done = indexed.filter((x) => x.t.done);
    const todo = indexed.filter((x) => !x.t.done);
    const canCheck = !p.checkedToday;

    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <GridBackground base={BG} line="#654A31" cell={22} lineWidth={1.2} />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>7-Day Daily Plan</Text>
              <Image source={ICONS.weekPlan} style={styles.titleIcon} resizeMode="contain" />
            </View>
          </View>

          <OffsetCard color={OFFSET} offset={4} radius={20} cardStyle={styles.planCard} style={styles.cardGap}>
            <Image source={art.icon} style={styles.planIcon} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <View style={styles.planTopRow}>
                <Text style={styles.planTitle}>{p.title}</Text>
                <View style={styles.balancePill}>
                  <Text style={styles.balanceNum}>{COMPLETION_BONUS}</Text>
                  <Image source={ICONS.Clover} style={styles.cloverSm} resizeMode="contain" />
                </View>
              </View>
              <Text style={styles.planDay}>Day {p.day}/7</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.planBonus}>Complete all 7 days to earn {COMPLETION_BONUS} clovers</Text>
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
                <MaterialIcons name="check" size={22} color={canCheck ? '#FFFFFF' : '#C9BCA6'} />
              </Pressable>
            </OffsetCard>
          ))}

          <View style={{ height: 24 }} />
        </ScrollView>
        {celebration}
        {rewardAnimation}
        <FeatureGuideModal guide="quests" />
      </SafeAreaView>
    );
  }

  // ---- No active plan: theme picker (Self only, 2026-08-06 — the Friend
  // scope and its toggle are gone; water/mindfulness moved into Self). ----
  const pageBg = BG;
  const cardOffset = OFFSET;
  const titleColor = CREAM;
  const mutedColor = CREAM_MUTED;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: pageBg }]} edges={['top']}>
      <GridBackground base={BG} line="#654A31" cell={22} lineWidth={1.2} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: titleColor }]}>Weekly Quests</Text>
            <Image source={ICONS.weekPlan} style={styles.titleIcon} resizeMode="contain" />
          </View>
          <Text style={[styles.subtitle, { color: mutedColor }]}>
            Select your main goal of the week, finish and get rewards!
          </Text>
        </View>

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
      <FeatureGuideModal guide="quests" />
      {celebration}
      {rewardAnimation}
    </SafeAreaView>
  );
}

// Dark-brown ground (user call 2026-07-23) + darker offset drop; white faces.
// Friend Quests picker flips to warm cream with a tan offset (2026-07-29).
const BG = '#4C331B';
const OFFSET = '#33220F';
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
  celebration: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  rewardOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardBurstStack: {
    alignItems: 'center',
    gap: 12,
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 16 },
  header: { paddingTop: 12, paddingBottom: 14, paddingHorizontal: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: CREAM, ...androidTabHeaderTypography.title },
  titleIcon: { width: 42, height: 42 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: CREAM_MUTED, marginTop: 6, ...androidTabHeaderTypography.subtitle },

  cardGap: { marginBottom: 12 },
  rowGap: { marginBottom: 8 },


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

});
