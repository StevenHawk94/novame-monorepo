import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { QUIET_WINS, quietWinsFeedback } from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import { WaveBackground, WAVE_PALETTES } from '../../src/components/main/wave-background';
import { submitQuietWins } from '../../src/lib/quiet-wins-api';

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
  const { theme } = useTheme();
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
  const c = theme.colors;

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
    const res = await submitQuietWins(ids);
    setSubmitting(false);
    if (res.ok) {
      setFeedback(quietWinsFeedback(ids));
      setXpAwarded(res.snapshot.xpAwarded);
      setPhase('done');
    } else if (res.error === 'already_done') {
      // Already spent today -- still show them their reflection, no double xp.
      setFeedback(quietWinsFeedback(ids));
      setXpAwarded(0);
      setPhase('done');
    } else if (res.error === 'companion_not_ready') {
      setError('Your companion isn’t set up yet.');
    } else {
      setError('Couldn’t save that. Check your connection and try again.');
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <WaveBackground palette={WAVE_PALETTES.quietWins} />
      <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
        <Text style={[styles.closeText, { color: kit.textSub }]}>Close</Text>
      </Pressable>

      {phase === 'pick' ? (
        <>
          <View style={styles.head}>
            <Text style={[styles.title, { color: kit.text }]}>
              What did you get right today?
            </Text>
            <Text style={[styles.sub, { color: kit.textSub }]}>
              No pressure — just check what’s true.
            </Text>
          </View>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {items.map((w) => {
              const on = checked.has(w.id);
              return (
                <Pressable
                  key={w.id}
                  onPress={() => toggle(w.id)}
                  style={[
                    styles.item,
                    { backgroundColor: kit.card, borderColor: on ? kit.accent : kit.border, borderWidth: on ? 2 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: on ? kit.accent : kit.textMuted, backgroundColor: on ? kit.accent : 'transparent' },
                    ]}
                  >
                    {on && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.itemText, { color: kit.text }]}>{w.text}</Text>
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
              { backgroundColor: kit.accent, opacity: submitting ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.doneBtnText}>Done for today</Text>
            )}
          </Pressable>
        </>
      ) : (
        <View style={styles.feedbackWrap}>
          <ScrollView contentContainerStyle={styles.feedbackScroll} showsVerticalScrollIndicator={false}>
            {xpAwarded > 0 && (
              <Text style={[styles.xp, { color: kit.accent }]}>+{xpAwarded} XP</Text>
            )}
            {feedback?.lines.map((line, i) => (
              <Text key={i} style={[styles.feedbackLine, { color: kit.text }]}>
                {line}
              </Text>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: kit.accent, opacity: pressed ? 0.85 : 1 }]}
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

  head: { marginTop: 8, marginBottom: 22 },
  title: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', lineHeight: 34, marginBottom: 8 },
  sub: { fontSize: 15, fontFamily: 'Inter_500Medium', lineHeight: 21 },

  list: { paddingBottom: 20 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#5A4A2B',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_700Bold' },
  itemText: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', lineHeight: 22 },

  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginBottom: 8 },
  doneBtn: { borderRadius: 18, paddingVertical: 18, alignItems: 'center', marginBottom: 12, shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  doneBtnText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },

  feedbackWrap: { flex: 1 },
  feedbackScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 40 },
  xp: { fontSize: 32, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', marginBottom: 28 },
  feedbackLine: {
    fontSize: 18,
    fontFamily: 'Inter_500Medium',
    lineHeight: 27,
    textAlign: 'center',
    marginBottom: 18,
  },
});
