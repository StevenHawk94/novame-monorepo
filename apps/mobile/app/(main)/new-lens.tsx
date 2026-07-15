import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { LENS_THEMES, NEW_LENS_PROMPT } from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import { WaveBackground, WAVE_PALETTES } from '../../src/components/main/wave-background';
import { getNextCard, submitLens, type LensCard } from '../../src/lib/lens-api';

type Phase = 'theme' | 'card' | 'loading' | 'done';

export default function NewLensScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const kit = {
    text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
    card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
    accent: '#D98E3C', danger: '#D9694E',
  };
  const c = theme.colors;

  const [phase, setPhase] = useState<Phase>('theme');
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [card, setCard] = useState<LensCard | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickTheme(dimension: string) {
    setActiveTheme(dimension);
    setPhase('loading');
    setError(null);
    const next = await getNextCard(dimension);
    if (next) {
      setCard(next);
      setPhase('card');
    } else {
      setError('No cards here yet. Try another.');
      setPhase('theme');
    }
  }

  async function respond(response: 'resonates' | 'different') {
    if (!card || !activeTheme || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await submitLens(activeTheme, card, response);
    setSubmitting(false);

    if (res.ok || (!res.ok && res.error === 'already_done')) {
      if (response === 'different') {
        // Route into Reflect with the theme's dimension preset.
        router.replace({
          pathname: '/(main)/reflect',
          params: {
            presetPrompt: NEW_LENS_PROMPT,
            presetDimension: activeTheme,
            sourceKit: 'new_lens',
          },
        });
        return;
      }
      setPhase('done');
    } else if (res.error === 'companion_not_ready') {
      setError('Your companion isn’t set up yet.');
    } else {
      setError('Couldn’t save that. Try again.');
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <WaveBackground palette={WAVE_PALETTES.newLens} />
      <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
        <Text style={[styles.closeText, { color: kit.textSub }]}>Close</Text>
      </Pressable>

      {phase === 'theme' && (
        <ScrollView contentContainerStyle={styles.themeScroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: kit.text }]}>What’s on your mind lately?</Text>
          <Text style={[styles.sub, { color: kit.textSub }]}>
            Not sure? Just pick whatever feels closest.
          </Text>
          <View style={styles.capsules}>
            {LENS_THEMES.map((t) => (
              <Pressable
                key={t.dimension}
                onPress={() => pickTheme(t.dimension)}
                style={({ pressed }) => [
                  styles.capsule,
                  { backgroundColor: kit.card, borderColor: kit.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={[styles.capsuleText, { color: kit.text }]}>{t.capsule}</Text>
              </Pressable>
            ))}
          </View>
          {error && <Text style={[styles.error, { color: kit.danger }]}>{error}</Text>}
        </ScrollView>
      )}

      {phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={kit.accent} />
        </View>
      )}

      {phase === 'card' && card && (
        <View style={styles.cardWrap}>
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.cardHeadline, { color: kit.text }]}>{card.headline}</Text>
            <Text style={[styles.cardBody, { color: kit.textSub }]}>{card.body}</Text>
          </ScrollView>
          {error && <Text style={[styles.error, { color: kit.danger }]}>{error}</Text>}
          <View style={[styles.responseRow, { marginBottom: insets.bottom + 12 }]}>
            <Pressable
              onPress={() => respond('different')}
              disabled={submitting}
              style={({ pressed }) => [
                styles.responseBtn,
                styles.responseGhost,
                { borderColor: kit.border, opacity: submitting ? 0.5 : pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.responseGhostText, { color: kit.textSub }]}>
                I see it differently
              </Text>
            </Pressable>
            <Pressable
              onPress={() => respond('resonates')}
              disabled={submitting}
              style={({ pressed }) => [
                styles.responseBtn,
                { backgroundColor: kit.accent, opacity: submitting ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.responseText}>That resonates</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {phase === 'done' && (
        <View style={styles.center}>
          <Text style={[styles.doneText, { color: kit.text }]}>Good to notice.</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: kit.accent, opacity: pressed ? 0.85 : 1, marginBottom: insets.bottom + 12 }]}
          >
            <Text style={styles.responseText}>Done</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },

  themeScroll: { paddingBottom: 40, paddingTop: 8 },
  title: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', lineHeight: 34, marginBottom: 8 },
  sub: { fontSize: 15, fontFamily: 'Inter_500Medium', lineHeight: 21, marginBottom: 26 },
  capsules: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  capsule: { borderWidth: 0, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 14, shadowColor: '#5A4A2B', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  capsuleText: { fontSize: 15, fontFamily: 'Inter_500Medium' },

  cardWrap: { flex: 1, paddingTop: 20 },
  cardScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 20 },
  cardHeadline: { fontSize: 26, fontFamily: 'Inter_700Bold', lineHeight: 34, marginBottom: 20, textAlign: 'center' },
  cardBody: { fontSize: 17, fontFamily: 'Inter_400Regular', lineHeight: 27, textAlign: 'center' },
  responseRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  responseRowSafe: {},
  responseBtn: { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  responseGhost: { borderWidth: 1 },
  responseGhostText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  responseText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  doneText: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  doneBtn: { borderRadius: 18, paddingVertical: 18, paddingHorizontal: 40, alignItems: 'center', shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },

  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginVertical: 10 },
});
