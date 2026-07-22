import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import {
  MONSTER_HP, SKILL_DAMAGE, applyHit, monsterHpForStage, monsterTierFor, isTamed,
  nextMilestoneThresholds, BATTLE_MILESTONE_REWARD, type SkillKind,
} from '@novame/engine';
import { SKILL_LIBRARY_SIZE } from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import { WaveBackground, WAVE_PALETTES } from '../../src/components/main/wave-background';
import { haptics } from '../../src/lib/haptics';
import {
  fetchTameStatus, submitTame, markTameEnemyDoneToday, MONSTER_EMOJI, MONSTER_TAMED_EMOJI, type MonsterStatus,
} from '../../src/lib/tame-enemy-api';
import { fetchSkills, getCachedSkills, type Skill } from '../../src/lib/skills-api';

type Phase = 'select' | 'prep' | 'battle' | 'done';

/**
 * Tame Enemy (C9b). Four screens as phases: select an enemy, a prep line, the
 * battle (tap skill cards to hit; the monster shrinks by remaining-HP tier),
 * and the tamed screen. One tame a day across all monsters (server gate). The
 * battle resolves client-side with the shared engine; skills come from the
 * chosen monster's dimension. No skills -> Just Breathe (a weak default that
 * still always finishes). Quitting mid-battle keeps no progress (PRD).
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
  const [monsters, setMonsters] = useState<MonsterStatus[]>([]);
  const [doneToday, setDoneToday] = useState(false);
  const [perEnemyDaily, setPerEnemyDaily] = useState(false);
  const [battlePoints, setBattlePoints] = useState(0);
  const [firstTime, setFirstTime] = useState(false);
  const [active, setActive] = useState<MonsterStatus | null>(null);
  const [allSkills, setAllSkills] = useState<Skill[]>(() => getCachedSkills());
  const [hp, setHp] = useState(MONSTER_HP);
  const [maxHp, setMaxHp] = useState(MONSTER_HP);
  const [hits, setHits] = useState(0);
  const [usedSkillIds, setUsedSkillIds] = useState<string[]>([]);
  const [showDrawer, setShowDrawer] = useState(false);
  // Battle interactions per mock/PRD: single tap (or long-press) zooms a card,
  // double tap applies it. Tracked with a per-card timestamp — RN has no
  // built-in double-tap.
  const [zoomSkill, setZoomSkill] = useState<Skill | 'default' | null>(null);
  const [lastTap, setLastTap] = useState<{ id: string; at: number }>({ id: '', at: 0 });
  const [reward, setReward] = useState<number | null>(null);
  const [milestoneBonus, setMilestoneBonus] = useState(0);

  // BUG FIX: opening the zoom on the FIRST tap covered the hand with the
  // overlay, so the second tap always hit the backdrop and the double tap
  // never reached the card. The zoom now waits out the double-tap window
  // (pending timer); a second tap inside the window cancels it and applies.
  // The zoomed card is also directly tappable to apply (belt and braces).
  const DOUBLE_TAP_MS = 280;
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onCardTap(id: string, apply: () => void, zoom: () => void) {
    const now = Date.now();
    if (lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS) {
      if (zoomTimer.current) {
        clearTimeout(zoomTimer.current);
        zoomTimer.current = null;
      }
      setLastTap({ id: '', at: 0 });
      setZoomSkill(null);
      apply();
    } else {
      setLastTap({ id, at: now });
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
      zoomTimer.current = setTimeout(() => {
        zoomTimer.current = null;
        zoom();
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
      void fetchSkills().then(setAllSkills);
    }, []),
  );

  // Battle pool = the monster's dimension skills PLUS mega cards (dimension
  // null — the 9th library group, usable against every monster per Q13).
  const pool = useMemo(
    () =>
      active
        ? allSkills.filter((s) => s.dimension === active.dimension || s.dimension == null)
        : [],
    [active, allSkills],
  );

  /** Damage class: library tier wins; legacy rows fall back to rarity. */
  function kindFor(sk: Skill): SkillKind {
    if (sk.tier === 'advanced') return 'hidden';
    if (sk.tier === 'intermediate') return 'intermediate';
    if (sk.tier === 'normal') return 'learned';
    return sk.rarity === 'secret' ? 'hidden' : 'learned';
  }

  function startBattle(m: MonsterStatus) {
    // Every monster is playable: Just Breathe is the default when a dimension
    // has no skills yet (weak but always finishes), so 0 skills never blocks.
    void haptics.medium();
    setActive(m);
    // Staged HP (Q15): grows with prior tames of this monster, capped at 300.
    const cap = monsterHpForStage(m.tamedCount ?? 0);
    setMaxHp(cap);
    setHp(cap);
    setHits(0);
    setUsedSkillIds([]);
    setPhase('prep');
  }

  function hit(kind: SkillKind, skillId?: string) {
    const next = applyHit(hp, kind);
    setHp(next);
    setHits((h) => h + 1);
    if (skillId) setUsedSkillIds((ids) => (ids.includes(skillId) ? ids : [...ids, skillId]));

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
    const res = await submitTame({ monsterId: active.id, skillsUsed: usedSkillIds, hits: hits + 1 });
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
  const monsterScale = tier === 'healthy' ? 1 : tier === 'wounded' ? 0.8 : 0.6;

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
                : "You've tamed one today. Come back tomorrow for another."}
            </Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {monsters.map((m) => {
            const ready = m.skillCount > 0;
            // Free: one tame across all monsters. Paid: one per monster.
            const locked = perEnemyDaily ? m.tamedToday : doneToday;
            return (
              <Pressable
                key={m.id}
                onPress={() => (locked ? undefined : startBattle(m))}
                style={[styles.monsterCell, { backgroundColor: kit.card, borderColor: kit.border, opacity: locked ? 0.5 : 1 }]}
              >
                <Text style={styles.monsterEmoji}>{MONSTER_EMOJI[m.id] ?? '\u{1F47E}'}</Text>
                <Text style={[styles.monsterName, { color: kit.text }]}>{m.name}</Text>
                <Text style={[styles.monsterSkills, { color: ready ? kit.accent : kit.textMuted }]}>
                  {ready ? `${m.skillCount} skill${m.skillCount > 1 ? 's' : ''} ready` : 'Just Breathe ready'}
                </Text>
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
    const nextThresholds = nextMilestoneThresholds(battlePoints, 3);
    const skillsOwned = Math.min(allSkills.length, SKILL_LIBRARY_SIZE);
    return (
      <View style={[styles.prepRoot, { paddingTop: insets.top + 12 }]}>
        {/* name bubble */}
        <View style={styles.prepNameBubble}>
          <Text style={styles.prepNameText}>{active.name}</Text>
        </View>

        <Text style={styles.prepEmoji}>{MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}</Text>
        <Text style={[styles.prepQuote, { color: kit.text }]}>“{active.prep}”</Text>

        {/* milestone track: next three 🍀 rewards */}
        <View style={styles.milestoneTrack}>
          {nextThresholds.map((t, i) => (
            <View key={t} style={styles.milestoneNodeWrap}>
              {i > 0 && <View style={styles.milestoneLink} />}
              <View style={styles.milestoneNode}>
                <Text style={styles.milestoneClover}>{'🍀'}</Text>
                <Text style={styles.milestoneReward}>x{BATTLE_MILESTONE_REWARD}</Text>
              </View>
              <Text style={styles.milestoneThreshold}>{t.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        {/* history + skills chips */}
        <View style={styles.prepStatsBar}>
          <View style={styles.prepStatLeft}>
            <Text style={styles.prepStatEmoji}>{'🦖'}</Text>
            <View>
              <Text style={styles.prepStatTitle}>Tame History</Text>
              <View style={styles.ptsChip}>
                <Text style={styles.ptsChipText}>{battlePoints.toLocaleString()} pts</Text>
              </View>
            </View>
          </View>
          <View style={styles.prepStatRight}>
            <Text style={styles.prepStatEmoji}>{'🃏'}</Text>
            <View>
              <Text style={styles.prepStatTitle}>Skills</Text>
              <Text style={styles.prepStatValue}>{skillsOwned}/{SKILL_LIBRARY_SIZE}</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.prepHint, { color: kit.textSub }]}>
          Tame the monster to quiet {active.name.toLowerCase()}.
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
      </View>
    );
  }

  // ---- BATTLE (design: dark dungeon scene) ----
  if (phase === 'battle' && active) {
    const visible = showDrawer ? pool : pool.slice(0, 9);
    const powerFor = (sk: Skill | 'default') =>
      sk === 'default' ? 10 : SKILL_DAMAGE[kindFor(sk)];
    return (
      <View style={[styles.battleRoot, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={exit} style={styles.back} hitSlop={12}>
          <MaterialIcons name="close" size={24} color="rgba(255,255,255,0.7)" />
        </Pressable>

        {/* Monster speech bubble (prep line as its complaint) + monster */}
        <View style={styles.battleScene}>
          <View style={styles.monsterBubble}>
            <Text style={styles.monsterBubbleText}>{active.prep}</Text>
            <View style={styles.monsterBubbleTail} />
          </View>
          <Text style={[styles.battleEmoji, { transform: [{ scale: monsterScale }], opacity: tier === 'wounded' ? 0.85 : 1 }]}>
            {MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}
          </Text>
          {/* Pixel-flavored HP bar, labeled per the mock */}
          <View style={styles.hpTrack}>
            <View style={[styles.hpFill, { width: `${(hp / maxHp) * 100}%` }]} />
          </View>
          <Text style={styles.hpLabel}>Negative Power</Text>
        </View>

        {/* Bottom skill panel — tap to view, double tap to apply */}
        <View style={[styles.skillPanel, { paddingBottom: insets.bottom + 10 }]}>
          <ScrollView contentContainerStyle={styles.skillWrap} showsVerticalScrollIndicator={false}>
            {pool.length === 0 ? (
              <Pressable
                onPress={() => onCardTap('default', () => hit('default'), () => setZoomSkill('default'))}
                style={styles.skillChip}
              >
                <View style={styles.lvBadge}><Text style={styles.lvBadgeText}>Lv.1</Text></View>
                <Text style={styles.skillChipText} numberOfLines={2}>Just Breathe</Text>
              </Pressable>
            ) : (
              visible.map((sk) => (
                <Pressable
                  key={sk.skillId}
                  onPress={() =>
                    onCardTap(
                      sk.skillId,
                      () => hit(kindFor(sk), sk.skillId),
                      () => setZoomSkill(sk),
                    )
                  }
                  style={[styles.skillChip, sk.rarity === 'secret' && styles.skillChipSecret]}
                >
                  <View style={styles.lvBadge}>
                    <Text style={styles.lvBadgeText}>{sk.tier === 'advanced' || sk.rarity === 'secret' ? 'Lv.5' : sk.tier === 'intermediate' ? 'Lv.3' : 'Lv.2'}</Text>
                  </View>
                  <Text style={styles.skillChipText} numberOfLines={2}>{sk.title}</Text>
                </Pressable>
              ))
            )}
            {pool.length > 9 && !showDrawer && (
              <Pressable onPress={() => setShowDrawer(true)} style={styles.moreBtn}>
                <Text style={styles.moreText}>Show all {pool.length} skills</Text>
              </Pressable>
            )}
          </ScrollView>
          <Text style={styles.panelHint}>Tap to view, double tap to apply.</Text>
          <Text style={styles.panelHintSub}>Different cards land differently — tame the monster!</Text>
        </View>

        {/* Card zoom overlay (design: card details) */}
        {zoomSkill !== null && (
          <Pressable style={styles.zoomBackdrop} onPress={() => setZoomSkill(null)}>
            <Pressable
              style={styles.zoomCard}
              onPress={() => {
                const z = zoomSkill;
                setZoomSkill(null);
                if (z === 'default') hit('default');
                else if (z) hit(kindFor(z), z.skillId);
              }}
            >
              <Text style={styles.zoomTitle}>
                {zoomSkill === 'default' ? 'Just Breathe' : zoomSkill.title}
              </Text>
              <Text style={styles.zoomBody}>
                {zoomSkill === 'default'
                  ? 'Something everyone already knows how to do.'
                  : zoomSkill.body}
              </Text>
              <View style={styles.powerPill}>
                <Text style={styles.powerPillText}>{'⚔️'} {powerFor(zoomSkill)} Power</Text>
              </View>
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
      <View style={[styles.battleRoot, styles.centerRoot, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.victoryLaurel}>{'🌿⭐️🌿'}</Text>
        <Text style={styles.victoryTitle}>VICTORY!</Text>
        <Text style={styles.doneEmoji}>{MONSTER_TAMED_EMOJI[active.id] ?? '\u{2728}'}</Text>
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
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  centerRoot: { alignItems: 'center', justifyContent: 'center', gap: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  h1: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', marginTop: 4 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 16 },

  hintBar: { borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#5A4A2B', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  hintText: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 19 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32 },
  monsterCell: { width: '48%', borderRadius: 20, padding: 18, marginBottom: 14, alignItems: 'center', shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  monsterEmoji: { fontSize: 40, marginBottom: 8 },
  monsterName: { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  monsterSkills: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 4 },
  tamedBadge: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  tamedBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  prepRoot: { flex: 1, backgroundColor: '#F6E7C8', paddingHorizontal: 20, alignItems: 'center' },
  prepNameBubble: {
    backgroundColor: '#EFD9A8', borderRadius: 18, paddingHorizontal: 24, paddingVertical: 12,
    marginBottom: 14,
  },
  prepNameText: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  prepEmoji: { fontSize: 96 },
  prepQuote: { fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 24, paddingHorizontal: 16, marginTop: 10 },
  milestoneTrack: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 22, paddingHorizontal: 8 },
  milestoneNodeWrap: { alignItems: 'center', flex: 1 },
  milestoneLink: { position: 'absolute', top: 22, right: '58%', left: '-42%', height: 3, backgroundColor: '#E0CBA0' },
  milestoneNode: { alignItems: 'center' },
  milestoneClover: { fontSize: 32 },
  milestoneReward: { position: 'absolute', top: -6, right: -26, fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  milestoneThreshold: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', marginTop: 6 },
  prepStatsBar: {
    flexDirection: 'row', width: '100%', marginTop: 18,
    backgroundColor: '#FBF2DE', borderRadius: 16, borderWidth: 1.5, borderColor: '#E0CBA0',
    padding: 12, justifyContent: 'space-between',
  },
  prepStatLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1.4 },
  prepStatRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'flex-end' },
  prepStatEmoji: { fontSize: 26 },
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
  battleRoot: { flex: 1, backgroundColor: '#2A2140', paddingHorizontal: 20 },
  battleScene: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
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
  // Pixel-flavored HP bar: hard corners, chunky dark border, red fill.
  hpTrack: {
    width: '72%', height: 22, borderRadius: 3, backgroundColor: '#FFFFFF',
    borderWidth: 3, borderColor: '#17121F', overflow: 'hidden',
  },
  hpFill: { height: '100%', backgroundColor: '#E4593C' },
  hpLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  skillPanel: {
    backgroundColor: '#1B1626', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    marginHorizontal: -20, paddingHorizontal: 16, paddingTop: 14, maxHeight: 300,
  },
  skillWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingBottom: 8 },
  skillChip: {
    width: 92, borderRadius: 12, backgroundColor: '#3A2C55', borderWidth: 2, borderColor: '#6C4FA3',
    padding: 8, alignItems: 'center', gap: 6,
  },
  skillChipSecret: { borderColor: '#F0C24B', backgroundColor: '#4A3B20' },
  lvBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  lvBadgeText: { fontSize: 10, fontFamily: 'Inter_800ExtraBold', color: '#F0C24B' },
  skillChipText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', lineHeight: 16 },
  moreBtn: { alignItems: 'center', paddingVertical: 10, width: '100%' },
  moreText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#B9A6E8' },
  panelHint: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', marginTop: 4 },
  panelHintSub: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 2 },

  zoomBackdrop: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,7,18,0.82)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 18,
  },
  zoomCard: {
    width: '100%', backgroundColor: '#F5A445', borderRadius: 22, borderWidth: 4, borderColor: '#3B4A8F',
    paddingVertical: 36, paddingHorizontal: 22, alignItems: 'center', gap: 14, minHeight: 300, justifyContent: 'center',
  },
  zoomTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  zoomBody: { fontSize: 15, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', lineHeight: 22, textAlign: 'center' },
  powerPill: {
    backgroundColor: '#F7CE46', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 10,
    borderWidth: 2, borderColor: '#2B2B2B',
  },
  powerPillText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B' },
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
});
