import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { QUIET_WINS, quietWinsFeedback } from '@novame/domain';
import { GridBackground } from '../../src/components/ui/grid-background';
import {
  consumeQuietWinsFeedbackSequence,
  submitQuietWins,
} from '../../src/lib/quiet-wins-api';
import { CloverBurst } from '../../src/components/main/clover-burst';
import { XP_RULES } from '@novame/engine';
import { optimisticCloverAward } from '../../src/lib/cosmetics-api';
import { SpringPop } from '../../src/components/ui/spring-pop';
import { haptics } from '../../src/lib/haptics';
import { AndroidCompactText as Text } from '@/components/ui/android-compact-typography';

type Phase = 'pick' | 'done';

/** Stable shuffle so the list order is fixed within a mount (no jitter on
 *  re-render) but not grouped by dimension. Seeded by id hash. */
function shuffled<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ha = [...a.id].reduce((n, c) => n + c.charCodeAt(0), 0);
    const hb = [...b.id].reduce((n, c) => n + c.charCodeAt(0), 0);
    return ha - hb;
  });
}

export default function QuietWinsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Kit screens use a light warm gradient-wave backdrop, so override the dark
  // theme colors with a light-on-dark-text palette for this screen.
  const kit = {
    text: '#3A2E1A',
    textSub: '#6B5A45',
    textMuted: '#9A8770',
    card: '#FFFFFF',
    border: 'rgba(58,46,26,0.12)',
    accent: '#7BB86A',
    danger: '#D9694E',
  };

  const items = useMemo(() => shuffled(QUIET_WINS), []);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('pick');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tier: number; lines: string[] } | null>(null);
  const [xpAwarded, setXpAwarded] = useState(0);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDone() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const ids = [...checked];
    const expected = XP_RULES.quietWins.award;
    const award = optimisticCloverAward(expected);
    const feedbackSequence = consumeQuietWinsFeedbackSequence(ids);
    setFeedback(quietWinsFeedback(ids, feedbackSequence));
    setXpAwarded(expected);
    setPhase('done');
    const res = await submitQuietWins(ids);
    setSubmitting(false);
    if (res.ok) {
      setXpAwarded(res.snapshot.xpAwarded);
      award.commit(res.snapshot.xpAwarded);
    } else if (res.error === 'already_done') {
      // Already spent today -- still show them their reflection, no double xp.
      setXpAwarded(0);
      award.rollback();
    } else {
      setXpAwarded(0);
      award.rollback();
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <GridBackground base="#A8D69A" line="#91C681" cell={22} lineWidth={1.2} />
      <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.close} hitSlop={12}>
        <Text style={[styles.closeText, { color: kit.textSub }]}>Close</Text>
      </Pressable>

      {phase === 'pick' ? (
        <>
          {/* Design: trophy art + "Small Wins" title block; PRD copy stays as
              the subtitle lines (mock copy was draft). */}
          <View style={styles.head}>
            <Text style={styles.trophy}>{'🏆'}</Text>
            <Text style={[styles.title, { color: kit.text }]}>Small Wins</Text>
            <Text style={[styles.sub, { color: kit.textSub }]}>
              What did you get right today?{'\n'}No pressure — just check what’s true.
            </Text>
          </View>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {items.map((w, idx) => {
              const on = checked.has(w.id);
              return (
                <Pressable
                  key={w.id}
                  onPress={() => toggle(w.id)}
                  style={[styles.item, { backgroundColor: on ? '#FDF8EC' : kit.card }]}
                >
                  <View style={styles.numChip}>
                    <Text style={styles.numChipText}>{idx + 1}</Text>
                  </View>
                  <Text style={[styles.itemText, { color: kit.text }]}>{w.text}</Text>
                  <View
                    style={[
                      styles.checkCircle,
                      on && { backgroundColor: kit.accent },
                    ]}
                  >
                    {on && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {error && <Text style={[styles.error, { color: kit.danger }]}>{error}</Text>}
          <Pressable
            onPress={onDone}
            disabled={submitting}
            style={({ pressed }) => [
              styles.doneBtn,
              { backgroundColor: '#F0885C', opacity: submitting ? 0.5 : pressed ? 0.85 : 1, marginBottom: insets.bottom + 12 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.doneBtnText}>Confirm wins</Text>
            )}
          </Pressable>
        </>
      ) : (
        <View style={styles.feedbackWrap}>
          <ScrollView contentContainerStyle={styles.feedbackScroll} showsVerticalScrollIndicator={false}>
            {xpAwarded > 0 && <CloverBurst amount={xpAwarded} />}
            <SpringPop boundedBounce>
              <View style={styles.feedbackCard}>
                {feedback?.lines.map((line, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.feedbackLine,
                      i === feedback.lines.length - 1 && styles.feedbackLineLast,
                      { color: kit.text },
                    ]}
                  >
                    {line}
                  </Text>
                ))}
              </View>
            </SpringPop>
          </ScrollView>
          <Pressable
            onPress={() => { void haptics.pageClose(); router.back(); }}
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: '#F0885C', opacity: pressed ? 0.85 : 1, marginBottom: insets.bottom + 12 }]}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  close: { alignSelf: 'flex-start', paddingVertical: 8 },
  closeText: { fontSize: 15, fontFamily: 'Inter_500Medium' },

  head: { marginTop: 2, marginBottom: 18, alignItems: 'center' },
  trophy: { fontSize: 40, marginBottom: 6 },
  title: { fontSize: 30, fontFamily: 'Inter_800ExtraBold', lineHeight: 36, marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 15, fontFamily: 'Inter_500Medium', lineHeight: 22, textAlign: 'center' },

  list: { paddingBottom: 20 },
  // Cream rows with a small offset shadow; selection lives in the check state.
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 12,
    shadowColor: '#45643C',
    shadowOpacity: 0.16,
    shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 },
    elevation: 2,
  },
  numChip: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#FAD9B8',
    alignItems: 'center', justifyContent: 'center',
  },
  numChipText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#3A2E1A' },
  checkCircle: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#E9E1D3',
    alignItems: 'center', justifyContent: 'center',
  },
  checkmark: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  itemText: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', lineHeight: 22 },

  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginBottom: 8 },
  // Design: "Confirm wins" — orange-red sticker button.
  doneBtn: {
    borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginBottom: 12,
    shadowColor: '#45643C', shadowOpacity: 0.2, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  doneBtnText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },

  feedbackWrap: { flex: 1 },
  feedbackScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 40 },
  feedbackCard: {
    backgroundColor: '#FDF6E5', borderRadius: 24, paddingVertical: 34, paddingHorizontal: 22,
    justifyContent: 'center',
    shadowColor: '#45643C', shadowOpacity: 0.16, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  feedbackLine: {
    fontSize: 18,
    fontFamily: 'Inter_500Medium',
    lineHeight: 27,
    textAlign: 'center',
    marginBottom: 18,
  },
  feedbackLineLast: { marginBottom: 0 },
});
