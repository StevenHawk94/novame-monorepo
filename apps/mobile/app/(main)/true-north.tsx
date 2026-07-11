import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  DIMENSION_IDS,
  DIMENSIONS,
  TRUE_NORTH_PHRASES,
  TRUE_NORTH_GEMS_BY_RANK,
  type DimensionId,
} from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import {
  fetchStatus,
  getCachedStatus,
  submitTrueNorth,
  type TrueNorthStatus,
} from '../../src/lib/true-north-api';

type Phase = 'loading' | 'intro' | 'rank' | 'reveal';

export default function TrueNorthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;

  const [status, setStatus] = useState<TrueNorthStatus>(() => getCachedStatus());
  const [phase, setPhase] = useState<Phase>('loading');
  const [picked, setPicked] = useState<DimensionId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealRanking, setRevealRanking] = useState<DimensionId[] | null>(null);

  // On mount, get the real weekly status; decide whether to rank or show last.
  useEffect(() => {
    let active = true;
    fetchStatus().then((s) => {
      if (!active) return;
      setStatus(s);
      if (s.doneThisWeek && s.thisWeekRanking) {
        setRevealRanking(s.thisWeekRanking);
        setPhase('reveal');
      } else {
        setPhase('intro');
      }
    });
    return () => {
      active = false;
    };
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

  async function confirm() {
    if (picked.length !== DIMENSION_IDS.length || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await submitTrueNorth(picked);
    setSubmitting(false);
    if (res.ok) {
      setRevealRanking(picked);
      setPhase('reveal');
    } else if (res.error === 'already_done') {
      // Someone raced us; show whatever the server has.
      const s = await fetchStatus();
      setRevealRanking(s.thisWeekRanking ?? picked);
      setPhase('reveal');
    } else if (res.error === 'companion_not_ready') {
      setError('Your companion isn’t set up yet.');
    } else {
      setError('Couldn’t save that. Try again.');
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
        <Text style={[styles.closeText, { color: c.textSecondary }]}>Close</Text>
      </Pressable>

      {phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={c.brand.primary} />
        </View>
      )}

      {phase === 'intro' && (
        <View style={styles.center}>
          <Text style={[styles.introTitle, { color: c.textPrimary }]}>
            Let’s find out what’s really on top right now.
          </Text>
          <Pressable
            onPress={() => setPhase('rank')}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.brand.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.primaryBtnText}>Start</Text>
          </Pressable>
        </View>
      )}

      {phase === 'rank' && (
        <View style={styles.rankWrap}>
          <Text style={[styles.rankTitle, { color: c.textPrimary }]}>
            Tap to rank what matters most right now.
          </Text>
          <Text style={[styles.rankSub, { color: c.textMuted }]}>
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
                    {
                      backgroundColor: c.bgCard,
                      borderColor: isPicked ? c.brand.primary : c.border,
                      borderWidth: isPicked ? 2 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.rankBadge,
                      { backgroundColor: isPicked ? c.brand.primary : c.progressTrack },
                    ]}
                  >
                    <Text style={[styles.rankBadgeText, { color: isPicked ? '#FFFFFF' : c.textMuted }]}>
                      {isPicked ? rank + 1 : ''}
                    </Text>
                  </View>
                  <Text style={[styles.rankPhrase, { color: c.textPrimary }]}>
                    {TRUE_NORTH_PHRASES[d]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {error && <Text style={[styles.error, { color: c.brand.danger }]}>{error}</Text>}
          <Pressable
            onPress={confirm}
            disabled={picked.length !== DIMENSION_IDS.length || submitting}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: c.brand.primary,
                opacity: picked.length !== DIMENSION_IDS.length || submitting ? 0.4 : pressed ? 0.85 : 1,
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
        <Reveal ranking={revealRanking} lastRanking={status.lastRanking} colors={c} onDone={() => router.back()} />
      )}
    </View>
  );
}

function Reveal({
  ranking,
  lastRanking,
  colors: c,
  onDone,
}: {
  ranking: DimensionId[];
  lastRanking: DimensionId[] | null;
  colors: ReturnType<typeof useTheme>['theme']['colors'];
  onDone: () => void;
}) {
  const top = ranking[0];
  const bottom = ranking[ranking.length - 1];

  // Biggest mover vs last week, if there is a last week.
  const mover = useMemo((): {
    dim: DimensionId;
    from: number;
    to: number;
    delta: number;
  } | null => {
    if (!lastRanking) return null;
    const moves = ranking
      .map((d, to) => {
        const fromIdx = lastRanking.indexOf(d);
        return { dim: d, from: fromIdx + 1, to: to + 1, delta: fromIdx - to };
      })
      .filter((m) => m.from > 0 && m.delta !== 0);
    if (moves.length === 0) return null;
    return moves.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
  }, [ranking, lastRanking]);

  return (
    <ScrollView contentContainerStyle={styles.revealScroll} showsVerticalScrollIndicator={false}>
      {ranking.map((d, i) => {
        const gems = i < TRUE_NORTH_GEMS_BY_RANK.length ? TRUE_NORTH_GEMS_BY_RANK[i] : 0;
        return (
          <View
            key={d}
            style={[
              styles.revealRow,
              {
                backgroundColor: i < 3 ? c.bgCard : 'transparent',
                borderColor: i < 3 ? c.border : 'transparent',
                opacity: 1 - i * 0.07,
              },
            ]}
          >
            <View style={[styles.revealDot, { backgroundColor: DIMENSIONS[d].color }]} />
            <Text style={[styles.revealPhrase, { color: c.textPrimary }]}>{TRUE_NORTH_PHRASES[d]}</Text>
            {gems > 0 && <Text style={[styles.revealGems, { color: c.brand.primary }]}>+{gems}</Text>}
          </View>
        );
      })}

      <View style={styles.interpret}>
        <Text style={[styles.interpretLine, { color: c.textPrimary }]}>
          Right now, {TRUE_NORTH_PHRASES[top].toLowerCase()} is what’s pulling most of your attention.
        </Text>
        <Text style={[styles.interpretLine, { color: c.textSecondary }]}>
          {TRUE_NORTH_PHRASES[bottom]} is sitting quietly in the background — not gone, just waiting.
        </Text>
        {mover && (
          <Text style={[styles.interpretLine, { color: c.textSecondary }]}>
            {TRUE_NORTH_PHRASES[mover.dim]}{' '}
            {mover.delta > 0
              ? `climbed from #${mover.from} to #${mover.to} — seems like it’s been on your mind more.`
              : `slipped from #${mover.from} to #${mover.to}.`}
          </Text>
        )}
        <Text style={[styles.interpretFooter, { color: c.textMuted }]}>
          If anything here feels unclear, Reflect is always here to help you find your own answer.
        </Text>
      </View>

      <Pressable
        onPress={onDone}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.brand.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={styles.primaryBtnText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  close: { alignSelf: 'flex-start', paddingVertical: 8 },
  closeText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32, paddingHorizontal: 12 },

  introTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', lineHeight: 34, textAlign: 'center' },

  rankWrap: { flex: 1, paddingTop: 12 },
  rankTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  rankSub: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 16 },
  cards: { paddingBottom: 16 },
  rankCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 10 },
  rankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rankBadgeText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  rankPhrase: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium' },

  revealScroll: { paddingVertical: 20, paddingBottom: 40 },
  revealRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  revealDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  revealPhrase: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  revealGems: { fontSize: 15, fontFamily: 'Inter_700Bold' },

  interpret: { marginTop: 20, marginBottom: 28 },
  interpretLine: { fontSize: 16, fontFamily: 'Inter_500Medium', lineHeight: 24, marginBottom: 14 },
  interpretFooter: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginTop: 6 },

  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginVertical: 8 },
});
