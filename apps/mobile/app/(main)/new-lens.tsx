import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { LENS_THEMES, NEW_LENS_PROMPT } from '@novame/domain';
import { GridBackground } from '../../src/components/ui/grid-background';
import { getNextCard, submitLens, type LensCard } from '../../src/lib/lens-api';
import { CloverBurst } from '../../src/components/main/clover-burst';
import { XP_RULES } from '@novame/engine';
import { optimisticCloverAward } from '../../src/lib/cosmetics-api';
import { haptics } from '../../src/lib/haptics';
import { ICONS } from '../../src/lib/icons';
import { SpringPop } from '../../src/components/ui/spring-pop';

type Phase = 'theme' | 'card' | 'loading' | 'done';

export default function NewLensScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const kit = {
    text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
    card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
    accent: '#D98E3C', danger: '#D9694E',
  };

  const [phase, setPhase] = useState<Phase>('theme');
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [card, setCard] = useState<LensCard | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reward, setReward] = useState(0);

  // Design: two-step — tap a capsule to select it, then "Spark Me" fetches
  // the card (was a one-tap instant fetch before the mock landed).
  function pickTheme(key: string) {
    setActiveTheme((cur) => (cur === key ? null : key));
    setError(null);
  }

  async function sparkMe() {
    if (!activeTheme) return;
    setPhase('loading');
    setError(null);
    const next = await getNextCard(activeTheme);
    if (next) {
      setCard(next);
      setPhase('card');
    } else {
      setError('No cards here yet. Try another.');
      setPhase('theme');
    }
  }

  function respond(response: 'resonates' | 'different') {
    if (!card || !activeTheme || submitting) return;
    setSubmitting(true);
    setError(null);
    const expected = XP_RULES.newLens.award;
    const award = optimisticCloverAward(expected);
    setReward(expected);
    if (response === 'resonates') {
      setPhase('done');
    } else {
      // Route immediately; saving and Clover reconciliation continue silently.
      void haptics.pageOpen();
      router.replace({
        pathname: '/(main)/reflect',
        params: { presetPrompt: NEW_LENS_PROMPT, sourceKit: 'new_lens' },
      });
    }

    void submitLens(activeTheme, card, response).then((res) => {
      setSubmitting(false);
      if (res.ok) {
        setReward(res.xpAwarded);
        award.commit(res.xpAwarded);
      } else {
        setReward(0);
        award.rollback();
      }
    });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <GridBackground base="#F3C98F" line="#E8B875" cell={22} lineWidth={1.2} />
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
            {LENS_THEMES.map((t) => {
              const on = activeTheme === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => pickTheme(t.key)}
                  style={({ pressed }) => [
                    styles.capsule,
                    { backgroundColor: kit.card, opacity: pressed ? 0.8 : 1 },
                    on && styles.capsuleOn,
                  ]}
                >
                  <Text style={[styles.capsuleText, { color: kit.text }, on && styles.capsuleTextOn]}>
                    {t.capsule}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {error && <Text style={[styles.error, { color: kit.danger }]}>{error}</Text>}
        </ScrollView>
      )}
      {phase === 'theme' && (
        <Pressable
          onPress={sparkMe}
          disabled={!activeTheme}
          style={({ pressed }) => [
            styles.sparkBtn,
            { opacity: !activeTheme ? 0.45 : pressed ? 0.85 : 1, marginBottom: insets.bottom + 12 },
          ]}
        >
          <Text style={styles.sparkText}>Spark Me</Text>
        </Pressable>
      )}

      {phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={kit.accent} />
        </View>
      )}

      {phase === 'card' && card && (
        <View style={styles.cardWrap}>
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <SpringPop boundedBounce>
              <Image source={ICONS.NewLens} style={styles.cardArt} resizeMode="contain" />
              <View style={styles.knowledgeCard}>
                <Text style={[styles.cardHeadline, { color: kit.text }]}>{card.headline}</Text>
                <Text style={[styles.cardBody, { color: kit.textSub }]}>{card.body}</Text>
              </View>
            </SpringPop>
          </ScrollView>
          {error && <Text style={[styles.error, { color: kit.danger }]}>{error}</Text>}
          <View style={[styles.responseRow, { marginBottom: insets.bottom + 12 }]}>
            <Pressable
              onPress={() => respond('different')}
              disabled={submitting}
              style={({ pressed }) => [
                styles.responseBtn,
                styles.responseDifferent,
                { opacity: submitting ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.responseText}>I see it differently</Text>
            </Pressable>
            <Pressable
              onPress={() => respond('resonates')}
              disabled={submitting}
              style={({ pressed }) => [
                styles.responseBtn,
                styles.responseResonates,
                { opacity: submitting ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#2B2B2B" />
              ) : (
                <Text style={styles.responseResonatesText}>This resonates</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {phase === 'done' && (
        <View style={styles.center}>
          {reward > 0 && <CloverBurst amount={reward} />}
          <SpringPop boundedBounce>
            <Text style={[styles.doneText, { color: kit.text }]}>Good to notice.</Text>
          </SpringPop>
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
  capsule: {
    borderRadius: 22, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 14,
    shadowColor: '#6B4A2D', shadowOpacity: 0.16, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  capsuleOn: { backgroundColor: '#FFF0D3', shadowOpacity: 0.24 },
  capsuleText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  capsuleTextOn: { fontFamily: 'Inter_700Bold' },
  // Design: orange "Spark Me" sticker button pinned at the bottom.
  sparkBtn: {
    backgroundColor: '#F0885C', borderRadius: 16, paddingVertical: 17,
    alignItems: 'center', alignSelf: 'center', minWidth: 220,
    shadowColor: '#6B3F25', shadowOpacity: 0.2, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  sparkText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_800ExtraBold' },

  cardWrap: { flex: 1, paddingTop: 8 },
  cardScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 12 },
  cardArt: { width: 68, height: 68, alignSelf: 'center', marginBottom: -18, zIndex: 1 },
  // Cream knowledge card with a small offset shadow and no hard outline.
  knowledgeCard: {
    backgroundColor: '#FDF6E5', borderRadius: 24,
    paddingVertical: 40, paddingHorizontal: 22,
    shadowColor: '#6B4A2D', shadowOpacity: 0.15, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  cardHeadline: { fontSize: 26, fontFamily: 'Inter_700Bold', lineHeight: 34, marginBottom: 20, textAlign: 'center' },
  cardBody: { fontSize: 17, fontFamily: 'Inter_400Regular', lineHeight: 27, textAlign: 'center' },
  responseRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  responseRowSafe: {},
  responseBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6B3F25', shadowOpacity: 0.2, shadowRadius: 1,
    shadowOffset: { width: 1, height: 2 }, elevation: 2,
  },
  responseDifferent: { backgroundColor: '#F0885C' },
  responseResonates: { backgroundColor: '#F7CE46' },
  responseText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  responseResonatesText: { color: '#2B2B2B', fontSize: 15, fontFamily: 'Inter_700Bold' },

  doneText: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  doneBtn: { borderRadius: 18, paddingVertical: 18, paddingHorizontal: 40, alignItems: 'center', shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },

  error: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginVertical: 10 },
});
