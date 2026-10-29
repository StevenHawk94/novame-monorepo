import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useReflectExitGuard } from '@/lib/use-reflect-exit-guard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TAP_YOUR_DAY_QUESTIONS, TAP_YOUR_DAY_VERSION, tapYourDayChoice, MAX_TAP_YOUR_DAY_SELECTIONS, type TapYourDayChoice, type CustomTapItem } from '@novame/engine';
import { useCustomTapItems } from '@/lib/custom-tap-items';
import { CustomTapItemSheet } from '@/components/main/custom-tap-item-sheet';
import { canAddCustomTapItem, customTapGroupsForQuestion } from '@/lib/custom-tap-catalog';

import {
  SELECTION_UNAVAILABLE_MESSAGE,
  type ReflectError,
} from '@/lib/reflect-api';
import { haptics } from '@/lib/haptics';
import { ReflectCelebration } from '@/components/main/reflect-celebration';
import { ADVENTURE_LOG_BACKGROUND } from '@/lib/burrow-surface';
import { OffsetCard } from '@/components/ui/offset-card';
import { TAP_GRID_PADDING, TAP_ITEM_GAP, TapYourDayItem, tapItemGridMetrics } from '@/components/main/tap-your-day-item';
import { RC, ReflectTopBar } from '@/components/main/reflect-shared';
import { useBurrowSnapshot } from '@/lib/burrow-store';
import { prefetchAdventureRewards } from '@/lib/adventure-prefetch';
import {useAdventureTeamPrefetch} from '@/lib/use-adventure-team-prefetch';
import { AndroidCompactText as Text, AndroidCompactTextInput as TextInput } from '@/components/ui/android-compact-typography';
import { getAdaptiveFrameMetrics } from '@/components/layout/adaptive-app-frame';
import { AdventureRecordCompletion } from '@/components/burrow/adventure-record-completion';
import { keepBurrowTextDraft, readBurrowTextDraft } from '@/lib/burrow-text-drafts';
import { sessionEpoch, sessionUserId } from '@/lib/session-lifecycle';
import { queueAdventureJournal } from '@/lib/adventure-journal-jobs';
import { AdventureStageTransition } from '@/components/burrow/adventure-stage-transition';
import { AdventureReveal } from '@/components/burrow/adventure-reveal';

const MAX_CHARS = 5000;
type Phase = 'steps' | 'note' | 'result';
type DayChoice = TapYourDayChoice & Partial<CustomTapItem>;

/** Four skippable questions. Section labels are headings, never navigation tabs. */
export default function ReflectGuidedScreen() {
  const {data:burrow}=useBurrowSnapshot();
  useAdventureTeamPrefetch();
  useEffect(() => { prefetchAdventureRewards(burrow?.adventureCollection?.enabled); }, [burrow?.adventureCollection?.enabled]);
  const draftScope = useRef(`${sessionUserId()}:adventure-tap`).current;
  const draftTarget = useRef(new Date().toDateString()).current;
  const epoch = useRef(sessionEpoch());
  const [restored] = useState(() => {
    try {
      const saved = readBurrowTextDraft(draftScope, draftTarget);
      const value = JSON.parse(saved?.body || '{}');
      return { note: typeof value.note === 'string' ? value.note.slice(0, MAX_CHARS) : '',
        choices: Array.isArray(value.choices) ? value.choices.flatMap((x: DayChoice) => {
          const choice = typeof x?.itemId === 'string' ? tapYourDayChoice(x.itemId) : undefined;
          return choice ? [choice] : [];
        }).slice(0, MAX_TAP_YOUR_DAY_SELECTIONS) as DayChoice[] : [],
        shared: value.shared !== false, key: saved?.key || null };
    } catch { return { note: '', choices: [] as DayChoice[], shared: true, key: null }; }
  });
  // Preserve the privacy of an existing draft without exposing a sharing control.
  const shareToPartner = restored.shared;
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height, fontScale } = useWindowDimensions();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('steps');
  const [step, setStep] = useState(0);
  const direction = useRef<'forward' | 'back'>('forward');
  const custom = useCustomTapItems();
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, DayChoice>>(() => new Map(restored.choices.map(choice => [choice.itemId, choice])));
  const [note, setNote] = useState(restored.note);
  const [journalJobId, setJournalJobId] = useState<string | null>(null);
  const submitting = false;
  const [error, setError] = useState<ReflectError | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const submitLock = useRef(false);
  useReflectExitGuard(submitting, 'Your day is being saved. Please wait a moment.');
  const question = TAP_YOUR_DAY_QUESTIONS[step];
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  useEffect(() => {
    if (phase === 'result' || epoch.current !== sessionEpoch()) return;
    try { keepBurrowTextDraft(draftScope, draftTarget,
      JSON.stringify({ note, choices: selectedList, shared: shareToPartner, selectionVersion: TAP_YOUR_DAY_VERSION })); } catch { /* Another session owns the draft. */ }
  }, [phase, note, selectedList, shareToPartner]);
  const groups = useMemo(() => customTapGroupsForQuestion(question, custom.items), [question, custom.items]);
  // The root has 18dp horizontal padding on each side. Compute the content
  // width before the first paint instead of waiting for gridCard.onLayout.
  // Waiting produced one visible Android frame containing only empty white
  // cards; iOS happened to hide that frame behind its transition animation.
  const gridWidth = Math.max(1, getAdaptiveFrameMetrics(windowWidth, height).width - 36);
  const { cellWidth } = tapItemGridMetrics(gridWidth, fontScale);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setToast(null);
  }, [step, phase]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function isSelected(choice: DayChoice) {
    const current = selected.get(choice.itemId);
    return current?.label === choice.label && !!current?.custom === !!choice.custom;
  }
  function toggle(choice: DayChoice) {
    void haptics.light();
    const prior = selected.get(choice.itemId);
    const removing = prior?.label === choice.label && !!prior?.custom === !!choice.custom;
    if (!removing && selected.size >= MAX_TAP_YOUR_DAY_SELECTIONS) {
      setToast(`You can select up to ${MAX_TAP_YOUR_DAY_SELECTIONS} items.`);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 1800);
      return;
    }
    setSelected((current) => {
      const next = new Map(current);
      const prior = next.get(choice.itemId);
      if (prior?.label === choice.label && !!prior?.custom === !!choice.custom) next.delete(choice.itemId);
      else next.set(choice.itemId, choice);
      return next;
    });
    setToast(removing ? `${choice.label} removed` : choice.label);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1000);
  }
  function onBack() {
    if (submitting) return;
    direction.current = 'back';
    if (phase === 'note') setPhase('steps');
    else if (step > 0) setStep((value) => value - 1);
    else router.back();
  }
  function onNext() {
    direction.current = 'forward';
    void haptics.light();
    if (step < TAP_YOUR_DAY_QUESTIONS.length - 1) setStep((value) => value + 1);
    else setPhase('note');
  }
  function onSubmit() {
    if (submitLock.current || selected.size === 0 || epoch.current !== sessionEpoch()) return;
    try {
      const local = keepBurrowTextDraft(draftScope, draftTarget, JSON.stringify({ note, choices: selectedList,
        shared: shareToPartner, selectionVersion: TAP_YOUR_DAY_VERSION }));
      const id = queueAdventureJournal({ promptId: 9, body: note, mode: 'prompt',
        selectedItems: selectedList, selectionVersion: TAP_YOUR_DAY_VERSION,
        idempotencyKey: local.key, shareToPartner: !!burrow?.partner && shareToPartner },
        { scope: draftScope, target: draftTarget, key: local.key });
      submitLock.current = true; direction.current = 'forward'; Keyboard.dismiss(); setJournalJobId(id); setPhase('result');
    } catch { setError('network'); }
  }

  return (
    <AdventureStageTransition stageKey={`${phase}:${phase === 'steps' ? step : ''}`} direction={direction.current}>
    {phase === 'result' && journalJobId ? <AdventureRecordCompletion jobId={journalJobId} /> :
    <View style={{ flex: 1, backgroundColor: ADVENTURE_LOG_BACKGROUND }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={phase !== 'result'}>
        <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
          {phase !== 'result' && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <ReflectTopBar onBack={onBack} />
            {phase === 'steps' && canAddCustomTapItem(question) && <Pressable disabled={!custom.ready} onPress={() => { void haptics.light(); setAddOpen(true); }} style={{ backgroundColor: '#50351D', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 10 }}><Text style={{ color: '#FFF', fontSize: 18, fontFamily: 'Inter_700Bold' }}>＋ Add</Text></Pressable>}
          </View>}
          {phase === 'steps' ? (
            <View style={{ flex: 1 }}>
              <AdventureReveal enabled><Text style={styles.title}>{question.title}</Text></AdventureReveal>
              <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.sections} showsVerticalScrollIndicator={false}>
                {groups.map((section, index) => (
                  <AdventureReveal enabled delay={180 + Math.min(index, 4) * 50} key={step + '-' + index} style={styles.section}>
                    {!!section.title && <View style={styles.sectionPill}><Text style={styles.sectionTitle}>{section.title}</Text></View>}
                    <View style={styles.gridCard}>
                      {section.choices.map((choice) => (
                        <TapYourDayItem key={`${choice.itemId}:${!!choice.custom}`} choice={choice} width={cellWidth}
                          selected={isSelected(choice)} onPress={() => toggle(choice)} />
                      ))}
                    </View>
                  </AdventureReveal>
                ))}
              </ScrollView>
              <AdventureReveal enabled delay={300} style={[styles.stepsFooter, { paddingBottom: insets.bottom + 12 }]}>
                <Text style={[styles.hint, styles.passHint]}>You can skip if there is nothing to add on this page.</Text>
                <OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={onNext} cardStyle={styles.yellowBtn}>
                  <Text style={styles.yellowBtnText}>Next</Text>
                </OffsetCard>
              </AdventureReveal>
              {toast !== null && <View pointerEvents="none" style={styles.toastWrap}><Text style={styles.toast}>{toast}</Text></View>}
            </View>
          ) : phase === 'note' ? (
            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.noteContent, { paddingBottom: insets.bottom + 20 }]}>
              <AdventureReveal enabled><Text style={styles.noteTitle}>Anything worth remembering? (Optional)</Text></AdventureReveal>
              <AdventureReveal enabled delay={180}>
              <TextInput
                style={[styles.input, { height: Math.max(180, Math.min(340, height * 0.38)) }]}
                placeholder="Add a note about your day (optional)" placeholderTextColor="#B7AEA6"
                value={note} onChangeText={(text) => { setNote(text.slice(0, MAX_CHARS)); }}
                editable={!submitting} multiline textAlignVertical="top" maxLength={MAX_CHARS}
              />
              </AdventureReveal>
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
                : error === 'daily_adventure_used' ? 'Your adventure has started. Save a new day tomorrow.'
                : error === 'not_paired' ? 'Reconnect with your partner before saving.'
                : error === 'journal_kind_used' ? "You've already used Tap Your Day today. It will be available again tomorrow."
                : error === 'too_long' ? 'That’s a little long. Trim it under 5,000 characters.'
                  : 'Couldn’t save that. Check your connection and try again.'}</Text>}
              {!!burrow?.partner&&shareToPartner&&<Text style={{color:'#FFFFFF',fontSize:14,lineHeight:21,marginTop:12}}>Your partner can see your selected items and anything you write.</Text>}
              <AdventureReveal enabled delay={300}><OffsetCard color={RC.yellowDrop} offset={4} radius={24} onPress={() => void onSubmit()}
                disabled={submitting || selected.size === 0}
                style={{ marginTop: 20, opacity: submitting || selected.size === 0 ? 0.55 : 1 }} cardStyle={styles.yellowBtn}>
                {submitting ? <ActivityIndicator color={RC.ink} /> : <Text style={styles.yellowBtnText}>Save</Text>}
              </OffsetCard></AdventureReveal>
            </ScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      {addOpen && <CustomTapItemSheet question={question} addedItems={custom.items} onClose={() => setAddOpen(false)} onSave={item => {
        custom.save(item);
        if (!selected.has(item.itemId) && selected.size >= MAX_TAP_YOUR_DAY_SELECTIONS) {
          setToast(`Saved. You can select up to ${MAX_TAP_YOUR_DAY_SELECTIONS} items per journal.`);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 2200);
          return;
        }
        setSelected(old => new Map(old).set(item.itemId, item));
      }} />}
      <ReflectCelebration active={phase === 'result'} />
    </View>}
    </AdventureStageTransition>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  title: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 18 },
  sections: { paddingBottom: 18, gap: 22 },
  section: { gap: 14 },
  sectionPill: { alignSelf: 'center', backgroundColor: '#FFE266', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 20 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#493219', textAlign: 'center' },
  gridCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: TAP_GRID_PADDING, flexDirection: 'row', flexWrap: 'wrap', gap: TAP_ITEM_GAP },
  hint: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', textAlign: 'center', marginVertical: 12, lineHeight: 19 },
  stepsFooter: { paddingTop: 2 },
  passHint: { marginTop: 2, marginBottom: 8 },
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
