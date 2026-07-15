import { useMemo, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { REFLECT_PROMPTS } from '@novame/domain';
import { ITEM_DICTIONARY } from '@novame/engine';
import { useTheme } from '../../src/theme/use-theme';
import { WaveBackground, WAVE_PALETTES } from '../../src/components/main/wave-background';
import {
  getReflectStateToday,
  submitReflect,
  type ReflectError,
  type ReflectSnapshot,
} from '../../src/lib/reflect-api';
import { setReflectBubble } from '../../src/lib/bubble-store';

const MAX_CHARS = 5000;

type Phase = 'pick' | 'write' | 'done';

const ERROR_MESSAGE: Record<ReflectError, string> = {
  daily_limit: "You've reflected 3 times today. Rest up — come back tomorrow.",
  companion_not_ready: 'Your companion isn’t set up yet. Finish onboarding first.',
  too_long: 'That’s a little long. Trim it under 5,000 characters.',
  empty: 'Write a few words first.',
  network: 'Couldn’t save that. Check your connection and try again.',
};

const DIMENSION_LABEL: Record<string, string> = {
  expression: 'Expression',
  awareness: 'Awareness',
  momentum: 'Momentum',
  direction: 'Direction',
  steadiness: 'Steadiness',
  confidence: 'Confidence',
  gratitude: 'Gratitude',
  connection: 'Connection',
};

export default function ReflectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const kit = {
    text: '#3A2E1A', textSub: '#6B5A45', textMuted: '#9A8770',
    card: '#FFFFFF', border: 'rgba(58,46,26,0.12)',
    accent: '#E0912F', danger: '#D9694E', secret: '#B57BC9',
    inputBg: 'rgba(255,255,255,0.7)', tagBg: 'rgba(224,145,47,0.15)',
  };
  void c;

  const params = useLocalSearchParams<{
    presetPrompt?: string;
    presetDimension?: string;
    sourceKit?: string;
  }>();
  const presetPrompt = typeof params.presetPrompt === 'string' ? params.presetPrompt : null;
  const presetDimension =
    typeof params.presetDimension === 'string' ? params.presetDimension : undefined;
  const sourceKit = params.sourceKit === 'new_lens' ? 'new_lens' : undefined;

  const initial = useMemo(() => getReflectStateToday(), []);
  // A preset (from New Lens) skips the prompt picker: the user already has a
  // line to respond to, and the reflect is credited to the theme's dimension.
  const [phase, setPhase] = useState<Phase>(presetPrompt ? 'write' : 'pick');
  const [promptId, setPromptId] = useState<number | null>(presetPrompt ? 9 : null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReflectError | null>(null);
  const [result, setResult] = useState<ReflectSnapshot | null>(null);
  const [remaining, setRemaining] = useState(initial.reflectsRemaining);

  // Re-read today's count each time the screen gains focus, so a __DEV__ reset
  // (or a new day) updates the limit without a full remount. Uses a functional
  // setState reading the cache fresh; done-phase is guarded via a ref so the
  // callback identity stays stable (empty deps) and always fires on focus.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current !== 'done') {
        setRemaining(getReflectStateToday().reflectsRemaining);
      }
    }, []),
  );

  const atLimit = remaining <= 0;

  const selectedPrompt = presetPrompt
    ? { id: 9, text: presetPrompt, dimension: null }
    : REFLECT_PROMPTS.find((p) => p.id === promptId);

  function choosePrompt(id: number) {
    setPromptId(id);
    setPhase('write');
    setError(null);
  }

  async function onSubmit() {
    if (promptId == null || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await submitReflect({ promptId, body, presetDimension, sourceKit });
    setSubmitting(false);
    if (res.ok) {
      setResult(res.snapshot);
      setRemaining(res.snapshot.reflectsRemaining);
      if (res.snapshot.bubble) setReflectBubble(res.snapshot.bubble);
      setPhase('done');
    } else {
      setError(res.error);
      if (res.error === 'daily_limit') setRemaining(0);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <WaveBackground palette={WAVE_PALETTES.reflect} />
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
            <Text style={[styles.closeText, { color: kit.textSub }]}>Close</Text>
          </Pressable>
          {phase !== 'done' && (
            <Text style={[styles.remaining, { color: kit.textMuted }]}>
              {remaining} of 3 left today
            </Text>
          )}
        </View>

        {/* ---- limit reached: block before writing ---- */}
        {atLimit && phase !== 'done' ? (
          <View style={styles.center}>
            <Text style={[styles.restTitle, { color: kit.text }]}>
              That’s three for today
            </Text>
            <Text style={[styles.restBody, { color: kit.textSub }]}>
              {ERROR_MESSAGE.daily_limit}
            </Text>
          </View>
        ) : phase === 'pick' ? (
          /* ---- phase 1: choose a prompt ---- */
          <ScrollView
            contentContainerStyle={styles.pickScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.lead, { color: kit.text }]}>
              What do you want to sit with?
            </Text>
            <Text style={[styles.leadSub, { color: kit.textSub }]}>
              Pick a starting point, or just write.
            </Text>
            {REFLECT_PROMPTS.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => choosePrompt(p.id)}
                style={({ pressed }) => [
                  styles.promptCard,
                  {
                    backgroundColor: kit.card,
                    borderColor: kit.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.promptText, { color: kit.text }]}>{p.text}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : phase === 'write' ? (
          /* ---- phase 2: write ---- */
          <View style={styles.writeWrap}>
            {selectedPrompt && (
              <Text style={[styles.chosenPrompt, { color: kit.textSub }]}>
                {selectedPrompt.text}
              </Text>
            )}
            <TextInput
              style={[styles.input, { color: kit.text, backgroundColor: kit.inputBg }]}
              placeholder="Start here…"
              placeholderTextColor={kit.textMuted}
              value={body}
              onChangeText={(t) => setBody(t.slice(0, MAX_CHARS))}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.writeFooter}>
              <Text style={[styles.count, { color: kit.textMuted }]}>
                {body.length} / {MAX_CHARS}
              </Text>
              {error && (
                <Text style={[styles.errorText, { color: kit.danger }]}>
                  {ERROR_MESSAGE[error]}
                </Text>
              )}
            </View>
            <Pressable
              onPress={onSubmit}
              disabled={submitting || body.trim().length === 0}
              style={({ pressed }) => [
                styles.submit,
                {
                  backgroundColor: kit.accent,
                  opacity: submitting || body.trim().length === 0 ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>Save reflection</Text>
              )}
            </Pressable>
          </View>
        ) : (
          /* ---- phase 3: result ---- */
          result && (
            <View style={styles.center}>
              <Text style={[styles.doneTitle, { color: kit.text }]}>Saved</Text>
              <View style={[styles.rewardCard, { backgroundColor: kit.card, borderColor: kit.border }]}>
                <Text style={[styles.rewardXp, { color: kit.accent }]}>
                  +{result.xpAwarded} XP
                </Text>
                {result.dimensionHits.length > 0 ? (
                  <View style={styles.hits}>
                    {result.dimensionHits.map((h) => (
                      <View key={h.dimension} style={[styles.hitPill, { backgroundColor: kit.tagBg }]}>
                        <Text style={[styles.hitText, { color: kit.text }]}>
                          {DIMENSION_LABEL[h.dimension] ?? h.dimension} +{h.gems}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.noHits, { color: kit.textMuted }]}>
                    A quiet one. No gems this time — that’s okay.
                  </Text>
                )}
              </View>

              {result.matchedItems.length > 0 && (
                <View style={[styles.itemsCard, { backgroundColor: kit.card, borderColor: kit.border }]}>
                  <Text style={[styles.itemsTitle, { color: kit.textSub }]}>
                    Collected {result.matchedItems.length === 1 ? 'a moment' : `${result.matchedItems.length} moments`}
                  </Text>
                  <View style={styles.itemsRow}>
                    {result.matchedItems.map((it) => {
                      const def = ITEM_DICTIONARY.items[it.itemId];
                      return (
                        <View key={it.itemId} style={styles.itemChip}>
                          <Text style={styles.itemEmoji}>{def?.emoji ?? '📦'}</Text>
                          <Text style={[styles.itemLabel, { color: kit.text }]} numberOfLines={1}>
                            {it.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {result.generatedSkill && (
                <View style={[styles.skillCard, { backgroundColor: kit.card, borderColor: result.generatedSkill.rarity === 'secret' ? kit.secret : kit.border, borderWidth: result.generatedSkill.rarity === 'secret' ? 2 : 1 }]}>
                  <Text style={[styles.skillLabel, { color: kit.secret }]}>
                    {result.generatedSkill.rarity === 'secret' ? '✨ Secret skill learned' : 'New skill learned'}
                  </Text>
                  <Text style={[styles.skillTitle, { color: kit.text }]}>{result.generatedSkill.title}</Text>
                  <Text style={[styles.skillBody, { color: kit.textSub }]}>{result.generatedSkill.body}</Text>
                </View>
              )}

              <Text style={[styles.remainingDone, { color: kit.textSub }]}>
                {result.reflectsRemaining > 0
                  ? `${result.reflectsRemaining} more today if you want it.`
                  : 'That’s all three for today.'}
              </Text>
              <Pressable onPress={() => router.back()} style={styles.doneBtn}>
                <Text style={[styles.doneBtnText, { color: kit.accent }]}>Done</Text>
              </Pressable>
            </View>
          )
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { paddingVertical: 8 },
  closeText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  remaining: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },

  lead: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', marginTop: 12, marginBottom: 6 },
  leadSub: { fontSize: 15, fontFamily: 'Inter_500Medium', marginBottom: 22 },
  pickScroll: { paddingBottom: 40 },
  promptCard: { borderWidth: 0, borderRadius: 20, padding: 20, marginBottom: 14, shadowColor: '#5A4A2B', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  promptText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', lineHeight: 23 },

  writeWrap: { flex: 1, paddingTop: 12 },
  chosenPrompt: { fontSize: 15, fontFamily: 'Inter_500Medium', marginBottom: 12, lineHeight: 22 },
  input: { flex: 1, borderRadius: 16, padding: 16, fontSize: 17, fontFamily: 'Inter_400Regular', lineHeight: 25 },
  writeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, minHeight: 20 },
  count: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  errorText: { fontSize: 13, fontFamily: 'Inter_500Medium', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  submit: { borderRadius: 18, paddingVertical: 18, alignItems: 'center', marginTop: 16, marginBottom: 8, shadowColor: '#5A4A2B', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  submitText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  restTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 10 },
  restBody: { fontSize: 16, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 24, paddingHorizontal: 20 },

  doneTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 24 },
  rewardCard: { borderWidth: 1, borderRadius: 20, paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center', width: '100%' },
  rewardXp: { fontSize: 36, fontFamily: 'Inter_800ExtraBold', marginBottom: 16 },
  hits: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  hitPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  hitText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  noHits: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  remainingDone: { fontSize: 15, fontFamily: 'Inter_400Regular', marginTop: 24 },
  itemsCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 16, width: '100%' },
  itemsTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginBottom: 12 },
  itemsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  itemChip: { alignItems: 'center', maxWidth: 90 },
  itemEmoji: { fontSize: 30, marginBottom: 4 },
  itemLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  skillCard: { borderRadius: 16, padding: 16, marginTop: 16, width: '100%' },
  skillLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 8, textAlign: 'center' },
  skillTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 6, textAlign: 'center' },
  skillBody: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, textAlign: 'center' },
  doneBtn: { marginTop: 32, paddingVertical: 12, paddingHorizontal: 32 },
  doneBtnText: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
});
