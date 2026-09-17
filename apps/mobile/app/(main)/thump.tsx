import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Share, StyleSheet, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AndroidCompactText as Text } from '@/components/ui/android-compact-typography';
import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import { fetchSharedBoxWithMeta, getCachedSharedBox } from '@/lib/friends-api';
import {
  courtAction, createCourtCase, fetchCourtCasePreview, fetchCourtLobby, fetchCourtSession, getCachedCourtLobby,
  submitCourtAnswers, type CourtAnswer, type CourtCaseSummary, type CourtCategory,
  type CourtLobby, type CourtQuestion, type CourtSession,
} from '@/lib/court-api';
import { subscribeCourtRealtime } from '@/lib/pairing-realtime';

const BG = require('../../assets/bunny-court/forest-court.webp');
const JUDGE = require('../../assets/bunny-court/judge-bunny.webp');
const JUDGE_WAITING = require('../../assets/bunny-court/judge-bunny2.webp');
const CHECK = require('../../assets/bunny-court/check.webp');
const AWAITING = require('../../assets/bunny-court/awaiting.webp');
const BROWN = '#4A2518';
const CREAM = '#FFF8E9';
const CORAL = '#F36B6B';
const YELLOW = '#FFBF12';

const CATEGORY_META: Record<CourtCategory, { icon: keyof typeof MaterialIcons.glyphMap; subtitle: string; color: string }> = {
  'Love Court': { icon: 'favorite', subtitle: 'For sweet, silly cases to test how well you two really click.', color: '#F58C84' },
  'Life Court': { icon: 'local-laundry-service', subtitle: 'For everyday choices, chores, and tiny debates.', color: '#F2B84B' },
  'Conflict Court': { icon: 'handshake', subtitle: 'For different needs, small conflicts, and fair compromises.', color: '#9DBB79' },
};

type Screen = 'home' | 'cases' | 'intro' | 'session' | 'verdict' | 'history';

function readableError(code: string): string {
  const copy: Record<string, string> = {
    active_case_exists: 'Finish or close the current case before filing another.',
    plus_required: 'This case is included with Burrow Plus.',
    relationship_not_eligible: 'Love Court is available for partner pairings.',
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

function CourtBackground({ align, children }: { align: 'top' | 'bottom'; children: ReactNode }) {
  return (
    <View style={styles.background}>
      <Image
        source={BG}
        contentFit="cover"
        contentPosition={align}
        transition={0}
        style={StyleSheet.absoluteFillObject}
      />
      {children}
    </View>
  );
}

export default function ThumpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [lobby, setLobby] = useState<CourtLobby | null>(() => getCachedCourtLobby());
  const [screen, setScreen] = useState<Screen>('home');
  const [category, setCategory] = useState<CourtCategory | null>(null);
  const [selectedCase, setSelectedCase] = useState<CourtCaseSummary | null>(null);
  const [session, setSession] = useState<CourtSession | null>(null);
  const [questions, setQuestions] = useState<CourtQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<CourtQuestion[]>([]);
  const [creatingCase, setCreatingCase] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [memoryOptions, setMemoryOptions] = useState<string[]>([]);

  const openSession = useCallback(async (sessionId: string, revealReady = false) => {
    const result = await fetchCourtSession(sessionId);
    if (!result.ok) return false;
    if (result.data.session.role === 'partner' && result.data.session.status === 'awaiting_initiator') return false;
    setSession(result.data.session);
    setQuestions(Array.isArray(result.data.questions) ? result.data.questions : []);
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

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [questionIndex, screen, session?.id, session?.status]);

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
    if (!session || (session.status !== 'processing' && !(session.status === 'awaiting_partner' && session.hasSubmitted))) return;
    const timer = setInterval(() => { void openSession(session.id); }, session.status === 'processing' ? 4000 : 8000);
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
        : 'Love Court is available for partner pairings.';
      appAlert('Case unavailable', message); return;
    }
    void haptics.light();
    setSelectedCase(item);
    setPreviewQuestions([]);
    setScreen('intro');
    void fetchCourtCasePreview(item.id).then((result) => {
      if (result.ok) setPreviewQuestions(result.data.questions);
    });
  };

  const fileCase = async () => {
    if (!selectedCase || creatingCase) return;
    void haptics.medium();
    setCreatingCase(true);
    setSession(null);
    setQuestions(previewQuestions);
    setQuestionIndex(0);
    setAnswers({});
    setScreen('session');
    const result = await createCourtCase(selectedCase.id);
    if (!result.ok) {
      setScreen('intro');
      setQuestions([]);
      appAlert('Could not file case', readableError(result.error));
    } else {
      setSession(result.data.session);
      const returnedQuestions = Array.isArray(result.data.questions) ? result.data.questions : [];
      const readyQuestions = returnedQuestions.length > 0 ? returnedQuestions : previewQuestions;
      setQuestions(readyQuestions);
      if (readyQuestions.length === 0) void openSession(result.data.session.id);
    }
    setCreatingCase(false);
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
    const previousSession = session;
    setSession({
      ...session,
      hasSubmitted: true,
      status: session.otherSubmitted ? 'processing' : 'awaiting_partner',
    });
    const result = await submitCourtAnswers(session.id, payload);
    if (!result.ok) {
      setSession(previousSession);
      appAlert('Could not seal testimony', readableError(result.error));
    } else {
      setSession(result.data);
    }
    setBusy(false);
  };

  const act = async (action: 'decline' | 'nudge' | 'complete') => {
    if (!session || busy) return;
    setBusy(true);
    const activeSession = session;
    if (action === 'complete') {
      setSession(null); setScreen('home'); setRevealed(false);
    }
    const result = await courtAction(activeSession.id, { action });
    if (!result.ok) appAlert('Bunny Court', readableError(result.error));
    if (action === 'complete' && result.ok) {
      await refreshLobby();
    } else if (action === 'complete') {
      await refreshLobby(true);
    } else if (action !== 'nudge') {
      await openSession(activeSession.id);
    }
    setBusy(false);
  };

  const revealVerdict = () => {
    if (!session?.verdict) return;
    const activeSession = session;
    // Viewing the finished verdict closes the case immediately, so it no
    // longer blocks either person from filing another one. Keep the verdict
    // visible locally while the idempotent close runs in the background.
    setSession({ ...session, status: 'completed' });
    setRevealed(true);
    setScreen('verdict');
    void courtAction(activeSession.id, { action: 'complete' }).then((result) => {
      if (!result.ok) {
        setSession(activeSession);
        appAlert('Bunny Court', readableError(result.error));
        return;
      }
      void refreshLobby();
    });
  };

  const runAgain = async () => {
    if (!session || busy) return;
    setBusy(true);
    const nextCategory = session.case?.category ?? category;
    const sessionId = session.id;
    setSession(null); setRevealed(false); setCategory(nextCategory); setScreen(nextCategory ? 'cases' : 'home');
    const result = await courtAction(sessionId, { action: 'complete' });
    if (!result.ok) appAlert('Bunny Court', readableError(result.error));
    if (result.ok) await refreshLobby();
    else await refreshLobby(true);
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

  const backgroundAlign = screen === 'home' || screen === 'intro' ? 'top' : 'bottom';

  return (
    <CourtBackground align={backgroundAlign}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={[styles.header, { top: insets.top }]}>
          {roundButton(back, screen === 'home' ? 'close' : 'arrow-back')}
          {screen === 'home' && (lobby?.history.length ?? 0) > 0
            && roundButton(() => setScreen('history'), 'history')}
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {screen === 'home' && <HomeView lobby={lobby} onCategory={chooseCategory} onPair={() => router.replace('/(main)/(tabs)/friends')} />}
            {screen === 'cases' && category && <CasesView category={category} cases={cases} onCase={chooseCase} />}
            {screen === 'intro' && selectedCase && <IntroView item={selectedCase} busy={busy} onFile={fileCase} />}
            {screen === 'history' && lobby && <HistoryView lobby={lobby} onOpen={(id) => void openSession(id, true)} />}
            {screen === 'session' && (session || creatingCase) && <SessionView
              session={session ?? undefined} question={question} questionIndex={questionIndex} total={questions.length}
              answer={currentAnswer} memoryOptions={memoryOptions} busy={busy} canContinue={Boolean(canContinue && (questionIndex < questions.length - 1 || session))}
              onAnswer={setAnswer} onNext={nextQuestion} onNudge={() => void act('nudge')}
              onDecline={() => void act('decline')} onReveal={revealVerdict}
              onClose={() => void closeTerminal()}
            />}
            {screen === 'verdict' && session?.verdict && revealed && <VerdictView
              session={session} busy={busy} onSave={() => void act('complete')}
              onShare={() => void Share.share({ message: session.verdict?.shareText || '' })}
              onRunAgain={() => void runAgain()}
            />}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </CourtBackground>
  );
}

function CourtHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={styles.heading}><Text style={styles.screenTitle}>{title}</Text>{subtitle && <Text style={styles.screenSubtitle}>{subtitle}</Text>}</View>;
}

function JudgeArt({ waiting = false, compact = false }: { waiting?: boolean; compact?: boolean }) {
  return <Image source={waiting ? JUDGE_WAITING : JUDGE} style={[styles.judge, compact && styles.judgeCompact]} contentFit="contain" transition={0} />;
}

function HomeView({ lobby, onCategory, onPair }: { lobby: CourtLobby | null; onCategory: (value: CourtCategory) => void; onPair: () => void }) {
  return (
    <>
      <CourtHeading title="BUNNY COURT" subtitle="Petty disputes. Adorable verdicts." />
      <JudgeArt />
      {!lobby ? <Paper><ActivityIndicator color={BROWN} /><Text style={styles.centerText}>Opening the court…</Text></Paper>
        : !lobby.paired ? <Paper><Text style={styles.paperTitle}>TWO PLAYERS REQUIRED</Text><Text style={styles.body}>Pair with your person before filing a case. Testimony stays sealed until both of you finish.</Text><PrimaryButton label="PAIR YOUR PERSON" onPress={onPair} /></Paper>
          : <View style={styles.categoryList}>
            {(Object.keys(CATEGORY_META) as CourtCategory[]).map((name) => {
              const meta = CATEGORY_META[name];
              const count = lobby.cases.filter((item) => item.category === name && !item.lockedReason).length;
              return <Pressable key={name} onPress={() => onCategory(name)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
                <View style={[styles.categoryIcon, { backgroundColor: meta.color }]}><MaterialIcons name={meta.icon} size={30} color={BROWN} /></View>
                <View style={styles.flex}><Text style={styles.categoryTitle}>{name}</Text><Text style={styles.categorySubtitle}>{meta.subtitle}</Text><Text style={styles.meta}>{count} available cases</Text></View>
                <MaterialIcons name="arrow-forward-ios" size={24} color={BROWN} />
              </Pressable>;
            })}
          </View>}
      <Text style={styles.footer}>Where every argument gets a fair (and furry) trial.</Text>
    </>
  );
}

function CasesView({ category, cases, onCase }: { category: CourtCategory; cases: CourtCaseSummary[]; onCase: (item: CourtCaseSummary) => void }) {
  return (
    <>
      <View style={styles.caseListHeader}><View style={styles.flex}><CourtHeading title={category} subtitle="Pick a case to settle together" /></View><JudgeArt compact /></View>
      {cases.map((item) => <Pressable key={item.id} onPress={() => onCase(item)} style={({ pressed }) => [styles.caseCard, pressed && styles.pressed, item.lockedReason && styles.locked]}>
        <View style={styles.flex}><View style={styles.badgeRow}><Text style={styles.caseId}>{item.id}</Text>{item.accessTier === 'plus' && <Text style={styles.plusBadge}>PLUS</Text>}</View><Text style={styles.caseTitle}>{item.title}</Text><Text style={styles.caseSubtitle}>{item.subtitle}</Text><Text style={styles.meta}>{item.questionCount} questions</Text></View>
        <MaterialIcons name={item.lockedReason ? 'lock' : 'arrow-forward'} size={26} color={BROWN} />
      </Pressable>)}
      {cases.length === 0 && <Paper><Text style={styles.body}>No cases are available in this court yet.</Text></Paper>}
    </>
  );
}

function IntroView({ item, busy, onFile }: { item: CourtCaseSummary; busy: boolean; onFile: () => void }) {
  return (
    <><JudgeArt /><Text style={styles.introTitle}>{item.title}</Text><Text style={styles.subtitle}>{item.subtitle}</Text>
      <Paper><Text style={styles.paperTitle}>HOW IT WORKS</Text>
        {['Answer separately. Your testimony stays sealed.', 'No peeking and no edits after sealing.', 'Bunny Judge reviews both sides and rules.'].map((text, index) => <View key={text} style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text style={styles.stepText}>{text}</Text></View>)}
        <View style={styles.ruleRow}><MaterialIcons name="schedule" size={22} color={BROWN} /><Text style={styles.meta}>About 1 minute</Text><MaterialIcons name="group" size={22} color={BROWN} /><Text style={styles.meta}>Both players</Text></View>
      </Paper><PrimaryButton label="FILE THIS CASE" onPress={onFile} disabled={busy} /><Text style={styles.footer}>Your person will receive an invitation after you seal.</Text></>
  );
}

function HistoryView({ lobby, onOpen }: { lobby: CourtLobby; onOpen: (id: string) => void }) {
  return <><CourtHeading title="COURT RECORDS" subtitle="Saved verdicts from your private court for two." /><JudgeArt compact />
    {lobby.history.length === 0 ? <Paper><Text style={styles.body}>No closed cases yet.</Text></Paper>
      : lobby.history.map((record) => {
        const item = lobby.cases.find((candidate) => candidate.id === record.case_id);
        return <Pressable key={record.id} onPress={() => onOpen(record.id)} style={({ pressed }) => [styles.caseCard, pressed && styles.pressed]}>
          <View style={styles.flex}><Text style={styles.caseId}>{record.case_id}</Text><Text style={styles.caseTitle}>{item?.title ?? record.case_id}</Text><Text style={styles.meta}>{new Date(record.completed_at || record.verdict_ready_at || record.created_at).toLocaleDateString()}</Text></View><MaterialIcons name="chevron-right" size={30} color={BROWN} />
        </Pressable>;
      })}</>;
}

function SessionView(props: { session?: CourtSession; question?: CourtQuestion; questionIndex: number; total: number; answer?: string | string[]; memoryOptions: string[]; busy: boolean; canContinue: boolean; onAnswer: (value: string | string[]) => void; onNext: () => void; onNudge: () => void; onDecline: () => void; onReveal: () => void; onClose: () => void }) {
  const { session, question, questionIndex, total, answer, memoryOptions, busy, canContinue } = props;
  if (session?.verdict) return <><CourtHeading title="THE VERDICT IS READY" /><JudgeArt /><Paper><Text style={styles.readyTitle}>Both testimonies received</Text><Text style={styles.body}>The bunny has reviewed the evidence and finished the final verdict. There is no emotionally responsible way back.</Text><PrimaryButton label="CHECK THE RESULT" onPress={props.onReveal} /></Paper></>;
  if (session && ['declined', 'expired', 'cancelled'].includes(session.status)) {
    const copy = session.status === 'expired' ? 'This case expired after seven days.'
      : session.status === 'declined' ? 'This case was respectfully declined.'
        : 'This case closed when the pairing changed.';
    return <><CourtHeading title="CASE CLOSED" /><JudgeArt /><Paper><Text style={styles.body}>{copy}</Text><PrimaryButton label="BACK TO COURT" onPress={props.onClose} /></Paper></>;
  }
  if (session?.status === 'processing') {
    return <><CourtHeading title="THE BUNNY IS ANALYZING" /><JudgeArt /><Paper><Text style={styles.readyTitle}>Both testimonies received</Text><Text style={styles.body}>The judge is reviewing both sides and preparing the verdict.</Text><AnalyzingBar /><PrimaryButton label="LEAVE COURT" onPress={props.onClose} tone="yellow" /></Paper></>;
  }
  if (session?.hasSubmitted) {
    return <><CourtHeading title="TESTIMONY SEALED" /><JudgeArt waiting /><Paper><Text style={styles.readyTitle}>Now we wait for the other side</Text><View style={styles.statusGrid}><StatusSide label="YOU" done /><StatusSide label="YOUR PERSON" done={session.otherSubmitted} /></View><Text style={styles.body}>No peeking. No edits. The court has standards.</Text>{session.role === 'initiator' && !session.otherSubmitted && <PrimaryButton label="NUDGE THEM" onPress={props.onNudge} disabled={busy} />}<PrimaryButton label="LEAVE NOW" onPress={props.onClose} disabled={busy} tone="yellow" /></Paper><Text style={styles.footer}>We’ll let you know when the verdict is ready.</Text></>;
  }
  if (!question) return <Paper><ActivityIndicator color={BROWN} /><Text style={styles.centerText}>Loading testimony…</Text></Paper>;
  return <><View style={styles.questionJudge}><JudgeArt compact /></View><Paper><View style={styles.questionTopRow}><Text style={styles.questionCount}>{questionIndex + 1}/{total} questions</Text><Pressable hitSlop={12} disabled={!canContinue || busy} onPress={props.onNext} style={({ pressed }) => [(!canContinue || busy) && styles.disabled, pressed && styles.pressed]}><MaterialIcons name="arrow-forward" size={52} color={BROWN} /></Pressable></View><Text style={styles.courtInstruction}>Answer honestly, the court can smell fake chill.</Text><View style={styles.questionDivider} /><Text style={styles.question}>{question.prompt}</Text><AnswerInput question={question} answer={answer} memoryOptions={memoryOptions} onAnswer={props.onAnswer} /></Paper>{session?.role === 'partner' && <Pressable onPress={props.onDecline}><Text style={styles.decline}>Decline this case</Text></Pressable>}</>;
}

function AnalyzingBar() {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(progress, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [progress]);
  return <View accessibilityLabel="The judge is analyzing" style={styles.analysisTrack}><Animated.View style={[styles.analysisFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['18%', '94%'] }) }]} /></View>;
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
  return <Paper><Text style={styles.verdictHeadline}>{verdict.headline}</Text><Text style={styles.body}>{verdict.whatCourtHeard}</Text><Text style={styles.body}>{verdict.verdict}</Text><View style={styles.order}><MaterialIcons name="gavel" size={38} color={BROWN} /><View style={styles.flex}><Text style={styles.orderTitle}>COURT ORDERED MOVE</Text><Text style={styles.body}>{verdict.courtOrderedMove}</Text></View></View><PrimaryButton label="SHARE VERDICT" onPress={onShare} disabled={busy} /><PrimaryButton label="DONE" onPress={onSave} disabled={busy} tone="yellow" /><Pressable onPress={onRunAgain} disabled={busy} style={styles.secondaryButton}><MaterialIcons name="replay" size={20} color={BROWN} /><Text style={styles.secondaryText}>RUN IT BACK</Text></Pressable></Paper>;
}

function StatusSide({ label, done }: { label: string; done: boolean }) { return <View style={styles.statusSide}><Image source={done ? CHECK : AWAITING} style={styles.statusIcon} contentFit="contain" transition={0} /><Text style={styles.statusLabel}>{label}</Text><Text style={styles.statusMeta}>{done ? 'Testimony received' : 'Waiting for answers'}</Text></View>; }
function Paper({ children }: { children: ReactNode }) { return <View style={styles.paper}>{children}</View>; }
function PrimaryButton({ label, onPress, disabled, tone = 'coral' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'coral' | 'yellow' }) { return <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, tone === 'yellow' && styles.yellowButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.primaryText, tone === 'yellow' && styles.yellowButtonText]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  background: { flex: 1, backgroundColor: '#AEB83F' },
  safe: { flex: 1 },
  header: { position: 'absolute', left: 0, right: 0, top: 0, height: 66, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 3 },
  roundButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,248,233,0.96)', borderWidth: 2, borderColor: BROWN, alignItems: 'center', justifyContent: 'center', shadowColor: BROWN, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.24, shadowRadius: 0, elevation: 3 },
  scroll: { paddingTop: 76, paddingHorizontal: 22, paddingBottom: 44, gap: 16 },
  heading: { alignItems: 'center', gap: 5 },
  screenTitle: { color: '#FFFFFF', fontSize: 38, lineHeight: 44, fontFamily: 'Inter_900Black', textAlign: 'center', textShadowColor: 'rgba(55,52,20,0.8)', textShadowOffset: { width: 3, height: 5 }, textShadowRadius: 0 },
  screenSubtitle: { color: '#FFFFFF', fontSize: 17, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', textAlign: 'center', textShadowColor: 'rgba(55,52,20,0.8)', textShadowOffset: { width: 2, height: 3 }, textShadowRadius: 0 },
  judge: { width: '65.6%', maxWidth: 328, aspectRatio: 1, alignSelf: 'center', marginTop: -8, marginBottom: -18 },
  judgeCompact: { width: 120, height: 120, marginTop: -22, marginBottom: -22 },
  paper: { backgroundColor: 'rgba(255,250,240,0.98)', borderRadius: 24, padding: 22, gap: 18, shadowColor: '#16100C', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.95, shadowRadius: 0, elevation: 7 },
  paperTitle: { color: BROWN, fontSize: 22, lineHeight: 28, fontFamily: 'Inter_900Black', textAlign: 'center' },
  body: { color: '#16100C', fontSize: 17, lineHeight: 25, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  bodySmall: { color: BROWN, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_500Medium' },
  centerText: { color: BROWN, textAlign: 'center' },
  categoryList: { gap: 14 },
  categoryCard: { minHeight: 100, backgroundColor: CREAM, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 14, shadowColor: BROWN, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.8, shadowRadius: 0, elevation: 5 },
  categoryIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  categoryTitle: { color: '#16100C', fontSize: 19, lineHeight: 24, fontFamily: 'Inter_900Black' },
  categorySubtitle: { color: '#16100C', fontSize: 14, lineHeight: 19, fontFamily: 'Inter_600SemiBold' },
  meta: { color: '#755746', fontSize: 12, lineHeight: 16, fontFamily: 'Inter_600SemiBold' },
  footer: { color: BROWN, textAlign: 'center', fontSize: 12, lineHeight: 17, fontFamily: 'Inter_700Bold', marginVertical: 5 },
  caseListHeader: { minHeight: 150, flexDirection: 'row', alignItems: 'center' },
  caseCard: { minHeight: 112, backgroundColor: CREAM, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: BROWN, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.85, shadowRadius: 0, elevation: 5 },
  caseId: { color: CORAL, fontSize: 12, lineHeight: 16, fontFamily: 'Inter_900Black' },
  caseTitle: { color: BROWN, fontSize: 20, lineHeight: 25, fontFamily: 'Inter_900Black' },
  caseSubtitle: { color: BROWN, fontSize: 14, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  badgeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  plusBadge: { backgroundColor: '#F4C34F', color: BROWN, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, lineHeight: 14, fontFamily: 'Inter_900Black' },
  locked: { opacity: 0.62 },
  introTitle: { color: '#FFFFFF', fontSize: 34, lineHeight: 40, fontFamily: 'Inter_900Black', textAlign: 'center', textShadowColor: 'rgba(55,52,20,0.8)', textShadowOffset: { width: 3, height: 5 }, textShadowRadius: 0 },
  subtitle: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontFamily: 'Inter_700Bold', textAlign: 'center', textShadowColor: 'rgba(55,52,20,0.8)', textShadowOffset: { width: 2, height: 3 }, textShadowRadius: 0 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F5A19B', alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: BROWN, fontSize: 19, lineHeight: 24, fontFamily: 'Inter_900Black' },
  stepText: { flex: 1, color: BROWN, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_700Bold' },
  ruleRow: { borderTopWidth: 1, borderTopColor: '#DCC9A8', paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButton: { minHeight: 64, borderRadius: 32, backgroundColor: '#FA887F', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, shadowColor: '#A48470', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.75, shadowRadius: 0, elevation: 5 },
  yellowButton: { backgroundColor: YELLOW },
  primaryText: { color: '#FFFFFF', fontSize: 20, lineHeight: 25, fontFamily: 'Inter_900Black', textAlign: 'center' },
  yellowButtonText: { color: '#16100C' },
  readyTitle: { color: '#16100C', fontSize: 25, lineHeight: 31, fontFamily: 'Inter_900Black', textAlign: 'center' },
  analysisTrack: { height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: '#E7D9BE' },
  analysisFill: { height: '100%', borderRadius: 7, backgroundColor: '#FA887F' },
  questionJudge: { marginBottom: -26, zIndex: 1 },
  questionTopRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  questionCount: { color: '#16100C', fontSize: 18, lineHeight: 23, fontFamily: 'Inter_500Medium' },
  courtInstruction: { color: '#16100C', fontSize: 15, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  questionDivider: { height: 4, backgroundColor: '#16100C' },
  question: { color: '#16100C', fontSize: 23, lineHeight: 30, fontFamily: 'Inter_900Black', textAlign: 'left' },
  options: { gap: 13 },
  option: { minHeight: 62, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 18, backgroundColor: YELLOW, alignItems: 'center', justifyContent: 'center' },
  optionActive: { backgroundColor: '#FA887F' },
  optionText: { color: '#16100C', fontSize: 17, lineHeight: 23, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  optionTextActive: { fontFamily: 'Inter_900Black' },
  textInput: { minHeight: 132, maxHeight: 220, borderWidth: 2, borderColor: BROWN, borderRadius: 18, padding: 14, color: BROWN, backgroundColor: '#FFFDF7', fontSize: 16, lineHeight: 23, textAlignVertical: 'top' },
  decline: { color: BROWN, textAlign: 'center', textDecorationLine: 'underline', fontFamily: 'Inter_700Bold' },
  memoryHint: { color: '#755746', fontSize: 10, lineHeight: 14, fontFamily: 'Inter_800ExtraBold', letterSpacing: 1, textAlign: 'center' },
  memoryOption: { minHeight: 56, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, backgroundColor: '#FFE39A', justifyContent: 'center' },
  memoryOptionText: { color: BROWN, fontSize: 13, lineHeight: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  statusGrid: { flexDirection: 'row', gap: 18 },
  statusSide: { flex: 1, minHeight: 166, borderRadius: 24, backgroundColor: '#93613F', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 10 },
  statusIcon: { width: 76, height: 76 },
  statusLabel: { color: '#FFFFFF', fontSize: 19, lineHeight: 24, fontFamily: 'Inter_900Black', textAlign: 'center' },
  statusMeta: { color: '#FFFFFF', fontSize: 11, lineHeight: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  verdictHeadline: { color: '#16100C', fontSize: 30, lineHeight: 37, fontFamily: 'Inter_900Black', textAlign: 'center' },
  order: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 22, padding: 18, backgroundColor: '#F7C38E' },
  orderTitle: { color: '#16100C', fontSize: 17, lineHeight: 22, fontFamily: 'Inter_900Black', textAlign: 'center' },
  secondaryButton: { minHeight: 50, borderRadius: 25, borderWidth: 2, borderColor: BROWN, backgroundColor: CREAM, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { color: BROWN, fontFamily: 'Inter_800ExtraBold' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,248,233,0.34)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
  disabled: { opacity: 0.5 },
});
