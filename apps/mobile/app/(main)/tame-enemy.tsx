import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { MONSTER_HP, applyHit, monsterTier, isTamed, type SkillKind } from '@novame/engine';
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
  const [firstTime, setFirstTime] = useState(false);
  const [active, setActive] = useState<MonsterStatus | null>(null);
  const [allSkills, setAllSkills] = useState<Skill[]>(() => getCachedSkills());
  const [hp, setHp] = useState(MONSTER_HP);
  const [hits, setHits] = useState(0);
  const [usedSkillIds, setUsedSkillIds] = useState<string[]>([]);
  const [showDrawer, setShowDrawer] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchTameStatus().then((r) => {
        setMonsters(r.monsters);
        setDoneToday(r.doneToday);
        setFirstTime(r.monsters.every((m) => !m.tamedBefore));
      });
      void fetchSkills().then(setAllSkills);
    }, []),
  );

  // Skills for the active monster's dimension = its battle pool.
  const pool = useMemo(
    () => (active ? allSkills.filter((s) => s.dimension === active.dimension) : []),
    [active, allSkills],
  );

  function startBattle(m: MonsterStatus) {
    // Every monster is playable: Just Breathe is the default when a dimension
    // has no skills yet (weak but always finishes), so 0 skills never blocks.
    void haptics.medium();
    setActive(m);
    setHp(MONSTER_HP);
    setHits(0);
    setUsedSkillIds([]);
    setPhase('prep');
  }

  function hit(kind: SkillKind, skillId?: string) {
    const next = applyHit(hp, kind);
    setHp(next);
    setHits((h) => h + 1);
    if (skillId) setUsedSkillIds((ids) => (ids.includes(skillId) ? ids : [...ids, skillId]));

    const tier = monsterTier(next);
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
    await submitTame({ monsterId: active.id, skillsUsed: usedSkillIds, hits: hits + 1 });
    markTameEnemyDoneToday();
    setPhase('done');
  }

  function exit() {
    setPhase('select');
    setActive(null);
  }

  const tier = monsterTier(hp);
  const monsterScale = tier === 'healthy' ? 1 : tier === 'wounded' ? 0.8 : 0.6;

  // ---- SELECT ----
  if (phase === 'select') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.tameEnemy} />
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={kit.textSub} />
        </Pressable>
        <Text style={[styles.h1, { color: kit.text }]}>What's been loud lately?</Text>
        <Text style={[styles.sub, { color: kit.textSub }]}>
          Pick what's closest — we'll figure out the rest together.
        </Text>

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
              You've tamed one today. Come back tomorrow for another.
            </Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {monsters.map((m) => {
            const ready = m.skillCount > 0;
            return (
              <Pressable
                key={m.id}
                onPress={() => (doneToday ? undefined : startBattle(m))}
                style={[styles.monsterCell, { backgroundColor: kit.card, borderColor: kit.border, opacity: doneToday ? 0.5 : 1 }]}
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

  // ---- PREP ----
  if (phase === 'prep' && active) {
    return (
      <View style={[styles.root, styles.centerRoot, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.tameEnemy} />
        <Text style={styles.prepEmoji}>{MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}</Text>
        <Text style={[styles.prepText, { color: kit.text }]}>{active.prep}</Text>
        <Pressable onPress={() => { void haptics.medium(); setPhase('battle'); }} style={[styles.beginBtn, { backgroundColor: kit.accent, marginBottom: insets.bottom }]}>
          <Text style={styles.beginText}>Begin</Text>
        </Pressable>
        <Pressable onPress={exit} style={styles.exitLink}>
          <Text style={[styles.exitText, { color: kit.textMuted }]}>Not now</Text>
        </Pressable>
      </View>
    );
  }

  // ---- BATTLE ----
  if (phase === 'battle' && active) {
    const visible = showDrawer ? pool : pool.slice(0, 6);
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.tameEnemy} />
        <Pressable onPress={exit} style={styles.back} hitSlop={12}>
          <MaterialIcons name="close" size={24} color={kit.textSub} />
        </Pressable>

        {/* Monster */}
        <View style={styles.battleMonster}>
          <Text style={[styles.battleEmoji, { transform: [{ scale: monsterScale }], opacity: tier === 'wounded' ? 0.8 : 1 }]}>
            {MONSTER_EMOJI[active.id] ?? '\u{1F47E}'}
          </Text>
          <View style={[styles.hpTrack, { backgroundColor: 'rgba(58,46,26,0.15)' }]}>
            <View style={[styles.hpFill, { width: `${(hp / MONSTER_HP) * 100}%`, backgroundColor: kit.danger }]} />
          </View>
          <Text style={[styles.monsterName, { color: kit.textSub }]}>{active.name}</Text>
        </View>

        {/* Skill cards */}
        <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardList} showsVerticalScrollIndicator={false}>
          {pool.length === 0 ? (
            <Pressable onPress={() => hit('default')} style={[styles.skillCard, { backgroundColor: kit.card, borderColor: kit.border }]}>
              <Text style={[styles.skillName, { color: kit.text }]}>Just Breathe</Text>
              <Text style={[styles.skillDesc, { color: kit.textMuted }]}>Something everyone already knows how to do.</Text>
            </Pressable>
          ) : (
            visible.map((sk) => (
              <Pressable
                key={sk.skillId}
                onPress={() => hit(sk.rarity === 'secret' ? 'hidden' : 'learned', sk.skillId)}
                style={[styles.skillCard, { backgroundColor: kit.card, borderColor: sk.rarity === 'secret' ? kit.secret : kit.border }]}
              >
                <Text style={[styles.skillName, { color: kit.text }]}>{sk.title}</Text>
                <Text style={[styles.skillDesc, { color: kit.textSub }]} numberOfLines={2}>{sk.body}</Text>
              </Pressable>
            ))
          )}
          {pool.length > 6 && !showDrawer && (
            <Pressable onPress={() => setShowDrawer(true)} style={styles.moreBtn}>
              <Text style={[styles.moreText, { color: kit.accent }]}>Show all {pool.length} skills</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    );
  }

  // ---- DONE ----
  if (phase === 'done' && active) {
    return (
      <View style={[styles.root, styles.centerRoot, { paddingTop: insets.top + 8 }]}>
        <WaveBackground palette={WAVE_PALETTES.tameEnemy} />
        <Text style={styles.doneEmoji}>{MONSTER_TAMED_EMOJI[active.id] ?? '\u{2728}'}</Text>
        <Text style={[styles.doneText, { color: kit.text }]}>{active.tamed}</Text>
        <Pressable onPress={() => router.back()} style={[styles.beginBtn, { backgroundColor: kit.accent, marginBottom: insets.bottom }]}>
          <Text style={styles.beginText}>Done</Text>
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

  prepEmoji: { fontSize: 88 },
  prepText: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 30, paddingHorizontal: 20 },
  beginBtn: { paddingHorizontal: 48, paddingVertical: 18, borderRadius: 18, shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  beginText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  exitLink: { paddingVertical: 8 },
  exitText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  battleMonster: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  battleEmoji: { fontSize: 96 },
  hpTrack: { width: '70%', height: 8, borderRadius: 4, overflow: 'hidden' },
  hpFill: { height: '100%', borderRadius: 4 },

  cardScroll: { flex: 1 },
  cardList: { gap: 10, paddingBottom: 40 },
  skillCard: { borderRadius: 18, borderWidth: 0, padding: 18, shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  skillName: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  skillDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  moreBtn: { alignItems: 'center', paddingVertical: 12 },
  moreText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  doneEmoji: { fontSize: 96 },
  doneText: { fontSize: 20, fontFamily: 'Inter_600SemiBold', textAlign: 'center', lineHeight: 28, paddingHorizontal: 24 },
});
