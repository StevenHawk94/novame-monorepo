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
import { fetchReflectFeed } from '../../src/lib/reflect-feed-api';
import { fetchBags } from '../../src/lib/bags-api';

const MAX_CHARS = 5000;

/**
 * 'claim' and 'skill' replace the old single 'done' phase, following the
 * design (reflect items claim → skill learn claim) and PRD §3.7-D: the skill
 * reveal only appears after the user closes the items claim. Dimension pills
 * are gone on purpose — the 8-dimension framework is backstage scoring and is
 * never surfaced to the user (PRD §2.4 note).
 */
type Phase = 'pick' | 'write' | 'claim' | 'skill';

const ERROR_MESSAGE: Record<ReflectError, string> = {
  daily_limit: "You've reflected 3 times today. Rest up — come back tomorrow.",
  companion_not_ready: 'Your companion isn’t set up yet. Finish onboarding first.',
  too_long: 'That’s a little long. Trim it under 5,000 characters.',
  empty: 'Write a few words first.',
  network: 'Couldn’t save that. Check your connection and try again.',
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
      if (phaseRef.current === 'pick' || phaseRef.current === 'write') {
        setRemaining(getReflectStateToday().reflectsRemaining);
      }
    }, []),
  );

  /** Items claim → skill reveal (if any) → leave. */
  function onClaimItems() {
    if (result?.generatedSkill) {
      setPhase('skill');
    } else {
      router.back();
    }
  }

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
      // Reflect changed feed + collected items -- refresh those caches now.
      void fetchReflectFeed();
      void fetchBags();
      setPhase('claim');
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
        {(phase === 'pick' || phase === 'write') && (
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
              <Text style={[styles.closeText, { color: kit.textSub }]}>Close</Text>
            </Pressable>
            <Text style={[styles.remaining, { color: kit.textMuted }]}>
              {remaining} of 3 left today
            </Text>
          </View>
        )}

        {/* ---- limit reached: block before writing ---- */}
        {atLimit && (phase === 'pick' || phase === 'write') ? (
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
        ) : phase === 'claim' ? (
          /* ---- phase 3: items claim (design: reflect items claim) ---- */
          result && (
            <View style={styles.claimWrap}>
              <View style={styles.claimBody}>
                <Text style={[styles.claimTitle, { color: kit.text }]}>
                  Your reflection has created:
                </Text>
                <View style={styles.cloverRow}>
                  <Text style={styles.cloverGlyph}>{'🍀'}</Text>
                  <Text style={[styles.cloverAmount, { color: kit.text }]}>
                    +{result.xpAwarded}
                  </Text>
                </View>

                <View style={styles.claimCard}>
                  <View style={styles.claimCardHeader}>
                    <Text style={styles.claimCardHeaderEmoji}>{'🖼️'}</Text>
                    <Text style={[styles.claimCardHeaderText, { color: kit.text }]}>
                      Memory Items Created
                    </Text>
                  </View>
                  {result.matchedItems.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.claimItemsRow}
                    >
                      {result.matchedItems.map((it) => {
                        const def = ITEM_DICTIONARY.items[it.itemId];
                        return (
                          <View key={it.itemId} style={styles.claimItem}>
                            <View style={styles.claimItemTile}>
                              <Text style={styles.claimItemEmoji}>{def?.emoji ?? '📦'}</Text>
                            </View>
                            <Text style={[styles.claimItemCount, { color: kit.text }]}>x1</Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <Text style={[styles.claimEmpty, { color: kit.textMuted }]}>
                      A quiet one — no items this time, and that's okay.
                    </Text>
                  )}
                </View>
              </View>

              <Pressable
                onPress={onClaimItems}
                style={({ pressed }) => [styles.claimBtn, pressed && styles.claimBtnPressed]}
              >
                <Text style={styles.claimBtnText}>Claim</Text>
              </Pressable>
            </View>
          )
        ) : (
          /* ---- phase 4: skill reveal (design: skill learn claim) ---- */
          result?.generatedSkill && (
            <View style={styles.claimWrap}>
              <View style={styles.claimBody}>
                <Text style={[styles.claimTitle, { color: kit.text }]}>
                  Your Pet Learned a New Skill
                </Text>
                <View
                  style={[
                    styles.skillBigCard,
                    result.generatedSkill.rarity === 'secret' && styles.skillBigCardSecret,
                  ]}
                >
                  {result.generatedSkill.rarity === 'secret' && (
                    <Text style={styles.skillSecretBadge}>✨ Secret</Text>
                  )}
                  <Text style={styles.skillBigTitle}>{result.generatedSkill.title}</Text>
                  <Text style={styles.skillBigBody}>{result.generatedSkill.body}</Text>
                </View>
              </View>

              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.claimBtn, styles.skillClaimBtn, pressed && styles.claimBtnPressed]}
              >
                <Text style={styles.claimBtnText}>Claim</Text>
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

  // ---- claim screens (items claim + skill reveal) ----
  claimWrap: { flex: 1, paddingBottom: 24 },
  claimBody: { flex: 1, justifyContent: 'center' },
  claimTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', marginBottom: 18 },
  cloverRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 26 },
  cloverGlyph: { fontSize: 30 },
  cloverAmount: { fontSize: 30, fontFamily: 'Inter_800ExtraBold' },
  claimCard: {
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, width: '100%',
    shadowColor: '#5A4A2B', shadowOpacity: 0.1, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  claimCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  claimCardHeaderEmoji: { fontSize: 20 },
  claimCardHeaderText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold' },
  claimItemsRow: { gap: 14, paddingHorizontal: 4 },
  claimItem: { alignItems: 'center', gap: 6 },
  claimItemTile: {
    width: 76, height: 76, borderRadius: 16, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
  },
  claimItemEmoji: { fontSize: 40 },
  claimItemCount: { fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  claimEmpty: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingVertical: 8 },
  claimBtn: {
    alignSelf: 'center', minWidth: 220, backgroundColor: '#FFC94A',
    borderRadius: 16, paddingVertical: 15, alignItems: 'center',
    borderWidth: 2, borderColor: '#2B2B2B',
    shadowColor: '#2B2B2B', shadowOpacity: 1, shadowRadius: 0,
    shadowOffset: { width: 2, height: 3 }, elevation: 4,
  },
  claimBtnPressed: { transform: [{ translateX: 1 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  claimBtnText: { color: '#2B2B2B', fontSize: 19, fontFamily: 'Inter_800ExtraBold' },
  skillClaimBtn: { backgroundColor: '#F0885C' },
  skillBigCard: {
    backgroundColor: '#F5A445', borderRadius: 24, borderWidth: 4, borderColor: '#3B4A8F',
    paddingVertical: 40, paddingHorizontal: 24, width: '88%', alignSelf: 'center',
    alignItems: 'center', minHeight: 300, justifyContent: 'center',
  },
  skillBigCardSecret: { borderColor: '#B57BC9' },
  skillSecretBadge: { fontSize: 14, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 10 },
  skillBigTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 14 },
  skillBigBody: { fontSize: 15, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', lineHeight: 23, textAlign: 'center' },
});
