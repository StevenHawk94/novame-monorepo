import { useCallback, useMemo, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloverBurst } from '@/components/main/clover-burst';
import { GridBackground } from '@/components/ui/grid-background';
import { OffsetCard } from '@/components/ui/offset-card';
import { confirmCloverAward } from '@/lib/cosmetics-api';
import { haptics } from '@/lib/haptics';
import { ICONS } from '@/lib/icons';
import {
  fetchQuestRewards,
  getCachedQuestRewards,
  type DailyRewardQuest,
  type QuestRewardStatus,
  type SpecialRewardQuest,
} from '@/lib/quest-rewards-api';
import { useCompletionSound } from '@/lib/use-completion-sound';
import { afterUiSettles } from '@/lib/ui-idle';

const DAILY_ICONS: Record<string, ImageSourcePropType> = {
  reflection: ICONS.reflectEntry1,
  case_sync: ICONS.obCourtLife,
  good_vibe: ICONS.send,
  tame_enemy: ICONS.TameEnemy,
  small_win: ICONS.SmallWins,
  new_perspective: ICONS.NewLens,
};

const SPECIAL_META: Record<string, { icon: ImageSourcePropType; route: string }> = {
  memory_items: { icon: ICONS.sharedMemories, route: '/(main)/reflect' },
  cases_finished: { icon: ICONS.obCourtLife, route: '/(main)/thump' },
  small_wins: { icon: ICONS.SmallWins, route: '/(main)/quiet-wins' },
  tame_enemy: { icon: ICONS.TameEnemy, route: '/(main)/tame-enemy' },
  good_vibes: { icon: ICONS.send, route: '/(main)/(tabs)/friends' },
  scenes_unlocked: { icon: ICONS.Maps, route: '/(main)/(modals)/scene-select' },
  outfits_unlocked: { icon: ICONS.Outfits, route: '/(main)/(modals)/skin-select' },
};

function RewardAmount({ amount }: { amount: number }) {
  return (
    <View style={styles.rewardAmount}>
      <Text style={styles.rewardText}>+{amount}</Text>
      <Image source={ICONS.Clover} style={styles.rewardIcon} resizeMode="contain" />
    </View>
  );
}

function DailyCard({ quest, onPress }: { quest: DailyRewardQuest; onPress: () => void }) {
  const icon = DAILY_ICONS[quest.key] ?? ICONS.Quests;
  return (
    <OffsetCard
      color={quest.done ? '#7D5B45' : OFFSET}
      offset={4}
      radius={18}
      onPress={quest.done ? undefined : onPress}
      accessibilityLabel={`${quest.title}, ${quest.done ? 'completed' : `${quest.reward} clovers`}`}
      cardStyle={[styles.dailyCard, quest.done && styles.dailyCardDone]}
      style={styles.cardGap}
    >
      <Image source={icon} style={styles.dailyIcon} resizeMode="contain" />
      <Text style={[styles.dailyTitle, quest.done && styles.dailyTitleDone]}>{quest.title}</Text>
      <RewardAmount amount={quest.reward} />
      <View style={[styles.actionCircle, quest.done ? styles.actionDone : styles.actionReady]}>
        <MaterialIcons name={quest.done ? 'check' : 'arrow-forward'} size={25} color="#FFFFFF" />
      </View>
    </OffsetCard>
  );
}

function SpecialCard({ quest, onPress }: { quest: SpecialRewardQuest; onPress: () => void }) {
  const meta = SPECIAL_META[quest.key] ?? { icon: ICONS.Quests, route: '/(main)/(tabs)/home' };
  const ratio = quest.progressTarget > 0 ? Math.min(1, quest.progress / quest.progressTarget) : 0;
  const label = quest.complete && quest.available !== null
    ? `${quest.available}/${quest.available}`
    : `${quest.progress}/${quest.progressTarget}`;
  return (
    <OffsetCard
      color={OFFSET}
      offset={4}
      radius={20}
      onPress={onPress}
      accessibilityLabel={`${quest.title}, ${label}, ${quest.reward} clovers per milestone`}
      cardStyle={styles.specialCard}
      style={styles.cardGap}
    >
      <Image source={meta.icon} style={styles.specialIcon} resizeMode="contain" />
      <View style={styles.specialBody}>
        <View style={styles.specialTop}>
          <Text style={styles.specialTitle}>{quest.title}</Text>
          <RewardAmount amount={quest.reward} />
        </View>
        <Text style={styles.specialSubtitle}>{quest.subtitle}</Text>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{label}</Text>
        </View>
      </View>
      <View style={[styles.actionCircle, quest.complete ? styles.actionDone : styles.actionReady]}>
        <MaterialIcons name={quest.complete ? 'check' : 'arrow-forward'} size={25} color="#FFFFFF" />
      </View>
    </OffsetCard>
  );
}

export default function QuestsScreen() {
  const router = useRouter();
  const { play: playCompletionSound } = useCompletionSound();
  const [status, setStatus] = useState<QuestRewardStatus>(() => getCachedQuestRewards());
  const [refreshing, setRefreshing] = useState(false);
  const [reward, setReward] = useState(0);

  const applyStatus = useCallback((next: QuestRewardStatus) => {
    setStatus(next);
    if (next.cloversEarned <= 0) return;
    confirmCloverAward(next.cloversEarned);
    setReward(next.cloversEarned);
    void haptics.success();
    playCompletionSound();
  }, [playCompletionSound]);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const next = await fetchQuestRewards();
      applyStatus(next);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, [applyStatus]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const cancel = afterUiSettles(() => {
      void fetchQuestRewards().then((next) => {
        if (!active) return;
        applyStatus(next);
      });
    }, { delayMs: 80 });
    return () => { active = false; cancel(); };
  }, [applyStatus]));

  const specialRows = useMemo(() => status.special, [status.special]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <GridBackground base={BG} line={GRID} cell={22} lineWidth={1.15} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} tintColor="#FFF7EC" />}
      >
        <View style={styles.sectionHeader}>
          <Image source={ICONS.Quests} style={styles.headerIcon} resizeMode="contain" />
          <Text style={styles.headerTitle}>Daily Quests</Text>
        </View>
        <Text style={styles.sectionHint}>Complete each one once today.</Text>

        <View style={styles.list}>
          {status.daily.map((quest) => (
            <DailyCard
              key={quest.key}
              quest={quest}
              onPress={() => {
                void haptics.selection();
                router.push(quest.route as never);
              }}
            />
          ))}
        </View>

        <View style={[styles.sectionHeader, styles.specialHeader]}>
          <MaterialIcons name="star" size={34} color="#FFD24F" />
          <Text style={styles.headerTitle}>Special Quests</Text>
        </View>
        <Text style={styles.sectionHint}>Lifetime progress. Every milestone pays out.</Text>

        <View style={styles.list}>
          {specialRows.map((quest) => (
            <SpecialCard
              key={quest.key}
              quest={quest}
              onPress={() => {
                const route = SPECIAL_META[quest.key]?.route;
                if (!route) return;
                void haptics.selection();
                router.push(route as never);
              }}
            />
          ))}
        </View>
      </ScrollView>

      {reward > 0 && (
        <View style={styles.rewardOverlay} pointerEvents="none">
          <CloverBurst amount={reward} onDone={() => setReward(0)} />
        </View>
      )}
    </SafeAreaView>
  );
}

const BG = '#503117';
const GRID = '#68472B';
const OFFSET = '#2F1D0E';
const TEXT = '#231A15';
const MUTED = '#725F50';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 12, paddingTop: 18, paddingBottom: 42 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 3 },
  specialHeader: { marginTop: 28 },
  headerIcon: { width: 38, height: 38 },
  headerTitle: { color: '#FFF9F0', fontFamily: 'Inter_800ExtraBold', fontSize: 27 },
  sectionHint: {
    color: 'rgba(255,249,240,0.72)',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginLeft: 51,
    marginTop: -2,
    marginBottom: 14,
  },
  list: { gap: 9 },
  cardGap: { marginBottom: 2 },
  dailyCard: {
    minHeight: 76,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: 'rgba(74,52,35,0.12)',
  },
  dailyCardDone: { backgroundColor: '#CBB3A8' },
  dailyIcon: { width: 45, height: 45 },
  dailyTitle: { flex: 1, color: TEXT, fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 22 },
  dailyTitleDone: { color: '#FFF9F3', textDecorationLine: 'line-through' },
  rewardAmount: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rewardText: { color: '#7A603F', fontFamily: 'Inter_700Bold', fontSize: 12 },
  rewardIcon: { width: 17, height: 17 },
  actionCircle: { width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  actionReady: { backgroundColor: '#858786' },
  actionDone: { backgroundColor: '#63AE78' },
  specialCard: {
    minHeight: 112,
    paddingHorizontal: 13,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: 'rgba(74,52,35,0.12)',
  },
  specialIcon: { width: 54, height: 54 },
  specialBody: { flex: 1, minWidth: 0 },
  specialTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  specialTitle: { flex: 1, color: TEXT, fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 21 },
  specialSubtitle: { color: MUTED, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 16, marginTop: 3 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressTrack: { flex: 1, height: 9, borderRadius: 6, backgroundColor: '#ECE8DB', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6, backgroundColor: '#85B85E' },
  progressLabel: { minWidth: 38, color: TEXT, fontFamily: 'Inter_700Bold', fontSize: 11, textAlign: 'right' },
  rewardOverlay: { position: 'absolute', left: 0, right: 0, top: 110, alignItems: 'center', zIndex: 10 },
});
