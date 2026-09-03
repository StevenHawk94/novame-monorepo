import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutRectangle } from 'react-native';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Image } from 'react-native';

import {
  battleMilestoneCount, battleMilestoneThreshold, BATTLE_MILESTONE_REWARD,
  XP_RULES,
} from '@novame/engine';
import { ICONS } from '../../src/lib/icons';
import { haptics } from '../../src/lib/haptics';
import { Image as ExpoImage } from 'expo-image';
import { AndroidCompactText as Text } from '@/components/ui/android-compact-typography';

import {
  fetchTameStatus, getCachedTameStatus, subscribeTameStatus, submitTame,
  MONSTER_EMOJI, MONSTER_TAMED_EMOJI, type MonsterStatus,
} from '../../src/lib/tame-enemy-api';
import { MONSTER_ART } from '../../src/lib/monster-images';
import { optimisticCloverAward } from '../../src/lib/cosmetics-api';
import {
  TAME_FINAL_WORD_SETS,
  TAME_INTRO_COPY,
  TAME_TAMED_COPY,
  type TameFinalWords,
} from '../../src/lib/tame-final-words';
import { SwipeAttackLayer } from '../../src/components/tame-enemy/swipe-attack-layer';

type Phase = 'select' | 'prep' | 'battle' | 'finalWords' | 'exploding' | 'result';

const ATTACKS_TO_TAME = 20;
const WHITE_FILM_OPACITY = 0;
const HEART_ANIMATION_SOURCE = Platform.select({
  android: require('../../assets/animations/exploding-heart.json'),
  default: require('../../assets/animations/exploding-heart.lottie'),
});
const HEART_ANIMATION_FALLBACK_MS = 6000;
const MONSTER_BACKGROUND_SOURCE = require('../../assets/monsters/monster-bg.webp');
const SWIPE_ICON_SOURCE = require('../../assets/Icons/Swipe.png');

function MonsterBackground() {
  return (
    <ExpoImage
      source={MONSTER_BACKGROUND_SOURCE}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      contentPosition="center"
    />
  );
}

function scaleForHits(hits: number): number {
  if (hits >= ATTACKS_TO_TAME) return 0.55;
  if (hits >= 14) return 0.7;
  if (hits >= 7) return 0.85;
  return 1;
}

/** Tame Enemy: select, prepare, land 20 native swipe attacks, then settle. */
export default function TameEnemyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const kit = {
    text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
    card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
    accent: '#E0912F', danger: '#D9694E', secret: '#B57BC9',
  };

  const [phase, setPhase] = useState<Phase>('select');
  // Cache-first (2026-07-30): the grid renders instantly from the cached (or
  // engine-synthesized) status; the network fetch below only refreshes it.
  const cached = getCachedTameStatus();
  const [monsters, setMonsters] = useState<MonsterStatus[]>(cached.monsters);
  const [doneToday, setDoneToday] = useState(cached.doneToday);
  const [perEnemyDaily, setPerEnemyDaily] = useState(cached.perEnemyDaily);
  const [battlePoints, setBattlePoints] = useState(cached.battlePoints);
  const [active, setActive] = useState<MonsterStatus | null>(null);
  const [selectedFinalWords, setSelectedFinalWords] = useState<TameFinalWords | null>(null);
  const [hits, setHits] = useState(0);
  const [monsterTarget, setMonsterTarget] = useState<LayoutRectangle | null>(null);
  const [reward, setReward] = useState<number | null>(null);
  const [milestoneBonus, setMilestoneBonus] = useState(0);
  const [hitFlash, setHitFlash] = useState(false);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hitsRef = useRef(0);
  const submittingRef = useRef(false);
  const monsterScale = useSharedValue(1);
  const monsterShake = useSharedValue(0);
  const whiteFilm = useSharedValue(WHITE_FILM_OPACITY);
  const resultScale = useSharedValue(0);

  const monsterAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: monsterShake.value },
      { scale: monsterScale.value },
    ],
  }));
  const whiteFilmStyle = useAnimatedStyle(() => ({ opacity: whiteFilm.value }));
  const resultAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: resultScale.value }],
  }));

  const refreshCachedStatus = useCallback(() => {
    const status = getCachedTameStatus();
    setMonsters(status.monsters);
    setDoneToday(status.doneToday);
    setPerEnemyDaily(status.perEnemyDaily);
    setBattlePoints(status.battlePoints);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeTameStatus(refreshCachedStatus);
    refreshCachedStatus();
    return unsubscribe;
  }, [refreshCachedStatus]);

  useFocusEffect(useCallback(() => {
    refreshCachedStatus();
    void fetchTameStatus();
  }, [refreshCachedStatus]));

  useEffect(() => () => {
    if (hitTimer.current) clearTimeout(hitTimer.current);
  }, []);

  // Do not let a platform-specific Lottie completion callback strand the
  // battle. At 0.75x, the 90-frame / 29.97fps asset lasts about four seconds;
  // this only wins if loading or the native completion event fails entirely.
  useEffect(() => {
    if (phase !== 'exploding') return undefined;
    const timer = setTimeout(() => setPhase('result'), HEART_ANIMATION_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'result') return;
    cancelAnimation(resultScale);
    resultScale.value = 0;
    resultScale.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withTiming(0.9, { duration: 90, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }),
    );
  }, [phase, resultScale]);

  function startBattle(m: MonsterStatus) {
    void haptics.medium();
    setActive(m);
    const wordSets = TAME_FINAL_WORD_SETS[m.id] ?? [];
    setSelectedFinalWords(wordSets.length > 0
      ? wordSets[Math.floor(Math.random() * wordSets.length)]
      : null);
    setHits(0);
    hitsRef.current = 0;
    submittingRef.current = false;
    setMonsterTarget(null);
    setReward(null);
    setMilestoneBonus(0);
    setHitFlash(false);
    monsterScale.value = 1;
    monsterShake.value = 0;
    whiteFilm.value = WHITE_FILM_OPACITY;
    setPhase('prep');
  }

  const landSwipe = useCallback(() => {
    if (phase !== 'battle' || hitsRef.current >= ATTACKS_TO_TAME) return;
    const nextHits = hitsRef.current + 1;
    hitsRef.current = nextHits;
    setHits(nextHits);
    setHitFlash(true);
    if (hitTimer.current) clearTimeout(hitTimer.current);
    hitTimer.current = setTimeout(() => {
      hitTimer.current = null;
      setHitFlash(false);
    }, 170);

    monsterShake.value = withSequence(
      withTiming(-8, { duration: 24 }),
      withTiming(8, { duration: 34 }),
      withTiming(-5, { duration: 28 }),
      withTiming(4, { duration: 26 }),
      withTiming(0, { duration: 30 }),
    );
    whiteFilm.value = withSequence(
      withTiming(0.96, { duration: 45, easing: Easing.out(Easing.quad) }),
      withTiming(WHITE_FILM_OPACITY, { duration: 120 }),
    );
    monsterScale.value = withSpring(scaleForHits(nextHits), {
      damping: 13,
      stiffness: 210,
      mass: 0.65,
    });

    if (nextHits === ATTACKS_TO_TAME) {
      void haptics.heavy();
      setPhase('finalWords');
    } else if (nextHits === 7 || nextHits === 14) {
      void haptics.medium();
    } else {
      void haptics.light();
    }
  }, [monsterScale, monsterShake, phase, whiteFilm]);

  function chooseFinalWord(index: number) {
    if (!active || submittingRef.current || phase !== 'finalWords') return;
    submittingRef.current = true;
    if (hitTimer.current) {
      clearTimeout(hitTimer.current);
      hitTimer.current = null;
    }
    setHitFlash(false);
    cancelAnimation(monsterShake);
    monsterShake.value = 0;
    cancelAnimation(whiteFilm);
    whiteFilm.value = 0;
    void haptics.heavy();
    setReward(XP_RULES.tameEnemy.award);
    setMilestoneBonus(0);
    setPhase('exploding');
    const award = optimisticCloverAward(XP_RULES.tameEnemy.award);
    const variant = selectedFinalWords?.variant ?? 'fallback';
    const choiceId = `${active.id}-final-${variant}-${index + 1}`;
    void submitTame({ monsterId: active.id, skillsUsed: [choiceId], hits: ATTACKS_TO_TAME }).then((res) => {
      setReward(res.ok ? (res.xpAwarded ?? null) : null);
      setMilestoneBonus(res.ok ? (res.milestoneBonus ?? 0) : 0);
      if (res.ok) {
        if (typeof res.battleTotalPoints === 'number') {
          setBattlePoints(res.battleTotalPoints);
        }
        award.commit((res.xpAwarded ?? 0) + (res.milestoneBonus ?? 0));
      } else {
        award.rollback();
      }
    });
  }

  function exit() {
    setPhase('select');
    setActive(null);
    setSelectedFinalWords(null);
  }

  // ---- SELECT ----
  if (phase === 'select') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <MonsterBackground />
        <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        {/* Design: brown banner title card. PRD copy kept inside it. */}
        <View style={styles.titleBanner}>
          <Text style={styles.titleBannerText}>What's been loud lately?</Text>
          <Text style={styles.titleBannerSub}>Pick what's closest — we'll figure out the rest together.</Text>
        </View>

        {doneToday && (
          <View style={[styles.hintBar, { backgroundColor: kit.card }]}>
            <Text style={[styles.hintText, { color: kit.accent }]}>
              {perEnemyDaily
                ? "All eight tamed today — that's the full sweep. Back tomorrow!"
                : "All 3 tames used today. Come back tomorrow for more."}
            </Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {monsters.map((m) => {
            // Free: 3 tames a day across all monsters. Paid: one per monster.
            const locked = perEnemyDaily ? m.tamedToday : doneToday;
            // Old cached payloads only carried tamedBefore. Preserve that
            // first-tame badge until the background status refresh supplies
            // the exact server count.
            const tamedCount = Math.max(
              0,
              Number(m.tamedCount ?? (m.tamedBefore ? 1 : 0)) || 0,
            );
            return (
              <Pressable
                key={m.id}
                onPress={() => (locked ? undefined : startBattle(m))}
                style={[styles.monsterCell, { backgroundColor: kit.card, opacity: locked ? 0.5 : 1 }]}
              >
                {MONSTER_ART[m.id] ? (
                  <ExpoImage source={MONSTER_ART[m.id].normal} style={styles.monsterImg} contentFit="contain" />
                ) : (
                  <Text style={styles.monsterEmoji}>{MONSTER_EMOJI[m.id] ?? '\u{1F47E}'}</Text>
                )}
                <Text style={[styles.monsterName, { color: kit.text }]}>{m.name}</Text>
                {tamedCount > 0 && (
                  <View style={[styles.tamedBadge, { backgroundColor: 'rgba(58,46,26,0.08)' }]}>
                    <Text style={[styles.tamedBadgeText, { color: kit.textSub }]}>Tamed {tamedCount}×</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // ---- PREP (design: Enemy selected — data + progress before the fight) ----
  if (phase === 'prep' && active) {
    // Always show the next three unclaimed milestones. As soon as one is
    // crossed, the following threshold becomes the leftmost node and a new
    // future threshold enters on the right.
    const crossed = battleMilestoneCount(battlePoints);
    const milestones = [1, 2, 3].map((i) => ({
      n: crossed + i,
      threshold: battleMilestoneThreshold(crossed + i),
    }));
    return (
      <View style={[styles.prepRoot, { paddingTop: insets.top + 12 }]}>
        <MonsterBackground />
        <ScrollView contentContainerStyle={styles.prepScroll} showsVerticalScrollIndicator={false}>
        {/* name bubble with a tail pointing at the monster (mock) */}
        <View style={styles.prepNameBubble}>
          <Text style={styles.prepNameText}>{active.name}</Text>
        </View>

        {MONSTER_ART[active.id] ? (
          <ExpoImage source={MONSTER_ART[active.id].normal} style={styles.prepImg} contentFit="contain" />
        ) : (
          <Text style={styles.prepEmoji}>{MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}</Text>
        )}
        <Text style={[styles.prepQuote, { color: kit.text }]}>
          {TAME_INTRO_COPY[active.id] ?? active.prep}
        </Text>

        {/* milestone banner: the next three unclaimed 🍀 thresholds */}
        <View style={styles.milestoneBanner}>
          {milestones.map((m, i) => (
            <View key={m.n} style={styles.milestoneNodeWrap}>
              {i > 0 && <View style={styles.milestoneLink} />}
              <View style={styles.milestoneNode}>
                <Image source={ICONS.Clover} style={styles.milestoneCloverImg} resizeMode="contain" />
                <Text style={styles.milestoneReward}>x{BATTLE_MILESTONE_REWARD}</Text>
              </View>
              <Text style={styles.milestoneThreshold}>{m.threshold.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        {/* history bar (mock): icon + label left, pts chip right */}
        <View style={styles.prepStatsBar}>
          <Image source={ICONS.TameEnemy} style={styles.prepStatIcon} resizeMode="contain" />
          <Text style={styles.prepStatTitle}>Tame History</Text>
          <View style={{ flex: 1 }} />
          <View style={styles.ptsChip}>
            <Text style={styles.ptsChipText}>{battlePoints.toLocaleString()} pts</Text>
          </View>
        </View>

        <Text style={[styles.prepHint, { color: kit.text }]}>
          Tame the monster to relieve from {active.name.toLowerCase()}.
        </Text>

        <Pressable
          onPress={() => { void haptics.pageOpen(); setPhase('battle'); }}
          style={({ pressed }) => [styles.startTamingBtn, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Text style={styles.startTamingText}>Start Taming</Text>
        </Pressable>
        <Pressable onPress={() => { void haptics.pageClose(); exit(); }} style={[styles.prepClose, { marginBottom: insets.bottom + 8 }]} hitSlop={10}>
          <Text style={styles.prepCloseX}>✕</Text>
        </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ---- BATTLE / FINAL WORDS / SETTLEMENT ----
  if (active && (phase === 'battle' || phase === 'finalWords' || phase === 'exploding' || phase === 'result')) {
    const finalWords = selectedFinalWords ?? {
      variant: 'fallback',
      monster: active.prep,
      replies: [] as readonly string[],
    };
    const showMonsterBubble = phase === 'finalWords';
    const hpPercent = Math.max(0, ((ATTACKS_TO_TAME - hits) / ATTACKS_TO_TAME) * 100);

    return (
      <View style={styles.battleRoot}>
        <MonsterBackground />

        <View style={[styles.attackArea, { paddingTop: insets.top + 12 }]}>
          {phase !== 'battle' && (
            <View
              pointerEvents="none"
              style={[styles.monsterBubble, !showMonsterBubble && styles.monsterBubbleHidden]}
            >
              {showMonsterBubble ? (
                <>
                  <Text
                    style={styles.monsterBubbleText}
                    numberOfLines={3}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {finalWords.monster}
                  </Text>
                  <View style={styles.monsterBubbleTail} />
                </>
              ) : null}
            </View>
          )}

          <Animated.View
            onLayout={(event) => setMonsterTarget(event.nativeEvent.layout)}
            style={[styles.monsterWrap, monsterAnimatedStyle]}
          >
            {MONSTER_ART[active.id] ? (
              <>
                <ExpoImage
                  source={hitFlash ? MONSTER_ART[active.id].hit : MONSTER_ART[active.id].normal}
                  style={styles.battleImg}
                  contentFit="contain"
                />
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, whiteFilmStyle]}>
                  <ExpoImage
                    source={MONSTER_ART[active.id].normal}
                    style={styles.battleImg}
                    contentFit="contain"
                    tintColor="#FFFFFF"
                  />
                </Animated.View>
              </>
            ) : (
              <Text style={styles.battleEmoji}>{MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}</Text>
            )}
          </Animated.View>

          {phase === 'battle' && (
            <>
              <View style={styles.hpTrack}>
                <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
              </View>
              <Text style={styles.hpLabel}>Negative Power</Text>
            </>
          )}

          {phase === 'exploding' && (
            <View pointerEvents="none" style={styles.heartExplosionLayer}>
              <LottieView
                source={HEART_ANIMATION_SOURCE}
                autoPlay
                loop={false}
                speed={0.75}
                resizeMode="contain"
                style={styles.heartExplosion}
                onAnimationFinish={() => setPhase('result')}
                onAnimationFailure={(error) => {
                  console.warn('[tame-enemy] heart animation failed:', error);
                }}
              />
            </View>
          )}

          <SwipeAttackLayer
            enabled={phase === 'battle'}
            target={monsterTarget}
            onHit={landSwipe}
          />
        </View>

        <View style={[styles.copyArea, { paddingBottom: insets.bottom + 12 }]}>
          {phase === 'battle' ? (
            <View style={styles.attackInstructions}>
              <ExpoImage source={SWIPE_ICON_SOURCE} style={styles.attackIcon} contentFit="contain" />
              <Text style={styles.attackTitle}>Swipe to attack{`\n`}Your {active.name} Monster</Text>
              <Text style={styles.attackSubtitle}>Tame it with your finger</Text>
            </View>
          ) : (
            <>
              <View style={styles.finalWordsHeading}>
                <Text style={styles.finalWordsTitle}>Give Your Monster A Final Word</Text>
              </View>
              <ScrollView
                style={styles.finalWordsScroll}
                contentContainerStyle={styles.finalWordsList}
                showsVerticalScrollIndicator={false}
              >
                {finalWords.replies.map((reply, index) => (
                  <Pressable
                    key={reply}
                    disabled={phase !== 'finalWords'}
                    onPress={() => chooseFinalWord(index)}
                    style={({ pressed }) => [
                      styles.finalWordButton,
                      pressed && styles.finalWordButtonPressed,
                    ]}
                  >
                    <Text style={styles.finalWordText}>{reply}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </View>

        {phase === 'result' && (
          <View style={styles.resultBackdrop}>
            <Animated.View style={[styles.resultCard, resultAnimatedStyle]}>
              <Text style={styles.victoryLaurel}>{'🌿⭐️🌿'}</Text>
              <Text style={styles.victoryTitle}>VICTORY!</Text>
              {MONSTER_ART[active.id] ? (
                <ExpoImage source={MONSTER_ART[active.id].normal} style={styles.doneImg} contentFit="contain" />
              ) : (
                <Text style={styles.doneEmoji}>{MONSTER_TAMED_EMOJI[active.id] ?? '\u{2728}'}</Text>
              )}
              <Text style={styles.victoryText}>{TAME_TAMED_COPY[active.id] ?? active.tamed}</Text>
              {reward != null && reward > 0 && (
                <View style={styles.rewardBlock}>
                  <View style={styles.rewardRibbon}>
                    <Text style={styles.rewardRibbonText}>Rewards</Text>
                  </View>
                  <Image source={ICONS.Clover} style={styles.resultClover} resizeMode="contain" />
                  <Text style={styles.rewardCount}>x{reward}</Text>
                  {milestoneBonus > 0 && (
                    <Text style={styles.milestoneText}>Milestone bonus +{milestoneBonus} 🍀</Text>
                  )}
                </View>
              )}
              <Pressable
                onPress={() => { void haptics.pageClose(); router.back(); }}
                style={({ pressed }) => [styles.confirmBtn, pressed && styles.confirmBtnPressed]}
              >
                <Text style={styles.confirmText}>Confirm</Text>
              </Pressable>
            </Animated.View>
          </View>
        )}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  centerRoot: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  h1: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', marginTop: 4 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 16 },

  hintBar: { borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#6B452A', shadowOpacity: 0.14, shadowRadius: 1, shadowOffset: { width: 1, height: 2 }, elevation: 1 },
  hintText: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 19 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32 },
  monsterCell: { width: '48%', borderRadius: 20, padding: 18, marginBottom: 14, alignItems: 'center', shadowColor: '#6B452A', shadowOpacity: 0.16, shadowRadius: 1, shadowOffset: { width: 1, height: 2 }, elevation: 2 },
  monsterEmoji: { fontSize: 40, marginBottom: 8 },
  monsterImg: { width: 92, height: 92, marginBottom: 8 },
  monsterName: { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  monsterSkills: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 4 },
  tamedBadge: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  tamedBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  prepRoot: { flex: 1, backgroundColor: '#F6E7C8' },
  prepScroll: {
    flexGrow: 1, paddingHorizontal: 20, paddingVertical: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  prepNameBubble: {
    backgroundColor: '#EFD9A8', borderRadius: 18, paddingHorizontal: 26, paddingVertical: 13,
    marginBottom: 22,
  },
  prepNameText: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  prepEmoji: { fontSize: 96 },
  prepImg: { width: 190, height: 190 },
  prepQuote: { fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 24, paddingHorizontal: 16, marginTop: 10 },
  milestoneBanner: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start',
    width: '100%', marginTop: 22,
    backgroundColor: '#4A3220', borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18,
  },
  milestoneNodeWrap: { alignItems: 'center', flex: 1 },
  milestoneLink: { position: 'absolute', top: 20, right: '58%', left: '-42%', height: 2.5, backgroundColor: 'rgba(255,246,222,0.5)' },
  milestoneNode: { alignItems: 'center' },
  milestoneCloverImg: { width: 40, height: 40 },
  milestoneReward: { position: 'absolute', top: -6, right: -26, fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#FFF6DE' },
  milestoneThreshold: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#FFF6DE', marginTop: 6 },
  prepStatsBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', marginTop: 18,
    backgroundColor: '#FBF2DE', borderRadius: 16,
    paddingVertical: 14, paddingHorizontal: 14,
    shadowColor: '#6B452A', shadowOpacity: 0.14, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 1,
  },
  prepStatIcon: { width: 34, height: 34 },
  prepStatTitle: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  prepStatValue: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', marginTop: 2 },
  ptsChip: { backgroundColor: '#4A3220', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, marginTop: 3, alignSelf: 'flex-start' },
  ptsChipText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  prepHint: { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'center', marginTop: 18 },
  startTamingBtn: {
    marginTop: 14, backgroundColor: '#F7CE46', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', alignSelf: 'stretch',
    shadowColor: '#6B452A', shadowOpacity: 0.2, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  startTamingText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  prepClose: {
    marginTop: 14, width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6B452A', shadowOpacity: 0.18, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  prepCloseX: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  beginBtn: { paddingHorizontal: 48, paddingVertical: 18, borderRadius: 18, shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  beginText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  exitLink: { paddingVertical: 8 },
  exitText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // ---- swipe battle ----
  battleRoot: { flex: 1, backgroundColor: '#2A2140' },
  attackArea: {
    flex: 1.16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingBottom: 14,
    overflow: 'hidden',
  },
  monsterBubble: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18,
    width: '92%', height: 100, justifyContent: 'center', marginBottom: 14,
    zIndex: 5,
  },
  monsterBubbleHidden: { opacity: 0 },
  monsterBubbleText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#15121B', textAlign: 'center', lineHeight: 23 },
  monsterBubbleTail: {
    position: 'absolute', bottom: -8, alignSelf: 'center', width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 9,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFFFFF',
  },
  battleEmoji: { fontSize: 110 },
  battleImg: { width: 210, height: 210 },
  monsterWrap: { width: 210, height: 210, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  hpTrack: {
    width: '72%', height: 22, borderRadius: 11, backgroundColor: '#FFFFFF',
    borderWidth: 3, borderColor: '#17121F', overflow: 'hidden', marginTop: 10,
  },
  hpFill: { height: '100%', borderRadius: 8, backgroundColor: '#E4593C' },
  hpLabel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginTop: 5 },
  heartExplosionLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartExplosion: { width: 330, height: 330 },

  copyArea: {
    flex: 0.84, backgroundColor: 'rgba(121,76,43,0.5)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 22, paddingTop: 22,
  },
  attackInstructions: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 12 },
  attackIcon: { width: 60, height: 60, marginBottom: 18 },
  attackTitle: { color: '#FFFFFF', fontSize: 29, lineHeight: 38, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  attackSubtitle: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center', marginTop: 24 },
  finalWordsHeading: {
    position: 'relative', width: '100%', minHeight: 44,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  finalWordsTitle: {
    width: '100%',
    color: '#FFFFFF', fontSize: 19, fontFamily: 'Inter_800ExtraBold', textAlign: 'center',
  },
  finalWordsScroll: { flex: 1 },
  finalWordsList: { gap: 12, paddingBottom: 6 },
  finalWordButton: {
    minHeight: 62, borderRadius: 17, backgroundColor: '#4D3019',
    alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  finalWordButtonPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  finalWordText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontFamily: 'Inter_700Bold', textAlign: 'center' },

  titleBanner: {
    backgroundColor: '#4A3220', borderRadius: 20, paddingVertical: 16, paddingHorizontal: 20,
    marginTop: 4, marginBottom: 16,
  },
  titleBannerText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  titleBannerSub: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 4 },

  // ---- victory ----
  resultBackdrop: {
    ...StyleSheet.absoluteFillObject, zIndex: 50,
    backgroundColor: 'rgba(19,14,28,0.76)', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingVertical: 34,
  },
  resultCard: {
    width: '100%', maxWidth: 430, maxHeight: '92%',
    backgroundColor: 'rgba(35,29,44,0.9)', borderRadius: 30,
    alignItems: 'center', paddingHorizontal: 24, paddingVertical: 28, gap: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  victoryLaurel: { fontSize: 34 },
  victoryTitle: { fontSize: 38, fontFamily: 'Inter_800ExtraBold', color: '#F7CE46', letterSpacing: 2 },
  victoryText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', lineHeight: 24, paddingHorizontal: 12 },
  rewardBlock: { alignItems: 'center', gap: 4, marginTop: 2 },
  rewardRibbon: { backgroundColor: '#F7CE46', borderRadius: 8, paddingHorizontal: 28, paddingVertical: 6 },
  rewardRibbonText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  resultClover: { width: 48, height: 48, marginTop: 3 },
  rewardCount: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  milestoneText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#F7CE46', marginTop: 4 },
  confirmBtn: {
    alignSelf: 'stretch', backgroundColor: '#F7CE46', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', marginTop: 6,
    shadowColor: '#151021', shadowOpacity: 0.22, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  confirmBtnPressed: { transform: [{ translateY: 2 }] },
  confirmText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },

  doneEmoji: { fontSize: 72 },
  doneImg: { width: 110, height: 110 },
});
