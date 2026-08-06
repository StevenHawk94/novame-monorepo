import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { ITEM_DICTIONARY } from '@novame/engine';

import {
  getReflectStateToday,
  submitReflect,
  type ReflectError,
  type ReflectSnapshot,
} from '../../src/lib/reflect-api';
import { fetchReflectFeed } from '../../src/lib/reflect-feed-api';
import { fetchBags } from '../../src/lib/bags-api';
import { getCachedSubscriptionTier } from '../../src/lib/subscription';
import { haptics } from '../../src/lib/haptics';
import { BACKGROUNDS } from '../../src/lib/icons';
import {
  GUIDED_MAX,
  GUIDED_MIN,
  availableGuidedCategories,
  itemsForGuidedCategory,
  getGuidedSelection,
  guidedCategoryFor,
  setGuidedSelection,
} from '../../src/lib/guided-prompts';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import {
  MemoryEditSheet,
  RC,
  ReflectResultView,
  ReflectTopBar,
  SelectableItemGrid,
} from '../../src/components/main/reflect-shared';

const MAX_CHARS = 5000;

/**
 * 流程2 — Guided Prompts (2026-07-24 v2): the FIRST run opens the category
 * chooser ("What do you want to reflect on?", pick 3-20 of the taxonomy);
 * afterwards the flow jumps straight into one prompt page PER chosen
 * category (each skippable), then the optional note page. The prompt pages'
 * Edit button reopens the chooser any time. Selection persists per user;
 * questions live in lib/guided-prompts.ts (data-driven — the list follows
 * whatever taxonomy the dictionary currently holds).
 */
type Phase = 'choose' | 'steps' | 'note' | 'result';

export default function ReflectGuidedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const initial = useMemo(() => getReflectStateToday(), []);
  const all = useMemo(() => availableGuidedCategories(), []);
  const stored = useMemo(() => getGuidedSelection(), []);

  const [phase, setPhase] = useState<Phase>(stored.length >= GUIDED_MIN ? 'steps' : 'choose');
  const [chosen, setChosen] = useState<string[]>(stored);
  // Chooser working copy (so Edit can cancel without touching the real picks).
  const [draft, setDraft] = useState<Set<string>>(new Set(stored));
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReflectError | null>(null);
  const [result, setResult] = useState<ReflectSnapshot | null>(null);
  const [remaining, setRemaining] = useState(initial.reflectsRemaining);
  const isPaid = getCachedSubscriptionTier() !== 'free';

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current !== 'result') setRemaining(getReflectStateToday().reflectsRemaining);
    }, []),
  );

  const stepDef = guidedCategoryFor(chosen[step] ?? '');
  const gridIds = useMemo(
    () => (chosen[step] ? itemsForGuidedCategory(chosen[step]) : []),
    [chosen, step],
  );
  const selectedList = useMemo(
    () =>
      [...selected].map((id) => ({
        itemId: id,
        displayName: ITEM_DICTIONARY.items[id]?.displayName ?? id,
      })),
    [selected],
  );

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function toggleDraft(key: string) {
    void haptics.light();
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size >= GUIDED_MAX) {
        appAlert(`Up to ${GUIDED_MAX}`, `You can pick at most ${GUIDED_MAX} themes.`);
        return cur;
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function onConfirmChoose() {
    if (draft.size < GUIDED_MIN) return;
    void haptics.medium();
    // Persist in the chooser's canonical order so prompt pages are stable.
    const ordered = all.filter((c) => draft.has(c.key)).map((c) => c.key);
    setGuidedSelection(ordered);
    setChosen(ordered);
    setStep(0);
    setPhase('steps');
  }

  function openEdit() {
    void haptics.light();
    setDraft(new Set(chosen));
    setPhase('choose');
  }

  function onNext() {
    void haptics.light();
    if (step < chosen.length - 1) {
      setStep(step + 1);
    } else {
      setPhase('note');
    }
  }

  async function onSubmit(wantStory: boolean) {
    if (submitting || selected.size === 0) return;
    if (wantStory && !isPaid) {
      appAlert('A Plus feature', 'Cute stories come with NovaMe Plus.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'See Plus', onPress: () => router.push('/(main)/(modals)/subscription-paywall' as never) },
      ]);
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await submitReflect({
      promptId: 9,
      body: note,
      mode: 'prompt',
      selectedItems: [...selected].map((id) => ({
        itemId: id,
        note: notes[id]?.trim() || undefined,
      })),
      wantStory,
    });
    setSubmitting(false);
    if (res.ok) {
      setResult(res.snapshot);
      setRemaining(res.snapshot.reflectsRemaining);
      void fetchReflectFeed();
      void fetchBags();
      void haptics.success();
      setPhase('result');
    } else {
      setError(res.error);
      if (res.error === 'daily_limit') setRemaining(0);
    }
  }

  function onBack() {
    if (phase === 'choose') {
      // Editing an existing selection cancels back to the pages; the first
      // run has nothing to fall back to and leaves the flow.
      if (chosen.length >= GUIDED_MIN) setPhase('steps');
      else router.back();
    } else if (phase === 'note') {
      setPhase('steps');
    } else if (phase === 'steps' && step > 0) {
      setStep(step - 1);
    } else {
      router.back();
    }
  }

  const atLimit = remaining <= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#5A2E2A' }}>
      <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
      {phase !== 'choose' && <View style={styles.scrim} />}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && (
            <View style={styles.topRow}>
              <ReflectTopBar remaining={phase === 'steps' ? undefined : remaining} onBack={onBack} />
              {phase === 'steps' && (
                <Pressable onPress={openEdit} style={styles.editPill} hitSlop={8}>
                  <MaterialIcons name="edit" size={18} color="#FFFFFF" />
                  <Text style={styles.editPillText}>Edit</Text>
                </Pressable>
              )}
            </View>
          )}

          {atLimit && phase !== 'result' ? (
            <View style={styles.center}>
              <Text style={styles.restTitle}>That’s three for today</Text>
              <Text style={styles.restBody}>
                You&apos;ve reflected 3 times today. Rest up — come back tomorrow.
              </Text>
            </View>
          ) : phase === 'choose' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.chooseTitle}>What do you want to reflect on?</Text>
              <Text style={styles.chooseSub}>Select the activities you engage in.</Text>
              <View style={styles.choosePanel}>
                <Text style={styles.chooseHint}>Select at least {GUIDED_MIN}</Text>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                  <View style={styles.pillGrid}>
                    {all.map((c) => {
                      const on = draft.has(c.key);
                      return (
                        <Pressable
                          key={c.key}
                          onPress={() => toggleDraft(c.key)}
                          style={[styles.pill, on && styles.pillOn]}
                        >
                          <Text style={styles.pillEmoji}>{c.emoji}</Text>
                          <Text style={[styles.pillText, on && styles.pillTextOn]}>
                            {c.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={onConfirmChoose}
                disabled={draft.size < GUIDED_MIN}
                style={{ marginTop: 14, opacity: draft.size < GUIDED_MIN ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                <Text style={styles.yellowBtnText}>Confirm</Text>
              </OffsetCard>
              <Text style={[styles.chooseFootnote, { marginBottom: insets.bottom + 10 }]}>
                You can edit anytime by clicking “edit” on page
              </Text>
            </View>
          ) : phase === 'steps' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{stepDef.question}</Text>
              <View style={styles.gridCard}>
                <SelectableItemGrid itemIds={gridIds} selected={selected} onToggle={toggle} />
              </View>
              <Text style={styles.passHint}>You can pass if nothing you want to select here</Text>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={onNext}
                cardStyle={styles.yellowBtn}
                style={{ marginBottom: insets.bottom + 12 }}
              >
                <Text style={styles.yellowBtnText}>Next</Text>
              </OffsetCard>
            </View>
          ) : phase === 'note' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitleLeft}>Anything you want to say? (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Add Note…"
                placeholderTextColor="#B7AEA6"
                value={note}
                onChangeText={(t) => setNote(t.slice(0, MAX_CHARS))}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.countRow}>
                {error ? (
                  <Text style={styles.errorText}>Couldn’t save that. Try again.</Text>
                ) : <View />}
                <Text style={styles.count}>{note.length} / {MAX_CHARS}</Text>
              </View>

              <Text style={styles.matchLabel}>Items You Selected</Text>
              <View style={styles.matchBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                  {selectedList.map((m) => (
                    <ItemSprite key={m.itemId} itemId={m.itemId} size={44} radius={12} />
                  ))}
                </ScrollView>
                <Pressable
                  onPress={() => { void haptics.light(); setEditOpen(true); }}
                  style={styles.pencilBtn}
                  hitSlop={8}
                >
                  <MaterialIcons name="edit" size={20} color="#FFFFFF" />
                </Pressable>
              </View>

              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={() => void onSubmit(false)}
                disabled={submitting || selected.size === 0}
                style={{ marginTop: 16, opacity: submitting || selected.size === 0 ? 0.55 : 1 }}
                cardStyle={styles.yellowBtn}
              >
                {submitting ? <ActivityIndicator color={RC.ink} /> : (
                  <Text style={styles.yellowBtnText}>Save Reflection</Text>
                )}
              </OffsetCard>
              <OffsetCard
                color={RC.orangeDrop}
                offset={4}
                radius={24}
                onPress={() => void onSubmit(true)}
                disabled={submitting || selected.size === 0}
                style={{ marginTop: 12, marginBottom: insets.bottom + 12, opacity: submitting || selected.size === 0 ? 0.55 : 1 }}
                cardStyle={styles.orangeBtn}
              >
                <Text style={styles.orangeBtnText}>Save and create a cute story for my day</Text>
                <View style={styles.plusBadge}>
                  <Text style={styles.plusBadgeText}>PLUS</Text>
                </View>
              </OffsetCard>
            </View>
          ) : (
            result && (
              <View style={{ flex: 1, paddingBottom: insets.bottom + 12 }}>
                <ReflectResultView result={result} onFinished={() => router.back()} />
              </View>
            )
          )}
        </View>
      </KeyboardAvoidingView>

      {editOpen && (
        <MemoryEditSheet
          items={selectedList}
          notes={notes}
          onChangeNote={(id, t) => setNotes((cur) => ({ ...cur, [id]: t }))}
          onDone={() => setEditOpen(false)}
          isPaid={isPaid}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim },
  topRow: { position: 'relative' },
  editPill: {
    position: 'absolute', right: 0, top: 4,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  editPillText: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  chooseTitle: { fontSize: 25, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center' },
  chooseSub: { fontSize: 15, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', marginTop: 4, marginBottom: 14 },
  choosePanel: { flex: 1, backgroundColor: '#FFF8E3', borderRadius: 26, padding: 14 },
  chooseHint: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#2A2118', marginBottom: 10, paddingHorizontal: 2 },
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  pill: {
    width: '48%', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 26, paddingVertical: 14, paddingHorizontal: 14,
  },
  pillOn: { backgroundColor: '#8A5F3F' },
  pillEmoji: { fontSize: 20 },
  pillText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#161311', flexShrink: 1 },
  pillTextOn: { color: '#FFFFFF' },
  chooseFootnote: {
    fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.95)',
    textAlign: 'center', marginTop: 10,
  },

  stepTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 14 },
  stepTitleLeft: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 12 },
  gridCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 26 },
  passHint: {
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.95)',
    textAlign: 'center', marginTop: 12, marginBottom: 10,
  },

  input: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: '#2A2118',
  },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  count: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  errorText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFD9D9', flex: 1, marginRight: 8 },

  matchLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', marginTop: 12, marginBottom: 8 },
  matchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 10, paddingLeft: 12, paddingRight: 10,
  },
  matchRow: { gap: 8, alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  pencilBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#43301F',
    alignItems: 'center', justifyContent: 'center',
  },

  yellowBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 17 },
  yellowBtnText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },
  orangeBtn: {
    backgroundColor: RC.orange, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, paddingVertical: 15, paddingHorizontal: 12,
  },
  orangeBtnText: { fontSize: 15.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', flexShrink: 1 },
  plusBadge: { backgroundColor: '#43301F', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  plusBadgeText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  restTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  restBody: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.95)', textAlign: 'center', lineHeight: 24 },
});
