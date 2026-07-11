import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { LENS_THEMES, NEW_LENS_PROMPT } from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import { getNextCard, submitLens, type LensCard } from '../../src/lib/lens-api';

type Phase = 'theme' | 'card' | 'loading' | 'done';

export default function NewLensScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
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
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
        <Text style={[styles.closeText, { color: c.textSecondary }]}>Close</Text>
      </Pressable>

      {phase === 'theme' && (
        <ScrollView contentContainerStyle={styles.themeScroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: c.textPrimary }]}>What’s on your mind lately?</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>
            Not sure? Just pick whatever feels closest.
          </Text>
          <View style={styles.capsules}>
            {LENS_THEMES.map((t) => (
              <Pressable
                key={t.dimension}
                onPress={() => pickTheme(t.dimension)}
                style={({ pressed }) => [
                  styles.capsule,
                  { backgroundColor: c.bgCard, borderColor: c.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={[styles.capsuleText, { color: c.textPrimary }]}>{t.capsule}</Text>
              </Pressable>
            ))}
          </View>
          {error && <Text style={[styles.error, { color: c.brand.danger }]}>{error}</Text>}
        </ScrollView>
      )}

      {phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={c.brand.primary} />
        </View>
      )}

      {phase === 'card' && card && (
        <View style={styles.cardWrap}>
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.cardHeadline, { color: c.textPrimary }]}>{card.headline}</Text>
            <Text style={[styles.cardBody, { color: c.textSecondary }]}>{card.body}</Text>
          </ScrollView>
          {error && <Text style={[styles.error, { color: c.brand.danger }]}>{error}</Text>}
          <View style={styles.responseRow}>
            <Pressable
              onPress={() => respond('different')}
              disabled={submitting}
              style={({ pressed }) => [
                styles.responseBtn,
                styles.responseGhost,
                { borderColor: c.border, opacity: submitting ? 0.5 : pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.responseGhostText, { color: c.textSecondary }]}>
                I see it differently
              </Text>
            </Pressable>
            <Pressable
              onPress={() => respond('resonates')}
              disabled={submitting}
              style={({ pressed }) => [
                styles.responseBtn,
                { backgroundColor: c.brand.primary, opacity: submitting ? 0.5 : pressed ? 0.85 : 1 },
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
          <Text style={[styles.doneText, { color: c.textPrimary }]}>Good to notice.</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: c.brand.primary, opacity: pressed ? 0.85 : 1 }]}
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
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', lineHeight: 31, marginBottom: 6 },
  sub: { fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 24 },
  capsules: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  capsule: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 12 },
  capsuleText: { fontSize: 15, fontFamily: 'Inter_500Medium' },

  cardWrap: { flex: 1, paddingTop: 20 },
  cardScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 20 },
  cardHeadline: { fontSize: 26, fontFamily: 'Inter_700Bold', lineHeight: 34, marginBottom: 20, textAlign: 'center' },
  cardBody: { fontSize: 17, fontFamily: 'Inter_400Regular', lineHeight: 27, textAlign: 'center' },
  responseRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  responseBtn: { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  responseGhost: { borderWidth: 1 },
  responseGhostText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  responseText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  doneText: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  doneBtn: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center' },

  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginVertical: 10 },
});
