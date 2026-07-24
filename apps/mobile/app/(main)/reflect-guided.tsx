import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { OffsetCard } from '../../src/components/ui/offset-card';
import { ItemSprite } from '../../src/components/ui/item-sprite';
import {
  MemoryEditSheet,
  RC,
  ReflectResultView,
  ReflectTopBar,
  SelectableItemGrid,
  itemIdsForCategories,
} from '../../src/components/main/reflect-shared';

const MAX_CHARS = 5000;

/**
 * 流程2 — Guided Prompts (my days): tap through the prompt pages, pick what
 * fits, no typing needed. The optional note page follows; Plus can turn the
 * picks into a cute story for the paired person. Every pick becomes a memory
 * item (server: mode 'prompt', notes ride per item).
 *
 * Prompt set + order (2026-07-24 产品口径):
 *   1. How do you feel?                 Emotions & Mental States
 *   2. What did you eat and drink today? Food & Drinks
 *   3. What did you do today?           Entertainment / Sports / Beauty (三选)
 */
const STEPS: { title: string; categories: string[]; chips?: { key: string; label: string }[] }[] = [
  { title: 'How do you feel?', categories: ['emotions'] },
  { title: 'What did you eat and drink today?', categories: ['food'] },
  {
    title: 'What did you do today?',
    categories: ['entertainment', 'sports', 'beauty'],
    chips: [
      { key: 'entertainment', label: 'Fun' },
      { key: 'sports', label: 'Active' },
      { key: 'beauty', label: 'Self-care' },
    ],
  },
];

type Phase = 'steps' | 'note' | 'result';

export default function ReflectGuidedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const initial = useMemo(() => getReflectStateToday(), []);
  const [phase, setPhase] = useState<Phase>('steps');
  const [step, setStep] = useState(0);
  const [chip, setChip] = useState<string>('entertainment');
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

  const stepDef = STEPS[step];
  const gridIds = useMemo(
    () => itemIdsForCategories(stepDef.chips ? [chip] : stepDef.categories),
    [stepDef, chip],
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

  function onNext() {
    void haptics.light();
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      setPhase('note');
    }
  }

  async function onSubmit(wantStory: boolean) {
    if (submitting || selected.size === 0) return;
    if (wantStory && !isPaid) {
      Alert.alert('A Plus feature', 'Cute stories come with NovaMe Plus.', [
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

  const atLimit = remaining <= 0;

  return (
    <ImageBackground source={BACKGROUNDS.reflect} style={{ flex: 1 }} resizeMode="cover">
      <View style={styles.scrim} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && (
            <ReflectTopBar
              remaining={remaining}
              onBack={() => {
                if (phase === 'note') setPhase('steps');
                else if (step > 0) setStep(step - 1);
                else router.back();
              }}
            />
          )}

          {atLimit && phase !== 'result' ? (
            <View style={styles.center}>
              <Text style={styles.restTitle}>That’s three for today</Text>
              <Text style={styles.restBody}>
                You&apos;ve reflected 3 times today. Rest up — come back tomorrow.
              </Text>
            </View>
          ) : phase === 'steps' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{stepDef.title}</Text>
              {stepDef.chips && (
                <View style={styles.chipRow}>
                  {stepDef.chips.map((c) => (
                    <Pressable
                      key={c.key}
                      onPress={() => { void haptics.light(); setChip(c.key); }}
                      style={[styles.chip, chip === c.key && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, chip === c.key && styles.chipTextOn]}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={styles.gridCard}>
                <SelectableItemGrid itemIds={gridIds} selected={selected} onToggle={toggle} />
              </View>
              <OffsetCard
                color={RC.yellowDrop}
                offset={4}
                radius={24}
                onPress={onNext}
                cardStyle={styles.yellowBtn}
                style={{ marginTop: 14, marginBottom: insets.bottom + 12 }}
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
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim },

  stepTitle: { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 14 },
  stepTitleLeft: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 12 },
  chipRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 12 },
  chip: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 },
  chipOn: { backgroundColor: RC.orange },
  chipText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#5A4419' },
  chipTextOn: { color: '#FFFFFF' },
  gridCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 26 },

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
