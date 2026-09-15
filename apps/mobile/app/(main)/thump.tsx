import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, ImageBackground, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Share, StyleSheet, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AndroidCompactText as Text } from '@/components/ui/android-compact-typography';
import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import { fetchSharedBoxWithMeta, getCachedSharedBox } from '@/lib/friends-api';
import {
  courtAction, createCourtCase, fetchCourtLobby, fetchCourtSession, getCachedCourtLobby,
  submitCourtAnswers, type CourtAnswer, type CourtCaseSummary, type CourtCategory,
  type CourtLobby, type CourtQuestion, type CourtSession,
} from '@/lib/court-api';
import { subscribeCourtRealtime } from '@/lib/pairing-realtime';

const BG = require('../../assets/bunny-court/forest-court.webp');
const JUDGE = require('../../assets/bunny-court/judge-bunny.webp');
const BROWN = '#4A2518';
const CREAM = '#FFF8E9';
const CORAL = '#F36B6B';

const CATEGORY_META: Record<CourtCategory, { icon: keyof typeof MaterialIcons.glyphMap; subtitle: string; color: string }> = {
  'Love Court': { icon: 'favorite', subtitle: 'Sweet, silly, romantic evidence.', color: '#F58C84' },
  'Closeness Court': { icon: 'forum', subtitle: 'How well do you know each other?', color: '#79C5BC' },
  'Life Court': { icon: 'local-laundry-service', subtitle: 'Chores, choices, and tiny debates.', color: '#F2B84B' },
  'Meet in the Middle': { icon: 'handshake', subtitle: 'Small conflicts and fair compromises.', color: '#9DBB79' },
};

type Screen = 'home' | 'cases' | 'intro' | 'session' | 'verdict' | 'history';

function readableError(code: string): string {
  const copy: Record<string, string> = {
    active_case_exists: 'Finish or close the current case before filing another.',
    plus_required: 'This case is included with Burrow Plus.',
    ai_consent_required: 'Open Journal once and accept the AI consent before filing a Plus case.',
    relationship_not_eligible: 'Love Court is available for partner pairings.',
    cooldown: 'This case is resting before it can return to court.',
    already_nudged_today: 'The court already sent a nudge today.',
    network: 'The court could not connect. Please try again.',
  };
  return copy[code] || 'The court could not complete that request. Please try again.';
}

function roundButton(onPress: () => void, icon: keyof typeof MaterialIcons.glyphMap) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={28} color={BROWN} />
    </Pressable>
  );
}

export default function ThumpScreen() {
  const router = useRouter();
  const [lobby, setLobby] = useState<CourtLobby | null>(() => getCachedCourtLobby());
  const [screen, setScreen] = useState<Screen>('home');
  const [category, setCategory] = useState<CourtCategory | null>(null);
  const [selectedCase, setSelectedCase] = useState<CourtCaseSummary | null>(null);
  const [session, setSession] = useState<CourtSession | null>(null);
  const [questions, setQuestions] = useState<CourtQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [memoryOptions, setMemoryOptions] = useState<string[]>([]);

  const openSession = useCallback(async (sessionId: string, revealReady = false) => {
    const result = await fetchCourtSession(sessionId);
    if (!result.ok) return false;
    setSession(result.data.session);
    setQuestions(result.data.questions);
    setQuestionIndex(0);
    setAnswers({});
    if (result.data.session.verdict && revealReady) {
      setRevealed(true);
      setScreen('verdict');
    } else {
      setRevealed(false);
      setScreen('session');
    }
    return true;
  }, []);

  const refreshLobby = useCallback(async (openActive = false) => {
    const result = await fetchCourtLobby();
    if (!result.ok) return;
    setLobby(result.data);
    if (openActive && result.data.active) await openSession(result.data.active.id);
  }, [openSession]);

  const cases = useMemo(() => lobby?.cases.filter((item) => item.category === category) ?? [], [lobby?.cases, category]);
  const question = questions[questionIndex];
  const currentAnswer = question ? answers[question.number] : undefined;
  const canContinue = question && (!question.required || (Array.isArray(currentAnswer) ? currentAnswer.length > 0 : Boolean(currentAnswer)));

  useFocusEffect(useCallback(() => {
    let active = true;
    void fetchCourtLobby().then((result) => {
      if (!active || !result.ok) return;
      setLobby(result.data);
      if (result.data.active) void openSession(result.data.active.id);
    });
    return () => { active = false; };
  }, [openSession]));

  useEffect(() => subscribeCourtRealtime((sessionId) => {
    if (session?.id && (!sessionId || session.id === sessionId)) void openSession(session.id);
    else void refreshLobby(true);
  }), [openSession, refreshLobby, session?.id]);

  useEffect(() => {
    if (!session || !['awaiting_partner', 'processing'].includes(session.status)) return;
    const timer = setInterval(() => { void openSession(session.id); }, 8000);
    return () => clearInterval(timer);
  }, [openSession, session?.id, session?.status]);

  useEffect(() => {
    if (question?.responseType !== 'Memory picker' || !lobby?.partnerUserId) {
      setMemoryOptions([]);
      return;
    }
    let active = true;
    const descriptions = (items: ReturnType<typeof getCachedSharedBox>['items']) => [...new Set(
      items.map((item) => item.description.trim()).filter(Boolean),
    )].slice(0, 6);
    setMemoryOptions(descriptions(getCachedSharedBox(lobby.partnerUserId).items));
    void fetchSharedBoxWithMeta(lobby.partnerUserId).then((result) => {
      if (active) setMemoryOptions(descriptions(result.items));
    }).catch(() => { /* The typed fallback remains available offline. */ });
    return () => { active = false; };
  }, [lobby?.partnerUserId, question?.number, question?.responseType]);

  const chooseCategory = (value: CourtCategory) => {
    void haptics.light(); setCategory(value); setScreen('cases');
  };

  const chooseCase = (item: CourtCaseSummary) => {
    if (item.lockedReason) {
      const message = item.lockedReason === 'plus' ? 'This case is included with Burrow Plus.'
        : item.lockedReason === 'relationship' ? 'Love Court is available for partner pairings.'
          : `This case returns ${item.availableAt ? new Date(item.availableAt).toLocaleDateString() : 'soon'}.`;
      appAlert('Case unavailable', message); return;
    }
    void haptics.light(); setSelectedCase(item); setScreen('intro');
  };

  const fileCase = async () => {
    if (!selectedCase || busy) return;
    setBusy(true); void haptics.medium();
    const result = await createCourtCase(selectedCase.id);
    if (!result.ok) appAlert('Could not file case', readableError(result.error));
    else await openSession(result.data.id);
    setBusy(false);
  };

  const setAnswer = (value: string | string[]) => {
    if (!question) return;
    setAnswers((previous) => ({ ...previous, [question.number]: value }));
  };

  const nextQuestion = async () => {
    if (!question || !canContinue || busy) return;
    void haptics.light();
    if (questionIndex < questions.length - 1) { setQuestionIndex((value) => value + 1); return; }
    if (!session) return;
    setBusy(true);
    const payload: CourtAnswer[] = questions.map((item) => ({ questionNumber: item.number, value: answers[item.number] }));
    const result = await submitCourtAnswers(session.id, payload);
    if (!result.ok) appAlert('Could not seal testimony', readableError(result.error));
    await openSession(session.id);
    setBusy(false);
  };

  const act = async (action: 'decline' | 'nudge' | 'complete') => {
    if (!session || busy) return;
    setBusy(true);
    const result = await courtAction(session.id, { action });
    if (!result.ok) appAlert('Bunny Court', readableError(result.error));
    if (action === 'complete' && result.ok) {
      setSession(null); setScreen('home'); setRevealed(false); await refreshLobby();
    } else if (action !== 'nudge') {
      await openSession(session.id);
    }
    setBusy(false);
  };

  const runAgain = async () => {
    if (!session || busy) return;
    setBusy(true);
    const nextCategory = session.case?.category ?? category;
    const result = await courtAction(session.id, { action: 'complete' });
    if (!result.ok) appAlert('Bunny Court', readableError(result.error));
    else {
      setSession(null); setRevealed(false); setCategory(nextCategory); setScreen(nextCategory ? 'cases' : 'home');
      await refreshLobby();
    }
    setBusy(false);
  };

  const closeTerminal = async () => {
    setSession(null); setRevealed(false); setScreen('home'); await refreshLobby();
  };

  const back = () => {
    if (screen === 'home') { router.back(); return; }
    if (screen === 'history') { setScreen('home'); return; }
    if (screen === 'cases') { setScreen('home'); setCategory(null); return; }
    if (screen === 'intro') { setScreen('cases'); return; }
    if (screen === 'verdict') { setScreen('session'); setRevealed(false); return; }
    router.back();
  };

  return (
    <ImageBackground source={BG} resizeMode="cover" style={styles.background}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          {roundButton(back, screen === 'home' ? 'close' : 'arrow-back')}
          {screen === 'home' && (lobby?.history.length ?? 0) > 0
            && roundButton(() => setScreen('history'), 'history')}
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {screen === 'home' && <HomeView lobby={lobby} onCategory={chooseCategory} onPair={() => router.replace('/(main)/(tabs)/friends')} />}
            {screen === 'cases' && category && <CasesView category={category} cases={cases} onCase={chooseCase} />}
            {screen === 'intro' && selectedCase && <IntroView item={selectedCase} busy={busy} onFile={fileCase} />}
            {screen === 'history' && lobby && <HistoryView lobby={lobby} onOpen={(id) => void openSession(id, true)} />}
            {screen === 'session' && session && <SessionView
              session={session} question={question} questionIndex={questionIndex} total={questions.length}
              answer={currentAnswer} memoryOptions={memoryOptions} busy={busy} canContinue={Boolean(canContinue)}
              onAnswer={setAnswer} onNext={nextQuestion} onNudge={() => void act('nudge')}
              onDecline={() => void act('decline')} onReveal={() => { setRevealed(true); setScreen('verdict'); }}
              onClose={() => void closeTerminal()}
            />}
            {screen === 'verdict' && session?.verdict && revealed && <VerdictView
              session={session} busy={busy} onSave={() => void act('complete')}
              onShare={() => void Share.share({ message: session.verdict?.shareText || '' })}
              onRunAgain={() => void runAgain()}
            />}
          </ScrollView>
        </KeyboardAvoidingView>
        {busy && <View pointerEvents="none" style={styles.busy}><ActivityIndicator color={BROWN} size="large" /></View>}
      </SafeAreaView>
    </ImageBackground>
  );
}

function Hero({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.hero, compact && styles.heroCompact]}>
      <Text style={styles.eyebrow}>THE HONORABLE</Text>
      <Text style={styles.logo}>BUNNY COURT</Text>
      <Text style={styles.tagline}>File a case. Get a verdict.</Text>
      <Image source={JUDGE} style={[styles.judge, compact && styles.judgeCompact]} contentFit="contain" />
    </View>
  );
}

function HomeView({ lobby, onCategory, onPair }: { lobby: CourtLobby | null; onCategory: (value: CourtCategory) => void; onPair: () => void }) {
  return (
    <>
      <Hero />
      {!lobby ? <Paper><ActivityIndicator color={BROWN} /><Text style={styles.centerText}>Opening the court…</Text></Paper>
        : !lobby.paired ? <Paper><Text style={styles.paperTitle}>TWO PLAYERS REQUIRED</Text><Text style={styles.body}>Pair with your person before filing a case. Testimony stays sealed until both of you finish.</Text><PrimaryButton label="PAIR YOUR PERSON" onPress={onPair} /></Paper>
          : <View style={styles.categoryList}>
            {(Object.keys(CATEGORY_META) as CourtCategory[]).map((name) => {
              const meta = CATEGORY_META[name];
              const count = lobby.cases.filter((item) => item.category === name && !item.lockedReason).length;
              return <Pressable key={name} onPress={() => onCategory(name)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
                <View style={[styles.categoryIcon, { backgroundColor: meta.color }]}><MaterialIcons name={meta.icon} size={30} color={BROWN} /></View>
                <View style={styles.flex}><Text style={styles.categoryTitle}>{name.toUpperCase()}</Text><Text style={styles.categorySubtitle}>{meta.subtitle}</Text><Text style={styles.meta}>{count} available cases</Text></View>
                <MaterialIcons name="chevron-right" size={34} color={BROWN} />
              </Pressable>;
            })}
          </View>}
      <Text style={styles.footer}>The bunny is legally unserious.</Text>
    </>
  );
}

function CasesView({ category, cases, onCase }: { category: CourtCategory; cases: CourtCaseSummary[]; onCase: (item: CourtCaseSummary) => void }) {
  const meta = CATEGORY_META[category];
  return (
    <>
      <Hero compact />
      <Paper><View style={styles.sectionHeading}><View style={[styles.categoryIcon, { backgroundColor: meta.color }]}><MaterialIcons name={meta.icon} size={28} color={BROWN} /></View><View style={styles.flex}><Text style={styles.paperTitle}>{category.toUpperCase()}</Text><Text style={styles.bodySmall}>{meta.subtitle}</Text></View></View></Paper>
      {cases.map((item) => <Pressable key={item.id} onPress={() => onCase(item)} style={({ pressed }) => [styles.caseCard, pressed && styles.pressed, item.lockedReason && styles.locked]}>
        <View style={styles.flex}><View style={styles.badgeRow}><Text style={styles.caseId}>{item.id}</Text>{item.accessTier === 'plus' && <Text style={styles.plusBadge}>PLUS</Text>}</View><Text style={styles.caseTitle}>{item.title}</Text><Text style={styles.caseSubtitle}>{item.subtitle}</Text><Text style={styles.meta}>{item.questionCount} questions · {item.repeatability}</Text></View>
        <MaterialIcons name={item.lockedReason ? 'lock' : 'arrow-forward'} size={26} color={BROWN} />
      </Pressable>)}
    </>
  );
}

function IntroView({ item, busy, onFile }: { item: CourtCaseSummary; busy: boolean; onFile: () => void }) {
  return (
    <><Hero compact /><Text style={styles.caseNumber}>CASE {item.id}</Text><Text style={styles.bigTitle}>{item.title}</Text><Text style={styles.subtitle}>{item.subtitle}</Text>
      <Paper><Text style={styles.paperTitle}>HOW IT WORKS</Text>
        {['Answer separately. Your testimony stays sealed.', 'No peeking and no edits after sealing.', 'Bunny Judge reviews both sides and rules.'].map((text, index) => <View key={text} style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text style={styles.stepText}>{text}</Text></View>)}
        <View style={styles.ruleRow}><MaterialIcons name="schedule" size={22} color={BROWN} /><Text style={styles.meta}>About 1 minute</Text><MaterialIcons name="group" size={22} color={BROWN} /><Text style={styles.meta}>Both players</Text></View>
      </Paper><PrimaryButton label="FILE THIS CASE" onPress={onFile} disabled={busy} /><Text style={styles.footer}>Your person will receive an invitation after you seal.</Text></>
  );
}

function HistoryView({ lobby, onOpen }: { lobby: CourtLobby; onOpen: (id: string) => void }) {
  return <><Hero compact /><Text style={styles.bigTitle}>COURT RECORDS</Text><Text style={styles.subtitle}>Saved verdicts from your private court for two.</Text>
    {lobby.history.length === 0 ? <Paper><Text style={styles.body}>No closed cases yet.</Text></Paper>
      : lobby.history.map((record) => {
        const item = lobby.cases.find((candidate) => candidate.id === record.case_id);
        return <Pressable key={record.id} onPress={() => onOpen(record.id)} style={({ pressed }) => [styles.caseCard, pressed && styles.pressed]}>
          <View style={styles.flex}><Text style={styles.caseId}>{record.case_id}</Text><Text style={styles.caseTitle}>{item?.title ?? record.case_id}</Text><Text style={styles.meta}>{new Date(record.completed_at || record.verdict_ready_at || record.created_at).toLocaleDateString()}</Text></View><MaterialIcons name="chevron-right" size={30} color={BROWN} />
        </Pressable>;
      })}</>;
}

function SessionView(props: { session: CourtSession; question?: CourtQuestion; questionIndex: number; total: number; answer?: string | string[]; memoryOptions: string[]; busy: boolean; canContinue: boolean; onAnswer: (value: string | string[]) => void; onNext: () => void; onNudge: () => void; onDecline: () => void; onReveal: () => void; onClose: () => void }) {
  const { session, question, questionIndex, total, answer, memoryOptions, busy, canContinue } = props;
  if (session.verdict) return <><Hero compact /><Text style={styles.bigTitle}>THE VERDICT IS READY</Text><Paper><Text style={styles.paperTitle}>BOTH TESTIMONIES RECEIVED</Text><Text style={styles.body}>The bunny has reviewed the evidence. There is no emotionally responsible way back.</Text></Paper><PrimaryButton label="HEAR THE VERDICT" onPress={props.onReveal} /></>;
  if (['declined', 'expired', 'cancelled'].includes(session.status)) {
    const copy = session.status === 'expired' ? 'This case expired after seven days.'
      : session.status === 'declined' ? 'This case was respectfully declined.'
        : 'This case closed when the pairing changed.';
    return <><Hero compact /><Text style={styles.bigTitle}>CASE CLOSED</Text><Paper><Text style={styles.body}>{copy}</Text></Paper><PrimaryButton label="BACK TO COURT" onPress={props.onClose} /></>;
  }
  if (session.hasSubmitted || session.status === 'processing') {
    return <><Hero /><Text style={styles.bigTitle}>{session.status === 'processing' ? 'THE BUNNY IS REVIEWING' : 'TESTIMONY SEALED'}</Text><Paper><View style={styles.statusGrid}><StatusSide label="YOU" done /><StatusSide label="YOUR PERSON" done={session.otherSubmitted} /></View><Text style={styles.body}>{session.status === 'processing' ? 'Both sides are in. The verdict is being prepared.' : 'No peeking. No edits. The court has standards.'}</Text></Paper>{session.role === 'initiator' && !session.otherSubmitted && <PrimaryButton label="NUDGE THEM" onPress={props.onNudge} disabled={busy} />}<Text style={styles.footer}>We’ll let you know when the verdict is ready.</Text></>;
  }
  if (!question) return <Paper><ActivityIndicator color={BROWN} /><Text style={styles.centerText}>Loading testimony…</Text></Paper>;
  const progress = total ? ((questionIndex + 1) / total) * 100 : 0;
  return <><Hero compact /><Text style={styles.caseNumber}>{session.case?.title}</Text><Text style={styles.questionCount}>QUESTION {questionIndex + 1} OF {total}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View><Paper><Text style={styles.question}>{question.prompt}</Text><AnswerInput question={question} answer={answer} memoryOptions={memoryOptions} onAnswer={props.onAnswer} /></Paper><PrimaryButton label={questionIndex === total - 1 ? 'SEAL MY TESTIMONY' : 'NEXT QUESTION'} onPress={props.onNext} disabled={!canContinue || busy} />{session.role === 'partner' && <Pressable onPress={props.onDecline}><Text style={styles.decline}>Decline this case</Text></Pressable>}</>;
}

function AnswerInput({ question, answer, memoryOptions, onAnswer }: { question: CourtQuestion; answer?: string | string[]; memoryOptions: string[]; onAnswer: (value: string | string[]) => void }) {
  if (question.responseType === 'Short text' || question.responseType === 'Memory picker') return <View style={styles.options}>
    {question.responseType === 'Memory picker' && memoryOptions.length > 0 && <>
      <Text style={styles.memoryHint}>CHOOSE A SHARED MEMORY</Text>
      {memoryOptions.map((memory) => <Pressable key={memory} onPress={() => onAnswer(memory)} style={({ pressed }) => [styles.memoryOption, answer === memory && styles.optionActive, pressed && styles.pressed]}>
        <Text numberOfLines={3} style={[styles.memoryOptionText, answer === memory && styles.optionTextActive]}>{memory}</Text>
      </Pressable>)}
      <Text style={styles.memoryHint}>OR TYPE ONE</Text>
    </>}
    <TextInput value={typeof answer === 'string' ? answer : ''} onChangeText={onAnswer} maxLength={600} multiline placeholder={question.responseType === 'Memory picker' ? 'Describe another shared moment…' : 'Add your private testimony…'} placeholderTextColor="#8D7568" style={styles.textInput} />
  </View>;
  const selected = Array.isArray(answer) ? answer : [];
  return <View style={styles.options}>{question.options.map((option) => {
    const active = Array.isArray(answer) ? selected.includes(option.value) : answer === option.value;
    return <Pressable key={option.value} onPress={() => {
      if (question.responseType === 'Multi select') onAnswer(active ? selected.filter((value) => value !== option.value) : [...selected, option.value]);
      else onAnswer(option.value);
    }} style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}><Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text></Pressable>;
  })}</View>;
}

function VerdictView({ session, busy, onSave, onShare, onRunAgain }: { session: CourtSession; busy: boolean; onSave: () => void; onShare: () => void; onRunAgain: () => void }) {
  const verdict = session.verdict!;
  return <><Hero compact /><Text style={styles.caseNumber}>CASE CLOSED</Text><Text style={styles.bigTitle}>{verdict.headline}</Text><Paper><Text style={styles.paperTitle}>WHAT THE COURT HEARD</Text><Text style={styles.body}>{verdict.whatCourtHeard}</Text><View style={styles.divider} /><Text style={styles.paperTitle}>FINAL VERDICT</Text><Text style={styles.body}>{verdict.verdict}</Text><View style={styles.order}><MaterialIcons name="gavel" size={38} color={BROWN} /><View style={styles.flex}><Text style={styles.orderTitle}>COURT-ORDERED MOVE</Text><Text style={styles.bodySmall}>{verdict.courtOrderedMove}</Text></View></View></Paper><PrimaryButton label="SAVE THIS VERDICT" onPress={onSave} disabled={busy} /><Pressable onPress={onRunAgain} disabled={busy} style={styles.secondaryButton}><MaterialIcons name="replay" size={20} color={BROWN} /><Text style={styles.secondaryText}>RUN IT BACK</Text></Pressable><Pressable onPress={onShare} style={styles.secondaryButton}><MaterialIcons name="ios-share" size={20} color={BROWN} /><Text style={styles.secondaryText}>SHARE SAFE SUMMARY</Text></Pressable></>;
}

function StatusSide({ label, done }: { label: string; done: boolean }) { return <View style={styles.statusSide}><MaterialIcons name={done ? 'check-circle' : 'hourglass-top'} size={52} color={done ? '#79A765' : '#D69A52'} /><Text style={styles.categoryTitle}>{label}</Text><Text style={styles.meta}>{done ? 'Testimony received' : 'Waiting for answers'}</Text></View>; }
function Paper({ children }: { children: ReactNode }) { return <View style={styles.paper}>{children}</View>; }
function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, background: { flex: 1, backgroundColor: '#A9D9E9' }, safe: { flex: 1 },
  header: { height: 66, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 3 },
  roundButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: CREAM, borderWidth: 2, borderColor: BROWN, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 42, gap: 14 }, hero: { alignItems: 'center', marginTop: -8 }, heroCompact: { marginTop: -28 },
  eyebrow: { color: CORAL, fontSize: 12, lineHeight: 15, fontFamily: 'Inter_800ExtraBold', letterSpacing: 2 },
  logo: { color: BROWN, fontSize: 34, lineHeight: 41, fontFamily: 'Inter_900Black', textAlign: 'center' },
  tagline: { color: BROWN, fontSize: 15, lineHeight: 20, fontFamily: 'Inter_700Bold' },
  judge: { width: '92%', aspectRatio: 1.24, marginTop: -20, marginBottom: -24 }, judgeCompact: { width: '56%', marginTop: -22, marginBottom: -34 },
  paper: { backgroundColor: 'rgba(255,248,233,0.97)', borderWidth: 2, borderColor: BROWN, borderRadius: 24, padding: 18, gap: 13, shadowColor: BROWN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 4 },
  paperTitle: { color: BROWN, fontSize: 20, lineHeight: 25, fontFamily: 'Inter_900Black', textAlign: 'center' },
  body: { color: BROWN, fontSize: 16, lineHeight: 23, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  bodySmall: { color: BROWN, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_500Medium' }, centerText: { color: BROWN, textAlign: 'center' },
  categoryList: { gap: 12 }, categoryCard: { backgroundColor: CREAM, borderWidth: 2, borderColor: BROWN, borderRadius: 22, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  categoryIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  categoryTitle: { color: BROWN, fontSize: 17, lineHeight: 22, fontFamily: 'Inter_900Black' }, categorySubtitle: { color: BROWN, fontSize: 14, lineHeight: 19, fontFamily: 'Inter_600SemiBold' },
  meta: { color: '#755746', fontSize: 12, lineHeight: 16, fontFamily: 'Inter_600SemiBold' }, footer: { color: BROWN, textAlign: 'center', fontSize: 12, lineHeight: 17, fontFamily: 'Inter_700Bold', marginVertical: 4 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, caseCard: { backgroundColor: CREAM, borderWidth: 2, borderColor: BROWN, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  caseId: { color: CORAL, fontSize: 11, lineHeight: 15, fontFamily: 'Inter_800ExtraBold' }, caseTitle: { color: BROWN, fontSize: 19, lineHeight: 24, fontFamily: 'Inter_900Black' }, caseSubtitle: { color: BROWN, fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium' },
  badgeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, plusBadge: { backgroundColor: '#F4C34F', color: BROWN, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, lineHeight: 14, fontFamily: 'Inter_900Black' },
  locked: { opacity: 0.62 }, caseNumber: { color: CORAL, textAlign: 'center', fontSize: 14, lineHeight: 18, fontFamily: 'Inter_900Black', letterSpacing: 1 },
  bigTitle: { color: BROWN, fontSize: 29, lineHeight: 34, fontFamily: 'Inter_900Black', textAlign: 'center' }, subtitle: { color: BROWN, fontSize: 15, lineHeight: 21, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 }, stepNumber: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F5A19B', alignItems: 'center', justifyContent: 'center' }, stepNumberText: { color: BROWN, fontSize: 18, lineHeight: 23, fontFamily: 'Inter_900Black' }, stepText: { flex: 1, color: BROWN, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_700Bold' },
  ruleRow: { borderTopWidth: 1, borderTopColor: '#DCC9A8', paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButton: { minHeight: 62, borderRadius: 28, borderWidth: 2, borderColor: BROWN, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, shadowColor: BROWN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  primaryText: { color: '#FFFFFF', fontSize: 19, lineHeight: 24, fontFamily: 'Inter_900Black', textAlign: 'center' },
  questionCount: { color: BROWN, textAlign: 'center', fontSize: 12, lineHeight: 16, fontFamily: 'Inter_800ExtraBold' }, progress: { height: 10, borderRadius: 5, backgroundColor: '#F0D8B4', borderWidth: 1, borderColor: BROWN, overflow: 'hidden' }, progressFill: { height: '100%', backgroundColor: CORAL },
  question: { color: BROWN, fontSize: 21, lineHeight: 27, fontFamily: 'Inter_900Black', textAlign: 'center' }, options: { gap: 10 }, option: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 22, borderWidth: 2, borderColor: BROWN, alignItems: 'center', justifyContent: 'center' }, optionActive: { backgroundColor: '#F7A9A3', borderColor: '#D64949' }, optionText: { color: BROWN, fontSize: 15, lineHeight: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' }, optionTextActive: { fontFamily: 'Inter_900Black' },
  textInput: { minHeight: 120, maxHeight: 190, borderWidth: 2, borderColor: BROWN, borderRadius: 18, padding: 14, color: BROWN, backgroundColor: '#FFFDF7', fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }, decline: { color: BROWN, textAlign: 'center', textDecorationLine: 'underline', fontFamily: 'Inter_700Bold' },
  memoryHint: { color: '#755746', fontSize: 10, lineHeight: 14, fontFamily: 'Inter_800ExtraBold', letterSpacing: 1, textAlign: 'center' },
  memoryOption: { minHeight: 54, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, borderWidth: 1.5, borderColor: BROWN, backgroundColor: '#FFFDF7', justifyContent: 'center' },
  memoryOptionText: { color: BROWN, fontSize: 13, lineHeight: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  statusGrid: { flexDirection: 'row' }, statusSide: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 }, divider: { height: 1, backgroundColor: '#D6B98A' }, order: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 13, backgroundColor: '#FFD8CA' }, orderTitle: { color: BROWN, fontSize: 15, lineHeight: 19, fontFamily: 'Inter_900Black' },
  secondaryButton: { minHeight: 52, borderRadius: 24, borderWidth: 2, borderColor: BROWN, backgroundColor: CREAM, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, secondaryText: { color: BROWN, fontFamily: 'Inter_800ExtraBold' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,248,233,0.34)', alignItems: 'center', justifyContent: 'center', zIndex: 10 }, pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 }, disabled: { opacity: 0.5 },
});
