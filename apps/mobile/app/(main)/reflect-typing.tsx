import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { REFLECT_PROMPTS } from '@novame/domain';
import { matchItems } from '@novame/engine';

import {
  getReflectStateToday,
  prepareReflect,
  type MatchedItem,
  type PreparedReflect,
  type ReflectError,
} from '../../src/lib/reflect-api';
import { setReflectBubble } from '../../src/lib/bubble-store';
import { fetchReflectFeed } from '../../src/lib/reflect-feed-api';
import { cacheReflectItems, fetchBags } from '../../src/lib/bags-api';
import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS, REFLECT_PROMPT_ICONS } from '../../src/lib/icons';
import { mergedItemDictionary } from '../../src/lib/remote-items';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import { RC, ReflectTopBar } from '../../src/components/main/reflect-shared';
import { MatchedItemsReviewSheet, ReflectSettlementView } from '../../src/components/main/reflect-settlement';

const MAX_CHARS = 5000;

const ERROR_MESSAGE: Record<ReflectError, string> = {
  daily_limit: "You've reflected 3 times today. Rest up — come back tomorrow.",
  companion_not_ready: 'Your companion isn’t set up yet. Finish onboarding first.',
  too_long: 'That’s a little long. Trim it under 5,000 characters.',
  empty: 'Write a few words first.',
  plus_required: 'Shared Memories are available with Burrow Plus.',
  network: 'Couldn’t save that. Check your connection and try again.',
};

const TAN_OFFSET = '#E5B57E';

/**
 * 流程1 — Write Freely (2026-07-24 design): the 9-prompt second level, then
 * the typing page with the LIVE match bar — items appear as you type
 * (client-side engine, same dictionary as the server). The whole preview opens
 * a remove-only sheet; memory text and privacy are finalized in settlement.
 */
type Phase = 'pick' | 'write' | 'result';

export default function ReflectTypingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{
    presetPrompt?: string;
    sourceKit?: string;
  }>();
  const presetPrompt = typeof params.presetPrompt === 'string' && params.presetPrompt ? params.presetPrompt : null;
  const sourceKit = params.sourceKit === 'new_lens' ? 'new_lens' : undefined;

  const initial = useMemo(() => getReflectStateToday(), []);
  const [phase, setPhase] = useState<Phase>(presetPrompt ? 'write' : 'pick');
  const [promptId, setPromptId] = useState<number | null>(presetPrompt ? 9 : null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReflectError | null>(null);
  const [draft, setDraft] = useState<PreparedReflect | null>(null);
  const [remaining, setRemaining] = useState(initial.reflectsRemaining);
  // Live matching state: debounced engine pass minus dismissed chips + notes.
  const [liveMatched, setLiveMatched] = useState<MatchedItem[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current !== 'result') {
        setRemaining(getReflectStateToday().reflectsRemaining);
      }
    }, []),
  );

  // Live match while typing: debounce 250ms, run the shared engine locally.
  useEffect(() => {
    const t = setTimeout(() => {
      const matches = matchItems(body, mergedItemDictionary());
      setLiveMatched(matches);
    }, 250);
    return () => clearTimeout(t);
  }, [body]);

  const shownMatches = liveMatched.filter((m) => !removedIds.has(m.itemId));

  const atLimit = remaining <= 0;
  const selectedPrompt = presetPrompt
    ? { id: 9, title: 'New Lens', text: presetPrompt }
    : REFLECT_PROMPTS.find((p) => p.id === promptId);

  function choosePrompt(id: number) {
    void haptics.light();
    setPromptId(id);
    setPhase('write');
    setError(null);
  }

  function removeMatch(itemId: string) {
    void haptics.light();
    setRemovedIds((cur) => new Set(cur).add(itemId));
  }

  async function onSubmit() {
    if (promptId == null || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await prepareReflect({
      promptId,
      body,
      sourceKit,
      mode: 'typing',
      removedItemIds: [...removedIds],
    });
    setSubmitting(false);
    if (res.ok) {
      Keyboard.dismiss();
      setDraft(res.draft);
      setPhase('result');
    } else {
      setError(res.error);
      if (res.error === 'daily_limit') setRemaining(0);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#5A2E2A' }}>
      <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
      {/* Only the Reflect-method entry stays unshaded. Every page inside this
          flow uses the same scrim so white labels remain readable. */}
      <View pointerEvents="none" style={styles.scrim} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={phase !== 'result'}
      >
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && (
            <ReflectTopBar remaining={remaining} onBack={() => router.back()} />
          )}

          {atLimit && phase !== 'result' ? (
            <View style={styles.center}>
              <Text style={styles.restTitle}>That’s three for today</Text>
              <Text style={styles.restBody}>{ERROR_MESSAGE.daily_limit}</Text>
            </View>
          ) : phase === 'pick' ? (
            <ScrollView contentContainerStyle={styles.pickScroll} showsVerticalScrollIndicator={false}>
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
                  style={{ marginBottom: 16 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.promptTitle}>{p.title}</Text>
                    <Text style={styles.promptText}>{p.text}</Text>
                  </View>
                  <Image source={REFLECT_PROMPT_ICONS[p.id]} style={styles.promptIcon} resizeMode="contain" />
                </OffsetCard>
              ))}
            </ScrollView>
          ) : phase === 'write' ? (
            <View style={{ flex: 1 }}>
              {selectedPrompt && <Text style={styles.chosenPrompt}>{selectedPrompt.text}</Text>}
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
              <View style={styles.countRow}>
                {error ? <Text style={styles.errorText}>{ERROR_MESSAGE[error]}</Text> : <View />}
                <Text style={styles.count}>{body.length} / {MAX_CHARS}</Text>
              </View>

              {/* Live match bar (mock: "Items matched from your reflection") */}
              <Text style={styles.matchLabel}>Items matched from your reflection</Text>
              <Pressable
                onPress={() => {
                  if (shownMatches.length > 0) {
                    void haptics.pageOpen();
                    setEditOpen(true);
                  }
                }}
                disabled={shownMatches.length === 0}
                style={styles.matchBar}
              >
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                  {shownMatches.length === 0 ? (
                    <Text style={styles.matchEmpty}>Items will appear as you write…</Text>
                  ) : (
                    shownMatches.map((m) => (
                      <ItemSprite key={m.itemId} itemId={m.itemId} size={44} radius={12} />
                    ))
                  )}
                </ScrollView>
              </Pressable>

              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={() => void onSubmit()}
                disabled={submitting || body.trim().length === 0}
                style={{ marginTop: 16, marginBottom: insets.bottom + 12, opacity: submitting || body.trim().length === 0 ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                {submitting ? (
                  <ActivityIndicator color={RC.ink} />
                ) : (
                  <Text style={styles.yellowBtnText}>Save Reflection</Text>
                )}
              </OffsetCard>
            </View>
          ) : (
            draft && (
              <View style={{ flex: 1 }}>
                <ReflectSettlementView
                  draft={draft}
                  itemWord="Matched"
                  onFinalized={(snapshot) => {
                    cacheReflectItems(snapshot);
                    setRemaining(snapshot.reflectsRemaining);
                    if (snapshot.bubble) setReflectBubble(snapshot.bubble);
                    void fetchReflectFeed({ force: true });
                    void fetchBags('mine');
                    router.back();
                  }}
                />
              </View>
            )
          )}
        </View>
      </KeyboardAvoidingView>

      {editOpen && (
        <MatchedItemsReviewSheet
          items={shownMatches}
          onRemove={removeMatch}
          onDone={() => setEditOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim },

  pickScroll: { paddingBottom: 24 },
  lead: { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  leadSub: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', marginTop: 4, marginBottom: 18 },
  promptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', padding: 18 },
  promptTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  promptText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#3E3229', marginTop: 3, lineHeight: 19 },
  promptIcon: { width: 54, height: 54 },

  chosenPrompt: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 12 },
  input: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: '#2A2118',
  },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  count: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  errorText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFD9D9', flex: 1, marginRight: 8 },

  matchLabel: {
    fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF',
    textAlign: 'center', marginTop: 12, marginBottom: 8,
  },
  matchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 10, paddingLeft: 12, paddingRight: 10,
  },
  matchRow: { gap: 8, alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  matchEmpty: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#B7AEA6' },

  yellowBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 17 },
  yellowBtnText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  restTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  restBody: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', lineHeight: 24 },
});
