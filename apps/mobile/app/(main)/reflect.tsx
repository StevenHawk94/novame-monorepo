import { useMemo, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
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
import { MaterialIcons } from '@expo/vector-icons';

import { REFLECT_PROMPTS } from '@novame/domain';
import { ITEM_DICTIONARY } from '@novame/engine';
import {
  editReflectMemories,
  getReflectStateToday,
  submitReflect,
  type ReflectError,
  type ReflectSnapshot,
} from '../../src/lib/reflect-api';
import { setReflectBubble } from '../../src/lib/bubble-store';
import { fetchReflectFeed } from '../../src/lib/reflect-feed-api';
import { fetchBags } from '../../src/lib/bags-api';
import { getCachedSubscriptionTier } from '../../src/lib/subscription';
import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS, ICONS, REFLECT_PROMPT_ICONS } from '../../src/lib/icons';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { SpringPop } from '../../src/components/ui/spring-pop';
import { FireworksBurst } from '../../src/components/ui/fireworks-burst';

const MAX_CHARS = 5000;

/**
 * Reflect (v2.0 design pass). Four phases over the full-bleed sunset art:
 *   pick  — "What would you like to reflect on?", 9 prompt cards with icons
 *           and the tan offset drop
 *   write — prompt line + white input card + yellow Save Reflection
 *   claim — fireworks + spring-pop cards: the Reflection Finished banner
 *           (🍀 xN), Memory Items Created, then the free tier's
 *           "Add Memories Manually" editor or a straight Claim
 *   skill — fireworks + the spring-popped new card (after claim, PRD 3.7-D)
 * Dimension pills stay gone — the 8-dimension frame is backstage scoring.
 */
type Phase = 'pick' | 'write' | 'claim' | 'skill';

const ERROR_MESSAGE: Record<ReflectError, string> = {
  daily_limit: "You've reflected 3 times today. Rest up — come back tomorrow.",
  companion_not_ready: 'Your companion isn’t set up yet. Finish onboarding first.',
  too_long: 'That’s a little long. Trim it under 5,000 characters.',
  empty: 'Write a few words first.',
  network: 'Couldn’t save that. Check your connection and try again.',
};

// Design palette (reflect mocks): sunset art, tan offset, yellow/orange CTAs.
const TAN_OFFSET = '#E5B57E';
const YELLOW = '#F9C939';
const YELLOW_DROP = '#E8A33C';
const ORANGE = '#F0885C';
const ORANGE_DROP = '#D96B3F';
const INK = '#2B2B2B';

export default function ReflectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

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
  // Free tier's manual memory editor on the claim screen (PRD: 可自行添加描述).
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingEdits, setSavingEdits] = useState(false);
  const isPaid = getCachedSubscriptionTier() !== 'free';

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
    void haptics.medium();
    if (result?.generatedSkill) {
      setPhase('skill');
    } else {
      router.back();
    }
  }

  async function onSaveEdits() {
    if (!result || savingEdits) return;
    const list = Object.entries(edits)
      .map(([itemId, text]) => ({ itemId, text: text.trim() }))
      .filter((e) => e.text.length > 0);
    setSavingEdits(true);
    if (list.length > 0 && result.reflectId) {
      await editReflectMemories(result.reflectId, list);
      void fetchBags(); // memories changed
    }
    setSavingEdits(false);
    setEditing(false);
    onClaimItems();
  }

  const atLimit = remaining <= 0;

  const selectedPrompt = presetPrompt
    ? { id: 9, title: 'New Lens', text: presetPrompt, dimension: null }
    : REFLECT_PROMPTS.find((p) => p.id === promptId);

  function choosePrompt(id: number) {
    void haptics.light();
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
      void haptics.success();
      setPhase('claim');
    } else {
      setError(res.error);
      if (res.error === 'daily_limit') setRemaining(0);
    }
  }

  return (
    <ImageBackground source={BACKGROUNDS.reflect} style={{ flex: 1 }} resizeMode="cover">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {(phase === 'pick' || phase === 'write') && (
            <View style={styles.header}>
              <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
                <MaterialIcons name="arrow-back" size={22} color="#E5606B" />
              </Pressable>
              <Text style={styles.remaining}>{remaining} of 3 left today</Text>
            </View>
          )}

          {/* ---- limit reached: block before writing ---- */}
          {atLimit && (phase === 'pick' || phase === 'write') ? (
            <View style={styles.center}>
              <Text style={styles.restTitle}>That’s three for today</Text>
              <Text style={styles.restBody}>{ERROR_MESSAGE.daily_limit}</Text>
            </View>
          ) : phase === 'pick' ? (
            /* ---- phase 1: choose a prompt (design: Pick a moment) ---- */
            <ScrollView
              contentContainerStyle={styles.pickScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.lead}>What would you like to reflect on?</Text>
              <Text style={styles.leadSub}>Pick a moment.</Text>
              {REFLECT_PROMPTS.map((p) => (
                <OffsetCard
                  key={p.id}
                  color={TAN_OFFSET}
                  offset={4}
                  radius={30}
                  onPress={() => choosePrompt(p.id)}
                  cardStyle={styles.promptCard}
                >
                  <View style={styles.promptTextWrap}>
                    <Text style={styles.promptTitle}>{p.title}</Text>
                    <Text style={styles.promptText}>{p.text}</Text>
                  </View>
                  <Image
                    source={REFLECT_PROMPT_ICONS[p.id]}
                    style={styles.promptIcon}
                    resizeMode="contain"
                  />
                </OffsetCard>
              ))}
            </ScrollView>
          ) : phase === 'write' ? (
            /* ---- phase 2: write ---- */
            <View style={styles.writeWrap}>
              {selectedPrompt && (
                <Text style={styles.chosenPrompt}>{selectedPrompt.text}</Text>
              )}
              <TextInput
                style={styles.input}
                placeholder="Start here…"
                placeholderTextColor="#B7AEA6"
                value={body}
                onChangeText={(t) => setBody(t.slice(0, MAX_CHARS))}
                multiline
                autoFocus
                textAlignVertical="top"
              />
              <View style={styles.writeFooter}>
                <Text style={styles.count}>{body.length} / {MAX_CHARS}</Text>
                {error && <Text style={styles.errorText}>{ERROR_MESSAGE[error]}</Text>}
              </View>
              {/* Same recipe as the claim buttons. Disabled dim goes on the
                  OUTER style so face AND drop fade together — dimming only the
                  face let the orange drop bleed through and read as swapped
                  colors. */}
              <OffsetCard
                color={YELLOW_DROP}
                offset={4}
                radius={22}
                onPress={() => void onSubmit()}
                disabled={submitting || body.trim().length === 0}
                style={{ marginTop: 14, opacity: submitting || body.trim().length === 0 ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                {submitting ? (
                  <ActivityIndicator color={INK} />
                ) : (
                  <Text style={styles.yellowBtnText}>Save Reflection</Text>
                )}
              </OffsetCard>
            </View>
          ) : phase === 'claim' ? (
            /* ---- phase 3: items claim (fireworks + spring pops) ---- */
            result && (
              <View style={styles.claimWrap}>
                <FireworksBurst />
                <ScrollView
                  contentContainerStyle={styles.claimScroll}
                  showsVerticalScrollIndicator={false}
                >
                  <SpringPop>
                    <View style={styles.finishBanner}>
                      <Text style={styles.finishTitle}>Reflection Finished</Text>
                      <View style={styles.finishCloverRow}>
                        <Image source={ICONS.Clover} style={styles.finishClover} resizeMode="contain" />
                        <Text style={styles.finishAmount}>x{result.xpAwarded}</Text>
                      </View>
                    </View>
                  </SpringPop>

                  <SpringPop delay={160}>
                    <View style={styles.claimCard}>
                      <View style={styles.claimCardHeader}>
                        <Text style={styles.claimCardHeaderEmoji}>{'🖼️'}</Text>
                        <Text style={styles.claimCardHeaderText}>Memory Items Created</Text>
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
                                <Text style={styles.claimItemCount}>x1</Text>
                              </View>
                            );
                          })}
                        </ScrollView>
                      ) : (
                        <Text style={styles.claimEmpty}>
                          A quiet one — no items this time, and that's okay.
                        </Text>
                      )}
                    </View>
                  </SpringPop>

                  {/* Free tier's manual memory editor (PRD: 可自行添加描述). */}
                  {editing && (
                    <SpringPop>
                      <View style={styles.editCard}>
                        {result.matchedItems.map((it) => {
                          const def = ITEM_DICTIONARY.items[it.itemId];
                          return (
                            <View key={it.itemId} style={styles.editRow}>
                              <Text style={styles.editEmoji}>{def?.emoji ?? '📦'}</Text>
                              <TextInput
                                style={styles.editInput}
                                placeholder={it.label}
                                placeholderTextColor="#B7AEA6"
                                value={edits[it.itemId] ?? ''}
                                onChangeText={(t) =>
                                  setEdits((cur) => ({ ...cur, [it.itemId]: t.slice(0, 200) }))
                                }
                              />
                            </View>
                          );
                        })}
                        <Text style={styles.editHint}>
                          Describe the moment behind each item — your words become the memory.
                        </Text>
                      </View>
                    </SpringPop>
                  )}
                </ScrollView>

                <View style={[styles.claimBtns, { paddingBottom: insets.bottom + 14 }]}>
                  {editing ? (
                    <SpringPop>
                      <OffsetCard
                        color={YELLOW_DROP}
                        offset={4}
                        radius={22}
                        onPress={() => void onSaveEdits()}
                        cardStyle={styles.yellowBtn}
                      >
                        {savingEdits ? (
                          <ActivityIndicator color={INK} />
                        ) : (
                          <Text style={styles.yellowBtnText}>Save & Claim</Text>
                        )}
                      </OffsetCard>
                    </SpringPop>
                  ) : !isPaid && result.matchedItems.length > 0 ? (
                    <>
                      <SpringPop delay={320}>
                        <OffsetCard
                          color={YELLOW_DROP}
                          offset={4}
                          radius={22}
                          onPress={() => { void haptics.light(); setEditing(true); }}
                          cardStyle={styles.yellowBtn}
                        >
                          <Text style={styles.yellowBtnText}>Add Memories Manually</Text>
                        </OffsetCard>
                      </SpringPop>
                      <SpringPop delay={420}>
                        <OffsetCard
                          color={ORANGE_DROP}
                          offset={4}
                          radius={22}
                          onPress={onClaimItems}
                          cardStyle={styles.orangeBtn}
                        >
                          <Text style={styles.orangeBtnText}>Claim Directly</Text>
                        </OffsetCard>
                      </SpringPop>
                    </>
                  ) : (
                    <SpringPop delay={320}>
                      <OffsetCard
                        color={YELLOW_DROP}
                        offset={4}
                        radius={22}
                        onPress={onClaimItems}
                        cardStyle={styles.yellowBtn}
                      >
                        <Text style={styles.yellowBtnText}>Claim</Text>
                      </OffsetCard>
                    </SpringPop>
                  )}
                </View>
              </View>
            )
          ) : (
            /* ---- phase 4: skill reveal (fireworks + spring pop) ---- */
            result?.generatedSkill && (
              <View style={styles.claimWrap}>
                <View style={styles.scrim} pointerEvents="none" />
                <FireworksBurst />
                <View style={styles.skillWrap}>
                  <Text style={styles.skillStar}>{'⭐'}</Text>
                  <Text style={styles.skillTitleLine}>Your Pet Learned a New Skill!</Text>
                  <SpringPop delay={120}>
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
                  </SpringPop>
                </View>
                <View style={[styles.claimBtns, { paddingBottom: insets.bottom + 14 }]}>
                  <SpringPop delay={300}>
                    <OffsetCard
                      color={YELLOW_DROP}
                      offset={4}
                      radius={22}
                      onPress={() => router.back()}
                      cardStyle={styles.yellowBtn}
                    >
                      <Text style={styles.yellowBtnText}>Claim</Text>
                    </OffsetCard>
                  </SpringPop>
                </View>
              </View>
            )
          )}
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  remaining: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },

  lead: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginTop: 6, marginBottom: 4 },
  leadSub: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', marginBottom: 18 },
  pickScroll: { paddingBottom: 40, gap: 6 },
  // Mock 1:1: white face, tan drop, generous radius, compact height.
  promptCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 22,
  },
  promptTextWrap: { flex: 1 },
  promptTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: INK },
  promptText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#3E3229', marginTop: 3, lineHeight: 19 },
  promptIcon: { width: 54, height: 54 },

  writeWrap: { flex: 1, paddingTop: 6 },
  chosenPrompt: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 12, lineHeight: 24 },
  input: {
    flex: 1, borderRadius: 24, padding: 18, fontSize: 17, fontFamily: 'Inter_400Regular',
    lineHeight: 25, color: INK, backgroundColor: '#FFFFFF',
  },
  writeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, minHeight: 20 },
  count: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  errorText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFE1D6', flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  restTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 10 },
  restBody: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', lineHeight: 24, paddingHorizontal: 20 },

  // ---- claim ----
  claimWrap: { flex: 1 },
  claimScroll: { paddingTop: 40, paddingBottom: 16, gap: 18 },
  finishBanner: {
    backgroundColor: '#A9565C', borderRadius: 24, paddingVertical: 20, paddingHorizontal: 18,
    alignItems: 'center', gap: 8,
  },
  finishTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  finishCloverRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  finishClover: { width: 34, height: 34 },
  finishAmount: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  claimCard: {
    backgroundColor: '#FFF9F0', borderRadius: 24, padding: 20,
    shadowColor: '#8A4A2B', shadowOpacity: 0.15, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  claimCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  claimCardHeaderEmoji: { fontSize: 20 },
  claimCardHeaderText: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: INK },
  claimItemsRow: { gap: 14, paddingHorizontal: 4 },
  claimItem: { alignItems: 'center', gap: 6 },
  claimItemTile: {
    width: 76, height: 76, borderRadius: 16, backgroundColor: '#F4F1F8',
    alignItems: 'center', justifyContent: 'center',
  },
  claimItemEmoji: { fontSize: 40 },
  claimItemCount: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: INK },
  claimEmpty: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63', textAlign: 'center', paddingVertical: 8 },

  editCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, gap: 10 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editEmoji: { fontSize: 26 },
  editInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#EADFD0', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: 'Inter_500Medium', color: INK,
  },
  editHint: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#8A7A63', textAlign: 'center', marginTop: 2 },

  claimBtns: { gap: 6, paddingTop: 6 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', marginHorizontal: -20 },
  yellowBtn: { paddingVertical: 17, alignItems: 'center', backgroundColor: YELLOW },
  yellowBtnText: { color: INK, fontSize: 18, fontFamily: 'Inter_800ExtraBold' },
  orangeBtn: { paddingVertical: 17, alignItems: 'center', backgroundColor: ORANGE },
  orangeBtnText: { color: '#FFFFFF', fontSize: 18, fontFamily: 'Inter_800ExtraBold' },

  // ---- skill ----
  skillWrap: { flex: 1, justifyContent: 'center', gap: 14 },
  skillStar: { fontSize: 44, textAlign: 'center' },
  skillTitleLine: { fontSize: 23, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 6 },
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
