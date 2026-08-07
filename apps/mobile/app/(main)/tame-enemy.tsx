import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { Image } from 'react-native';

import {
  MONSTER_HP, monsterHpForStage, monsterTierFor, isTamed,
  battleMilestoneCount, battleMilestoneThreshold, BATTLE_MILESTONE_REWARD,
} from '@novame/engine';
import { BACKGROUNDS, ICONS } from '../../src/lib/icons';
import { useTheme } from '../../src/theme/use-theme';
import { WaveBackground, WAVE_PALETTES } from '../../src/components/main/wave-background';
import { haptics } from '../../src/lib/haptics';
import { Image as ExpoImage } from 'expo-image';

import {
  fetchTameStatus, getCachedTameStatus, submitTame, markTameEnemyDoneToday,
  MONSTER_EMOJI, MONSTER_TAMED_EMOJI, type MonsterStatus,
} from '../../src/lib/tame-enemy-api';
import { MONSTER_ART } from '../../src/lib/monster-images';
import { POINT_ICONS, deckFor, type TameCard } from '../../src/lib/tame-cards';

type Phase = 'select' | 'prep' | 'battle' | 'done';

/**
 * Tame Enemy. Four screens as phases: select an enemy, a prep page, the
 * battle, and the tamed screen. One tame a day (server gate).
 *
 * Battle (2026-08-05 design): each monster owns a fixed 10-argument deck
 * (tame-cards.ts), listed as text rows — points icon + the argument's
 * opening line. TAP opens the full text; DOUBLE-TAP plays it: the monster
 * loses that argument's damage, and the FIRST time one lands its persuaded
 * line replaces the speech bubble (replays deal damage but leave the bubble
 * unchanged). HP 0 → tamed.
 */
export default function TameEnemyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const kit = {
    text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
    card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
    accent: '#E0912F', danger: '#D9694E', secret: '#B57BC9',
  };
  void c;

  const [phase, setPhase] = useState<Phase>('select');
  // Cache-first (2026-07-30): the grid renders instantly from the cached (or
  // engine-synthesized) status; the network fetch below only refreshes it.
  const cached = getCachedTameStatus();
  const [monsters, setMonsters] = useState<MonsterStatus[]>(cached.monsters);
  const [doneToday, setDoneToday] = useState(cached.doneToday);
  const [perEnemyDaily, setPerEnemyDaily] = useState(cached.perEnemyDaily);
  const [battlePoints, setBattlePoints] = useState(cached.battlePoints);
  const [firstTime, setFirstTime] = useState(false);
  const [active, setActive] = useState<MonsterStatus | null>(null);
  const [hp, setHp] = useState(MONSTER_HP);
  const [maxHp, setMaxHp] = useState(MONSTER_HP);
  const [hits, setHits] = useState(0);
  const [usedCardIds, setUsedCardIds] = useState<string[]>([]);
  // The monster's current speech: its complaint at first, then the latest
  // NEW card's persuaded line.
  const [bubbleText, setBubbleText] = useState('');
  // Long-press flips a card; double-tap plays it (RN has no built-in
  // double-tap, so a per-card timestamp tracks it).
  const [zoomCard, setZoomCard] = useState<TameCard | null>(null);
  const [lastTap, setLastTap] = useState<{ id: string; at: number }>({ id: '', at: 0 });
  const [reward, setReward] = useState<number | null>(null);
  const [milestoneBonus, setMilestoneBonus] = useState(0);
  // -Hit art frame flashes ~0.5s after each landed skill (design 2026-07-30).
  const [hitFlash, setHitFlash] = useState(false);
  // Damage number floated over the monster for the 0.5s hit window.
  const [lastDamage, setLastDamage] = useState<number | null>(null);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single tap opens the full text once the double-tap window passes; a
  // second tap inside the window plays the argument instead.
  const DOUBLE_TAP_MS = 300;
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onCardTap(card: TameCard) {
    const now = Date.now();
    if (lastTap.id === card.cardId && now - lastTap.at < DOUBLE_TAP_MS) {
      if (viewTimer.current) {
        clearTimeout(viewTimer.current);
        viewTimer.current = null;
      }
      setLastTap({ id: '', at: 0 });
      setZoomCard(null);
      playCard(card);
    } else {
      setLastTap({ id: card.cardId, at: now });
      if (viewTimer.current) clearTimeout(viewTimer.current);
      viewTimer.current = setTimeout(() => {
        viewTimer.current = null;
        setZoomCard(card);
      }, DOUBLE_TAP_MS + 20);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void fetchTameStatus().then((r) => {
        setMonsters(r.monsters);
        setDoneToday(r.doneToday);
        setPerEnemyDaily(r.perEnemyDaily);
        setBattlePoints(r.battlePoints);
        setFirstTime(r.monsters.every((m) => !m.tamedBefore));
      });
    }, []),
  );

  // Battle pool = the monster's fixed 10-card deck.
  const deck = useMemo(() => (active ? deckFor(active.id) : []), [active]);

  function startBattle(m: MonsterStatus) {
    void haptics.medium();
    setActive(m);
    // Staged HP (Q15): grows with prior tames of this monster, capped at 300.
    const cap = monsterHpForStage(m.tamedCount ?? 0);
    setMaxHp(cap);
    setHp(cap);
    setHits(0);
    setUsedCardIds([]);
    setBubbleText(m.prep);
    setPhase('prep');
  }

  function playCard(card: TameCard) {
    const next = Math.max(0, hp - card.damage);
    setHp(next);
    setHits((h) => h + 1);
    setHitFlash(true);
    setLastDamage(card.damage);
    if (hitTimer.current) clearTimeout(hitTimer.current);
    hitTimer.current = setTimeout(() => {
      hitTimer.current = null;
      setHitFlash(false);
      setLastDamage(null);
    }, 500);
    // A NEW card persuades — the bubble takes its line. Replays just damage.
    if (!usedCardIds.includes(card.cardId)) {
      setUsedCardIds((ids) => [...ids, card.cardId]);
      setBubbleText(card.persuaded);
    }

    const tier = monsterTierFor(next, maxHp);
    if (tier === 'defeated') void haptics.heavy();
    else if (tier === 'wounded') void haptics.medium();
    else void haptics.light();

    if (isTamed(next)) {
      void finishTame();
    }
  }

  async function finishTame() {
    if (!active) return;
    // Record the completion (best-effort; the tame is already visually done).
    const res = await submitTame({ monsterId: active.id, skillsUsed: usedCardIds, hits: hits + 1 });
    setReward(res.ok ? (res.xpAwarded ?? null) : null);
    setMilestoneBonus(res.ok ? (res.milestoneBonus ?? 0) : 0);
    markTameEnemyDoneToday();
    setPhase('done');
  }

  function exit() {
    setPhase('select');
    setActive(null);
  }

  const tier = monsterTierFor(hp, maxHp);

  // ---- SELECT ----
  if (phase === 'select') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.tameEnemy} />
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={kit.textSub} />
        </Pressable>
        {/* Design: brown banner title card. PRD copy kept inside it. */}
        <View style={styles.titleBanner}>
          <Text style={styles.titleBannerText}>What's been loud lately?</Text>
          <Text style={styles.titleBannerSub}>Pick what's closest — we'll figure out the rest together.</Text>
        </View>

        {firstTime && (
          <View style={[styles.hintBar, { backgroundColor: kit.card, borderColor: kit.border }]}>
            <Text style={[styles.hintText, { color: kit.textSub }]}>
              Your skills come from your own reflections — the more you write, the more ways you'll have to respond.
            </Text>
          </View>
        )}
        {doneToday && (
          <View style={[styles.hintBar, { backgroundColor: kit.card, borderColor: kit.accent }]}>
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
            return (
              <Pressable
                key={m.id}
                onPress={() => (locked ? undefined : startBattle(m))}
                style={[styles.monsterCell, { backgroundColor: kit.card, borderColor: kit.border, opacity: locked ? 0.5 : 1 }]}
              >
                {MONSTER_ART[m.id] ? (
                  <ExpoImage source={MONSTER_ART[m.id].normal} style={styles.monsterImg} contentFit="contain" />
                ) : (
                  <Text style={styles.monsterEmoji}>{MONSTER_EMOJI[m.id] ?? '\u{1F47E}'}</Text>
                )}
                <Text style={[styles.monsterName, { color: kit.text }]}>{m.name}</Text>
                {m.tamedBefore && (
                  <View style={[styles.tamedBadge, { backgroundColor: 'rgba(58,46,26,0.08)' }]}>
                    <Text style={[styles.tamedBadgeText, { color: kit.textSub }]}>Tamed once</Text>
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
    // Milestones come in rolling windows of three: finish all three and the
    // banner advances to the next trio. Crossed ones show a Claimed badge
    // (rewards are auto-paid server-side when the threshold is crossed).
    const crossed = battleMilestoneCount(battlePoints);
    const windowStart = Math.floor(crossed / 3) * 3;
    const milestones = [1, 2, 3].map((i) => ({
      n: windowStart + i,
      threshold: battleMilestoneThreshold(windowStart + i),
      claimed: windowStart + i <= crossed,
    }));
    return (
      <View style={[styles.prepRoot, { paddingTop: insets.top + 12 }]}>
        <ScrollView contentContainerStyle={styles.prepScroll} showsVerticalScrollIndicator={false}>
        {/* name bubble with a tail pointing at the monster (mock) */}
        <View style={styles.prepNameBubble}>
          <Text style={styles.prepNameText}>{active.name}</Text>
          <View style={styles.prepNameTail} />
        </View>

        {MONSTER_ART[active.id] ? (
          <ExpoImage source={MONSTER_ART[active.id].normal} style={styles.prepImg} contentFit="contain" />
        ) : (
          <Text style={styles.prepEmoji}>{MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}</Text>
        )}
        <Text style={[styles.prepQuote, { color: kit.text }]}>“{active.prep}”</Text>

        {/* milestone banner: dark brown card, the current trio of 🍀 rewards;
            crossed ones wear a Claimed badge */}
        <View style={styles.milestoneBanner}>
          {milestones.map((m, i) => (
            <View key={m.n} style={styles.milestoneNodeWrap}>
              {i > 0 && <View style={styles.milestoneLink} />}
              <View style={[styles.milestoneNode, m.claimed && { opacity: 0.55 }]}>
                <Image source={ICONS.Clover} style={styles.milestoneCloverImg} resizeMode="contain" />
                <Text style={styles.milestoneReward}>x{BATTLE_MILESTONE_REWARD}</Text>
              </View>
              <Text style={styles.milestoneThreshold}>{m.threshold.toLocaleString()}</Text>
              {m.claimed && (
                <View style={styles.claimedChip}>
                  <Text style={styles.claimedText}>Claimed</Text>
                </View>
              )}
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
          onPress={() => { void haptics.medium(); setPhase('battle'); }}
          style={({ pressed }) => [styles.startTamingBtn, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Text style={styles.startTamingText}>Start Taming</Text>
        </Pressable>
        <Pressable onPress={exit} style={[styles.prepClose, { marginBottom: insets.bottom + 8 }]} hitSlop={10}>
          <Text style={styles.prepCloseX}>✕</Text>
        </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ---- BATTLE (design: dark dungeon scene) ----
  if (phase === 'battle' && active) {
    return (
      <View style={[styles.battleRoot, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={exit} style={[styles.back, { marginLeft: 20 }]} hitSlop={12}>
          <MaterialIcons name="close" size={24} color="rgba(255,255,255,0.7)" />
        </Pressable>

        {/* Monster speech bubble (persuaded lines land here) + monster,
            over the tame-enemy dungeon art */}
        <View style={styles.battleScene}>
          <ExpoImage
            source={BACKGROUNDS.tameEnemy}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.monsterBubble}>
            <Text style={styles.monsterBubbleText} numberOfLines={4}>{bubbleText || active.prep}</Text>
            <View style={styles.monsterBubbleTail} />
          </View>
          {MONSTER_ART[active.id] ? (
            <View style={styles.monsterWrap}>
              {lastDamage !== null && (
                <Text style={styles.damagePop}>-{lastDamage}</Text>
              )}
              <ExpoImage
                source={hitFlash ? MONSTER_ART[active.id].hit : MONSTER_ART[active.id].normal}
                style={styles.battleImg}
                contentFit="contain"
              />
            </View>
          ) : (
            <Text style={styles.battleEmoji}>
              {MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}
            </Text>
          )}
          {/* Pixel-flavored HP bar, labeled per the mock */}
          <View style={styles.hpTrack}>
            <View style={[styles.hpFill, { width: `${(hp / maxHp) * 100}%` }]} />
          </View>
          <Text style={styles.hpLabel}>Negative Power</Text>
        </View>

        {/* Bottom deck — text rows: tap to view, double tap to apply */}
        <View style={[styles.skillPanel, { paddingBottom: insets.bottom + 10 }]}>
          <Text style={styles.panelHint}>Tap to view, double tap to apply.</Text>
          <ScrollView contentContainerStyle={styles.rowsWrap} showsVerticalScrollIndicator={false}>
            {deck.map((card) => (
              <Pressable
                key={card.cardId}
                onPress={() => onCardTap(card)}
                style={({ pressed }) => [styles.argRow, pressed && { opacity: 0.85 }]}
              >
                <ExpoImage
                  source={POINT_ICONS[card.damage] ?? POINT_ICONS[10]}
                  style={styles.argIcon}
                  contentFit="contain"
                />
                <Text style={styles.argText} numberOfLines={1}>{card.argument}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Full-text overlay (tap): the whole counter-argument */}
        {zoomCard !== null && (
          <Pressable style={styles.zoomBackdrop} onPress={() => setZoomCard(null)}>
            <Pressable
              style={styles.zoomTextCard}
              onPress={() => {
                const z = zoomCard;
                setZoomCard(null);
                if (z) playCard(z);
              }}
            >
              <ExpoImage
                source={POINT_ICONS[zoomCard.damage] ?? POINT_ICONS[10]}
                style={styles.zoomIcon}
                contentFit="contain"
              />
              <Text style={styles.zoomArgument}>{zoomCard.argument}</Text>
            </Pressable>
            <Text style={styles.zoomHint}>Tap the card to apply it — or tap outside to go back.</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // ---- DONE (design: victory overlay) ----
  if (phase === 'done' && active) {
    return (
      <View style={[styles.battleRoot, { paddingTop: insets.top + 8 }]}>
        <ScrollView contentContainerStyle={styles.centerRoot} showsVerticalScrollIndicator={false}>
        <Text style={styles.victoryLaurel}>{'🌿⭐️🌿'}</Text>
        <Text style={styles.victoryTitle}>VICTORY!</Text>
        {MONSTER_ART[active.id] ? (
          <ExpoImage source={MONSTER_ART[active.id].normal} style={styles.doneImg} contentFit="contain" />
        ) : (
          <Text style={styles.doneEmoji}>{MONSTER_TAMED_EMOJI[active.id] ?? '\u{2728}'}</Text>
        )}
        <Text style={styles.victoryText}>{active.tamed}</Text>
        {reward != null && reward > 0 && (
          <View style={styles.rewardBlock}>
            <View style={styles.rewardRibbon}>
              <Text style={styles.rewardRibbonText}>Rewards</Text>
            </View>
            <Text style={styles.rewardClover}>{'🍀'}</Text>
            <Text style={styles.rewardCount}>x{reward}</Text>
            {milestoneBonus > 0 && (
              <Text style={styles.milestoneText}>Milestone bonus +{milestoneBonus} 🍀</Text>
            )}
          </View>
        )}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.confirmBtn, pressed && { transform: [{ translateY: 2 }] }, { marginBottom: insets.bottom }]}
        >
          <Text style={styles.confirmText}>Confirm</Text>
        </Pressable>
        </ScrollView>
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

  hintBar: { borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#5A4A2B', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  hintText: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 19 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32 },
  monsterCell: { width: '48%', borderRadius: 20, padding: 18, marginBottom: 14, alignItems: 'center', shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  monsterEmoji: { fontSize: 40, marginBottom: 8 },
  monsterImg: { width: 92, height: 92, marginBottom: 8 },
  monsterName: { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  monsterSkills: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 4 },
  tamedBadge: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  tamedBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  prepRoot: { flex: 1, backgroundColor: '#F6E7C8' },
  prepScroll: { flexGrow: 1, paddingHorizontal: 20, alignItems: 'center' },
  prepNameBubble: {
    backgroundColor: '#EFD9A8', borderRadius: 18, paddingHorizontal: 26, paddingVertical: 13,
    marginBottom: 22,
  },
  prepNameTail: {
    position: 'absolute', bottom: -11, left: '38%',
    width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 12, borderTopWidth: 13,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#EFD9A8',
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
  claimedChip: {
    marginTop: 4, backgroundColor: '#7BB661', borderRadius: 9,
    paddingHorizontal: 9, paddingVertical: 2,
  },
  claimedText: { fontSize: 10.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', letterSpacing: 0.4 },
  prepStatsBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', marginTop: 18,
    backgroundColor: '#FBF2DE', borderRadius: 16, borderWidth: 1.5, borderColor: '#E0CBA0',
    paddingVertical: 14, paddingHorizontal: 14,
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
    borderWidth: 2, borderColor: '#2B2B2B',
    shadowColor: '#2B2B2B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 2, height: 3 },
    elevation: 3,
  },
  startTamingText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  prepClose: {
    marginTop: 14, width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#FFFFFF', borderWidth: 2.5, borderColor: '#2B2B2B',
    alignItems: 'center', justifyContent: 'center',
  },
  prepCloseX: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  beginBtn: { paddingHorizontal: 48, paddingVertical: 18, borderRadius: 18, shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  beginText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  exitLink: { paddingVertical: 8 },
  exitText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // ---- battle (dark dungeon per mock; art asset lands later, solid tones now) ----
  battleRoot: { flex: 1, backgroundColor: '#2A2140' },
  battleScene: {
    flexShrink: 1,
    alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18,
    overflow: 'hidden',
  },
  monsterBubble: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18,
    maxWidth: '90%', marginBottom: 10,
  },
  monsterBubbleText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#2B2B2B', textAlign: 'center', lineHeight: 22 },
  monsterBubbleTail: {
    position: 'absolute', bottom: -8, alignSelf: 'center', width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 9,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFFFFF',
  },
  battleEmoji: { fontSize: 110 },
  battleImg: { width: 184, height: 184 },
  monsterWrap: { alignSelf: 'center', alignItems: 'center' },
  damagePop: {
    position: 'absolute', top: -6, alignSelf: 'center', zIndex: 2,
    fontSize: 30, fontFamily: 'Inter_800ExtraBold', color: '#E5484D',
    textShadowColor: '#FFFFFF', textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 },
  },
  // Pixel-flavored HP bar: hard corners, chunky dark border, red fill.
  hpTrack: {
    width: '72%', height: 22, borderRadius: 3, backgroundColor: '#FFFFFF',
    borderWidth: 3, borderColor: '#17121F', overflow: 'hidden',
  },
  hpFill: { height: '100%', backgroundColor: '#E4593C' },
  hpLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  skillPanel: {
    flex: 1, backgroundColor: '#1B1626', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 14,
  },
  rowsWrap: { gap: 10, paddingBottom: 10, paddingTop: 2 },
  argRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14,
  },
  argIcon: { width: 30, height: 30 },
  argText: { flex: 1, fontSize: 14.5, fontFamily: 'Inter_700Bold', color: '#7A4A16' },
  panelHint: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', marginBottom: 10 },

  zoomBackdrop: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,7,18,0.82)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 18,
  },
  zoomTextCard: {
    width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 24,
    paddingVertical: 30, paddingHorizontal: 26, alignItems: 'center', gap: 16,
  },
  zoomIcon: { width: 52, height: 52 },
  zoomArgument: { fontSize: 15.5, fontFamily: 'Inter_700Bold', color: '#2A2118', lineHeight: 24 },
  zoomHint: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.7)', textAlign: 'center' },

  titleBanner: {
    backgroundColor: '#4A3220', borderRadius: 20, paddingVertical: 16, paddingHorizontal: 20,
    marginTop: 4, marginBottom: 16,
  },
  titleBannerText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  titleBannerSub: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 4 },

  // ---- victory ----
  victoryLaurel: { fontSize: 34 },
  victoryTitle: { fontSize: 40, fontFamily: 'Inter_800ExtraBold', color: '#F7CE46', letterSpacing: 2 },
  victoryText: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', textAlign: 'center', lineHeight: 26, paddingHorizontal: 24 },
  rewardBlock: { alignItems: 'center', gap: 6 },
  rewardRibbon: { backgroundColor: '#F7CE46', borderRadius: 10, paddingHorizontal: 22, paddingVertical: 6 },
  rewardRibbonText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
  rewardClover: { fontSize: 42, marginTop: 4 },
  rewardCount: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  milestoneText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#F7CE46', marginTop: 4 },
  confirmBtn: {
    backgroundColor: '#F7CE46', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 64,
    borderWidth: 2, borderColor: '#2B2B2B',
    shadowColor: '#000', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 2, height: 3 },
    elevation: 4,
  },
  confirmText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },

  doneEmoji: { fontSize: 96 },
  doneImg: { width: 170, height: 170 },
});
