import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { randomUUID } from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TAP_YOUR_DAY_CHOICES, TAP_YOUR_DAY_QUESTIONS, TAP_YOUR_DAY_VERSION } from '@novame/engine';

import { getReflectStateToday, prepareReflect, SELECTION_UNAVAILABLE_MESSAGE, type PreparedReflect, type ReflectError } from '@/lib/reflect-api';
import { fetchReflectFeed } from '@/lib/reflect-feed-api';
import { cacheReflectItems, fetchBags } from '@/lib/bags-api';
import { useSubscriptionTier } from '@/lib/use-subscription-tier';
import { haptics } from '@/lib/haptics';
import { BACKGROUNDS } from '@/lib/icons';
import { OffsetCard } from '@/components/ui/offset-card';
import { TAP_GRID_PADDING, TAP_ITEM_GAP, TapYourDayItem, tapItemGridMetrics } from '@/components/main/tap-your-day-item';
import { RC, ReflectTopBar } from '@/components/main/reflect-shared';
import { ReflectSettlementView } from '@/components/main/reflect-settlement';

const MAX_CHARS = 5000;
type Phase = 'steps' | 'note' | 'result';

/** Four skippable questions. Section labels are headings, never navigation tabs. */
export default function ReflectGuidedScreen() {
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const router = useRouter();
  const tier = useSubscriptionTier();
  const isPaid = tier !== 'free';
  const [phase, setPhase] = useState<Phase>('steps');
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState('');
  const [preparedDraft, setPreparedDraft] = useState<PreparedReflect | null>(null);
  const [remaining, setRemaining] = useState(() => getReflectStateToday().reflectsRemaining);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReflectError | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const requestKey = useRef<string | null>(null);
  const submitLock = useRef(false);
  const question = TAP_YOUR_DAY_QUESTIONS[step];
  const selectedList = useMemo(() => TAP_YOUR_DAY_CHOICES.filter((choice) => selected.has(choice.itemId)), [selected]);
  const { cellWidth } = tapItemGridMetrics(gridWidth, fontScale);

  useFocusEffect(useCallback(() => {
    setRemaining(getReflectStateToday().reflectsRemaining);
  }, []));
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setToast(null);
  }, [step, phase]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function toggle(itemId: string, label: string) {
    void haptics.light();
    requestKey.current = null;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
    setToast(label);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1000);
  }
  function onBack() {
    if (submitting) return;
    if (phase === 'note') setPhase('steps');
    else if (step > 0) setStep((value) => value - 1);
    else router.back();
  }
  function onNext() {
    void haptics.light();
    if (step < TAP_YOUR_DAY_QUESTIONS.length - 1) setStep((value) => value + 1);
    else setPhase('note');
  }
  async function onSubmit() {
    if (submitLock.current || selected.size === 0) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    requestKey.current ??= randomUUID();
    try {
      const result = await prepareReflect({
        promptId: 9, body: note, mode: 'prompt', selectionVersion: TAP_YOUR_DAY_VERSION,
        selectedItems: selectedList.map(({ itemId }) => ({ itemId })),
        idempotencyKey: requestKey.current,
      });
      if (!result.ok) {
        setError(result.error);
        // An old server may have created a partial draft. After deployment,
        // retry with a fresh key but retain every selection and the note.
        if (result.error === 'selection_unavailable') requestKey.current = null;
        if (result.error === 'daily_limit') setRemaining(0);
        return;
      }
      Keyboard.dismiss();
      setPreparedDraft(result.draft);
      setPhase('result');
    } catch {
      setError('network');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ExpoImage source={BACKGROUNDS.reflect} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View pointerEvents="none" style={styles.scrim} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={phase !== 'result'}>
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && <ReflectTopBar onBack={onBack} />}
          {remaining <= 0 && phase !== 'result' ? (
            <View style={styles.center}>
              <Text style={styles.title}>That’s three for today</Text>
              <Text style={styles.hint}>You&apos;ve reflected 3 times today. Rest up — come back tomorrow.</Text>
            </View>
          ) : phase === 'steps' ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{question.title}</Text>
              <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.sections} showsVerticalScrollIndicator={false}>
                {question.groups.map((section, index) => (
                  <View key={step + '-' + index} style={styles.section}>
                    {!!section.title && <View style={styles.sectionPill}><Text style={styles.sectionTitle}>{section.title}</Text></View>}
                    <View style={styles.gridCard} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
                      {gridWidth > 0 && section.choices.map((choice) => (
                        <TapYourDayItem key={choice.itemId} choice={choice} width={cellWidth}
                          selected={selected.has(choice.itemId)} onPress={() => toggle(choice.itemId, choice.label)} />
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View style={{ paddingBottom: insets.bottom + 12 }}>
                <Text style={styles.hint}>You can pass if nothing you want to select here</Text>
                <OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={onNext} cardStyle={styles.yellowBtn}>
                  <Text style={styles.yellowBtnText}>Next</Text>
                </OffsetCard>
              </View>
              {toast !== null && <View pointerEvents="none" style={styles.toastWrap}><Text style={styles.toast}>{toast}</Text></View>}
            </View>
          ) : phase === 'note' ? (
            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.noteContent, { paddingBottom: insets.bottom + 20 }]}>
              <Text style={styles.noteTitle}>Anything worth remembering? (Optional)</Text>
              <TextInput
                style={[styles.input, { height: Math.max(180, Math.min(340, height * 0.38)) }]}
                placeholder={isPaid ? 'Add a note & save your items in memories' : 'Type here'} placeholderTextColor="#B7AEA6"
                value={note} onChangeText={(text) => { requestKey.current = null; setNote(text.slice(0, MAX_CHARS)); }}
                editable={!submitting} multiline textAlignVertical="top" maxLength={MAX_CHARS}
              />
              <Text style={styles.count}>{note.length} / {MAX_CHARS}</Text>
              <Text style={styles.matchLabel}>Items You Selected</Text>
              <View style={styles.matchBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                  {selectedList.map((choice) => <TapYourDayItem key={choice.itemId} choice={choice}
                    width={50} iconSize={44} showLabel={false} />)}
                  {selectedList.length === 0 && <Text style={styles.emptyText}>Go back to select at least one item.</Text>}
                </ScrollView>
              </View>
              {!!error && <Text style={styles.errorText}>{error === 'selection_unavailable'
                ? SELECTION_UNAVAILABLE_MESSAGE
                : error === 'too_long' ? 'That’s a little long. Trim it under 5,000 characters.'
                  : 'Couldn’t save that. Check your connection and try again.'}</Text>}
              <OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={() => void onSubmit()}
                disabled={submitting || selected.size === 0}
                style={{ marginTop: 20, opacity: submitting || selected.size === 0 ? 0.55 : 1 }} cardStyle={styles.yellowBtn}>
                {submitting ? <ActivityIndicator color={RC.ink} /> : <Text style={styles.yellowBtnText}>Save Reflection</Text>}
              </OffsetCard>
            </ScrollView>
          ) : preparedDraft && (
            <ReflectSettlementView draft={preparedDraft} itemWord="Selected" onFinalized={(snapshot) => {
              cacheReflectItems(snapshot);
              setRemaining(snapshot.reflectsRemaining);
              void fetchReflectFeed({ force: true });
              void fetchBags('mine');
              router.back();
            }} />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: RC.scrim },
  title: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 18 },
  sections: { paddingBottom: 18, gap: 22 },
  section: { gap: 14 },
  sectionPill: { alignSelf: 'center', backgroundColor: '#FFE266', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 20 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#493219', textAlign: 'center' },
  gridCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: TAP_GRID_PADDING, flexDirection: 'row', flexWrap: 'wrap', gap: TAP_ITEM_GAP },
  hint: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', textAlign: 'center', marginVertical: 12, lineHeight: 19 },
  yellowBtn: { backgroundColor: RC.yellow, alignItems: 'center', paddingVertical: 17 },
  yellowBtnText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#5A4419' },
  toastWrap: { position: 'absolute', left: 12, right: 12, bottom: 112, alignItems: 'center' },
  toast: { backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold', overflow: 'hidden' },
  noteContent: { flexGrow: 1 },
  noteTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', marginBottom: 12 },
  input: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24, color: '#2A2118' },
  count: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'right', marginTop: 6 },
  matchLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center', marginTop: 16, marginBottom: 10 },
  matchBar: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 12 },
  matchRow: { gap: 8, alignItems: 'flex-start', flexGrow: 1, justifyContent: 'center', minHeight: 44 },
  emptyText: { fontSize: 13, color: '#655344' },
  errorText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFD9D9', marginTop: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
});
