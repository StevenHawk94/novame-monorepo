import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  DIMENSION_IDS,
  DIMENSIONS,
  TRUE_NORTH_PHRASES,
  TRUE_NORTH_FOCUS_POINTS,
  TRUE_NORTH_RELEASE_POINTS,
  TRUE_NORTH_GEMS_BY_RANK,
  type DimensionId,
} from '@novame/domain';
import { GridBackground } from '../../src/components/ui/grid-background';
import { CloverBurst } from '../../src/components/main/clover-burst';
import { XP_RULES } from '@novame/engine';
import { optimisticCloverAward } from '../../src/lib/cosmetics-api';
import {
  fetchStatus,
  getCachedStatus,
  submitTrueNorth,
  type TrueNorthStatus,
} from '../../src/lib/true-north-api';

type Phase = 'intro' | 'rank' | 'reveal';

function currentLocalWeekSeed(): string {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
  return [monday.getFullYear(), monday.getMonth() + 1, monday.getDate()].join('-');
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function stableSample<T>(items: readonly T[], count: number, seed: string): T[] {
  const shuffled = [...items];
  const random = stableRandom(hashSeed(seed));
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

// Light warm palette for the Kit screen over the wave backdrop (coral/red tone).
const KIT_PALETTE = {
  text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
  card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
  accent: '#D9694E', danger: '#D9694E',
};

export default function TrueNorthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const kit = KIT_PALETTE;

  // Cache-first (2026-08-05): the entry paints instantly from the cached
  // weekly status — done weeks open straight on the saved ranking, fresh
  // weeks on the intro. The network fetch below only reconciles.
  const cached = getCachedStatus();
  const [status, setStatus] = useState<TrueNorthStatus>(cached);
  const [phase, setPhase] = useState<Phase>(
    cached.doneThisWeek && cached.thisWeekRanking ? 'reveal' : 'intro',
  );
  const [picked, setPicked] = useState<DimensionId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealRanking, setRevealRanking] = useState<DimensionId[] | null>(
    cached.doneThisWeek ? cached.thisWeekRanking : null,
  );
  // The clover burst fires only on a FRESH submit, never when re-opening a
  // completed week from cache.
  const [justEarned, setJustEarned] = useState(false);

  // Background reconcile: flip to reveal if the server knows this week is
  // done (stale cache), or back to intro when a new week started — without
  // ever yanking the user out of an in-progress ranking.
  useEffect(() => {
    let active = true;
    fetchStatus().then((s) => {
      if (!active) return;
      setStatus(s);
      setPhase((prev) => {
        if (prev === 'rank') return prev;
        if (s.doneThisWeek && s.thisWeekRanking) {
          setRevealRanking(s.thisWeekRanking);
          return 'reveal';
        }
        if (!s.doneThisWeek && prev === 'reveal' && !justEarned) {
          setRevealRanking(null);
          return 'intro';
        }
        return prev;
      });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = useMemo(
    () => DIMENSION_IDS.filter((d) => !picked.includes(d)),
    [picked],
  );

  function pick(d: DimensionId) {
    if (picked.includes(d)) {
      setPicked(picked.filter((x) => x !== d)); // tap to unpick
    } else {
      setPicked([...picked, d]);
    }
  }

  function confirm() {
    if (picked.length !== DIMENSION_IDS.length || submitting) return;
    setSubmitting(true);
    setError(null);
    const expected = XP_RULES.trueNorth.award;
    const award = optimisticCloverAward(expected);
    setJustEarned(true);
    setRevealRanking(picked);
    setPhase('reveal');

    void submitTrueNorth(picked).then(async (res) => {
      setSubmitting(false);
      if (res.ok) {
        award.commit(res.xpAwarded);
        return;
      }
      setJustEarned(false);
      award.rollback();
      if (res.error === 'already_done') {
        const s = await fetchStatus();
        setRevealRanking(s.thisWeekRanking ?? picked);
      }
    });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <GridBackground base="#EF9C8E" line="#E5887B" cell={22} lineWidth={1.2} />
      <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
        <Text style={[styles.closeText, { color: kit.textSub }]}>Close</Text>
      </Pressable>

      {phase === 'intro' && (
        <View style={styles.center}>
          <Text style={[styles.introTitle, { color: kit.text }]}>
            Let’s find out what’s really on top right now.
          </Text>
          <Pressable
            onPress={() => setPhase('rank')}
            style={({ pressed }) => [styles.startBtn, { backgroundColor: kit.accent, opacity: pressed ? 0.85 : 1 }, pressed && styles.btnPressed]}
          >
            <Text style={styles.primaryBtnText}>Start</Text>
          </Pressable>
        </View>
      )}

      {phase === 'rank' && (
        <View style={styles.rankWrap}>
          <Text style={[styles.rankTitle, { color: kit.text }]}>
            Tap to rank what matters most right now.
          </Text>
          <Text style={[styles.rankSub, { color: kit.textMuted }]}>
            {picked.length} of {DIMENSION_IDS.length} ranked
          </Text>
          <ScrollView contentContainerStyle={styles.cards} showsVerticalScrollIndicator={false}>
            {DIMENSION_IDS.map((d) => {
              const rank = picked.indexOf(d);
              const isPicked = rank >= 0;
              return (
                <Pressable
                  key={d}
                  onPress={() => pick(d)}
                  style={[
                    styles.rankCard,
                    { backgroundColor: isPicked ? '#FFF0EB' : kit.card },
                  ]}
                >
                  <View
                    style={[
                      styles.rankBadge,
                      { backgroundColor: isPicked ? kit.accent : '#EADFD0' },
                    ]}
                  >
                    <Text style={[styles.rankBadgeText, { color: isPicked ? '#FFFFFF' : kit.textMuted }]}>
                      {isPicked ? rank + 1 : ''}
                    </Text>
                  </View>
                  <Text style={[styles.rankPhrase, { color: kit.text }]}>
                    {TRUE_NORTH_PHRASES[d]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {error && <Text style={[styles.error, { color: kit.danger }]}>{error}</Text>}
          <Pressable
            onPress={confirm}
            disabled={picked.length !== DIMENSION_IDS.length || submitting}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: kit.accent,
                opacity: picked.length !== DIMENSION_IDS.length || submitting ? 0.4 : pressed ? 0.85 : 1,
                marginBottom: insets.bottom + 12,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Confirm order</Text>
            )}
          </Pressable>
        </View>
      )}

      {phase === 'reveal' && revealRanking && (
        <Reveal
          ranking={revealRanking}
          lastRanking={status.lastRanking}
          showReward={justEarned}
          colors={KIT_PALETTE}
          onDone={() => router.back()}
        />
      )}
    </View>
  );
}

function Reveal({
  ranking,
  lastRanking,
  showReward,
  colors: c,
  onDone,
}: {
  ranking: DimensionId[];
  lastRanking: DimensionId[] | null;
  showReward: boolean;
  colors: typeof KIT_PALETTE;
  onDone: () => void;
}) {
  void lastRanking; // the mock drops the week-over-week comparison
  void c;
  // Keep the reveal concise: surface five points from each top-two dimension.
  // The week + complete ranking seed freezes the result for the entire weekly
  // period, while a newly ranked week receives a fresh combination.
  const focusPoints = useMemo(
    () => {
      const resultSeed = `${currentLocalWeekSeed()}:${ranking.join(',')}`;
      return ranking.slice(0, 2).flatMap((dim) =>
        stableSample(TRUE_NORTH_FOCUS_POINTS[dim], 5, `${resultSeed}:${dim}`),
      );
    },
    [ranking],
  );
  const bottom = ranking[ranking.length - 1];
  // Podium trophies use the dedicated art set (assets/Icons/true-north-N.png).
  const medals = [
    require('../../assets/Icons/true-north-1.png'),
    require('../../assets/Icons/true-north-2.png'),
    require('../../assets/Icons/true-north-3.png'),
  ];

  // Podium card, extracted so the 2-1-3 layout below stays readable.
  const podium = (rank: number) => (
    <View style={[styles.podiumCard, rank === 0 && styles.podiumCardFirst]}>
      <Image source={medals[rank]} style={styles.podiumMedal} resizeMode="contain" />
      <Text style={styles.podiumPhrase}>{TRUE_NORTH_PHRASES[ranking[rank]]}</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.revealScroll} showsVerticalScrollIndicator={false}>
      {/* Design: brown banner headline */}
      <View style={styles.revealBanner}>
        <Text style={styles.revealBannerText}>
          The True North direction of your life at the moment
        </Text>
      </View>

      {showReward && <CloverBurst amount={XP_RULES.trueNorth.award} />}

      {/* Podium: #1 raised center, #2 left, #3 right */}
      <View style={styles.podiumFirstRow}>{podium(0)}</View>
      <View style={styles.podiumRow}>
        {podium(1)}
        {podium(2)}
      </View>

      {/* What matters most — five points from each top-two dimension */}
      <View style={styles.revealCard}>
        <View style={styles.revealCardHeader}>
          <Text style={styles.revealCardEmoji}>{'🎯'}</Text>
          <Text style={styles.revealCardTitle}>What matters to you most:</Text>
        </View>
        {focusPoints.map((line, index) => (
          <Text key={`${index}:${line}`} style={styles.bullet}>{'•'}  {line}</Text>
        ))}
      </View>

      {/* What to release — the last-ranked dimension */}
      <View style={styles.revealCard}>
        <View style={styles.revealCardHeader}>
          <Text style={styles.revealCardEmoji}>{'🍃'}</Text>
          <Text style={styles.revealCardTitle}>What you should forgive and forget</Text>
        </View>
        {TRUE_NORTH_RELEASE_POINTS[bottom].map((line) => (
          <Text key={line} style={styles.bullet}>{'•'}  {line}</Text>
        ))}
      </View>

      <Pressable onPress={onDone} style={styles.revealClose} hitSlop={10}>
        <Text style={styles.revealCloseX}>✕</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  close: { alignSelf: 'flex-start', paddingVertical: 8 },
  closeText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32, paddingHorizontal: 12 },

  introTitle: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', lineHeight: 35, textAlign: 'center' },

  rankWrap: { flex: 1, paddingTop: 12 },
  rankTitle: { fontSize: 25, fontFamily: 'Inter_800ExtraBold', lineHeight: 32, marginBottom: 6 },
  rankSub: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 16 },
  cards: { paddingBottom: 16 },
  rankCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 18, marginBottom: 12,
    shadowColor: '#70473E', shadowOpacity: 0.16, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  rankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rankBadgeText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  rankPhrase: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  revealScroll: { paddingVertical: 16, paddingBottom: 40, gap: 26 },
  revealBanner: { backgroundColor: '#4A3220', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18 },
  revealBannerText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', lineHeight: 22 },
  podiumFirstRow: { alignItems: 'center' },
  podiumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  podiumCard: {
    flex: 1, backgroundColor: '#FDF6E9', borderRadius: 18,
    paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center',
    shadowColor: '#70473E', shadowOpacity: 0.16, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  podiumCardFirst: { minWidth: '60%', flex: 0 },
  podiumMedal: { width: 44, height: 44, marginTop: -38, marginBottom: 4 },
  podiumPhrase: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B', textAlign: 'center', lineHeight: 22 },
  revealCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20,
    padding: 18,
    shadowColor: '#70473E', shadowOpacity: 0.14, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  revealCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  revealCardEmoji: { fontSize: 20, lineHeight: 24 },
  revealCardTitle: {
    flex: 1, flexShrink: 1, fontSize: 17, lineHeight: 23,
    fontFamily: 'Inter_800ExtraBold', color: '#2B2B2B',
  },
  bullet: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#3A2E1A', lineHeight: 26, marginLeft: 8 },
  revealClose: {
    alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: '#1B1B1B',
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  revealCloseX: { color: '#F6D68A', fontSize: 20, fontFamily: 'Inter_800ExtraBold' },

  primaryBtn: {
    borderRadius: 16, paddingVertical: 17, alignItems: 'center',
    shadowColor: '#70473E', shadowOpacity: 0.2, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  startBtn: {
    borderRadius: 18, paddingVertical: 18, paddingHorizontal: 64, alignItems: 'center',
    shadowColor: '#70473E', shadowOpacity: 0.18, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  btnPressed: { transform: [{ translateX: 2 }, { translateY: 3 }] },
  primaryBtnText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },
  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginVertical: 8 },
});
