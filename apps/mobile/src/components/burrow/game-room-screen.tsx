import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gameOverview, gameSession, unlockGame, startGame, answerGame, notifyGame,
  type GameOverview, type GameSession, type GameSummary } from '@/lib/burrow-game-room-api';
import { gameRoomBackground, gameRoomHero, gameRoomIcons } from '@/lib/burrow-game-room-art';
import { refreshBurrow, useBurrow } from '@/lib/burrow-store';
import { requestNotificationPermission, syncRemoteNotificationRegistration } from '@/lib/notification-settings';
import { BURROW_GAME_RULE_ICONS } from '@/lib/burrow-ui-assets';

const ink = '#3C1D12';
const muted = '#80604F';
const cream = '#FFF9EF';
const orange = '#CD5932';
const labels = ['A', 'B', 'C', 'D'];

function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [st.button, secondary && st.secondaryButton, (pressed || disabled) && { opacity: .65 }]}>
    <Text style={[st.buttonText, secondary && st.secondaryText]}>{label}</Text>
  </Pressable>;
}

function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[st.panel, style]}>{children}</View>;
}

export function GameRoomScreen({ initialSessionId }: { initialSessionId?: string }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const listRef = useRef<ScrollView>(null);
  const sessionRequest = useRef(0);
  const tileWidth = Math.max(76, Math.floor((screenWidth - 36 - 3 * 9) / 4));
  const { data: burrow } = useBurrow();
  const [overview, setOverview] = useState<GameOverview | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [selected, setSelected] = useState<GameSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTransition, setShowTransition] = useState(false);
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  const [pairPrompt, setPairPrompt] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<number | null>(null);
  const partnerName = burrow?.partner?.display_name?.trim() || 'your person';
  useEffect(() => () => { sessionRequest.current++; }, []);

  const loadOverview = useCallback(async () => {
    const value = await gameOverview();
    setOverview(value);
    return value;
  }, []);
  const loadSession = useCallback(async (id: string) => {
    const request = ++sessionRequest.current;
    const value = await gameSession(id);
    if (request === sessionRequest.current) setSession(value);
    return value;
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const value = await gameOverview();
        if (!live) return;
        setOverview(value);
        if (initialSessionId) {
          const opened = await gameSession(initialSessionId);
          if (live) setSession(opened);
        }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Unable to load Game Room.'); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [initialSessionId]);
  useEffect(() => {
    if (!session || session.ownAnswers.length !== 6 || session.guesses.length !== 6 || session.completedAt) return;
    const tick = () => { void loadSession(session.id).catch(() => {}); };
    const timer = setInterval(tick, 12_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [session?.id, session?.ownAnswers.length, session?.guesses.length, session?.completedAt, loadSession]);

  const selectedGame = selected ?? overview?.games.find(game => game.id === session?.gameId) ?? null;
  const active = useMemo(() => overview?.sessions.filter(item => !item.completedAt) ?? [], [overview]);
  const recentResults = useMemo(() => overview?.sessions.filter(item => !!item.completedAt).slice(0, 5) ?? [], [overview]);
  const isCatalogue = !session && !selected;
  const questionIndex = session ? session.ownAnswers.length < 6 ? session.ownAnswers.length : session.guesses.length : 0;
  const phase: 'own' | 'guess' = session?.ownAnswers.length === 6 ? 'guess' : 'own';
  const waiting = !!session && !session.completedAt && session.ownAnswers.length === 6 && session.guesses.length === 6;
  const answering = !!session && !session.completedAt && !waiting && !showTransition;
  const question = answering ? session.questions[questionIndex] : null;

  const perform = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); }
    catch (e) {
      const code = e instanceof Error ? e.message : 'Something went wrong.';
      if (code === 'insufficient_balance') Alert.alert('Not enough carrots', 'This game costs 20 carrots to unlock.', [
        { text: 'Later', style: 'cancel' }, { text: 'Carrot Shop', onPress: () => router.push('/(main)/burrow-detail?section=carrot_shop' as Href) },
      ]);
      else if (code === 'not_paired' || code === 'pair_changed') setPairPrompt(true);
      else setError(code.replaceAll('_', ' '));
    } finally { setBusy(false); }
  };
  const begin = (game: GameSummary) => {
    if (!overview?.paired) { setPairPrompt(true); return; }
    sessionRequest.current++;
    setSelected(game); setSession(null); setShowTransition(false); setShowAllAnswers(false);
  };
  const start = (game: GameSummary) => void perform(async () => {
    if (!overview?.availableIds.includes(game.id)) {
      await unlockGame(game.id);
      await Promise.all([loadOverview(), refreshBurrow()]);
    }
    const started = await startGame(game.id);
    const next = await loadSession(started.sessionId);
    setSelected(game);
    setShowTransition(next.ownAnswers.length === 6 && next.guesses.length === 0);
  });
  const answer = (choice: number) => {
    if (!session || busy) return;
    setPendingChoice(choice);
    void perform(async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 180));
        await answerGame(session.id, phase, questionIndex, choice);
        const next = await loadSession(session.id);
        if (phase === 'own' && next.ownAnswers.length === 6) setShowTransition(true);
        if (next.completedAt) await loadOverview();
      } finally { setPendingChoice(null); }
    });
  };
  const exitToList = () => { sessionRequest.current++; setSession(null); setSelected(null); setShowTransition(false); setShowAllAnswers(false); void loadOverview().catch(() => {}); };
  const goBack = () => {
    if (session || selected) exitToList();
    else router.back();
  };
  const notify = () => {
    if (!session) return;
    void perform(async () => {
      if (!session.notifyReady) {
        const permission = await requestNotificationPermission();
        if (permission !== 'granted' || !await syncRemoteNotificationRegistration({ force: true })) {
          Alert.alert('Notifications unavailable', 'Allow notifications and try again, or return to Game Room to check the result.');
          return;
        }
      }
      await notifyGame(session.id, !session.notifyReady);
      await loadSession(session.id);
    });
  };

  return <ImageBackground source={gameRoomBackground} resizeMode="stretch" style={st.root}>
    <View style={[st.top, { paddingTop: insets.top + 12 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" style={st.back} onPress={goBack}><Text style={st.backText}>‹</Text></Pressable>
      <Text style={[st.topTitle, isCatalogue && st.catalogueTitle]}>Game Room</Text>
      {isCatalogue ? <Pressable accessibilityRole="button" accessibilityLabel="Past rounds" style={st.historyButton} onPress={() => listRef.current?.scrollToEnd({ animated: true })}>
        <Text style={st.historyIcon}>🕘</Text><Text style={st.historyPage}>▤</Text>
      </Pressable> : burrow && <Pressable accessibilityRole="button" onPress={() => router.push('/(main)/burrow-detail?section=carrot_shop' as Href)} style={st.wallet}>
        <Text style={st.walletText}>🥕 {burrow.wallet.balance.toLocaleString()}</Text>
      </Pressable>}
    </View>
    <ScrollView ref={listRef} style={st.scroll} contentContainerStyle={[st.content, isCatalogue && st.catalogueContent, { paddingBottom: Math.max(30, insets.bottom + 20) }]}>
      {error && <Panel><Text style={st.error}>{error}</Text><Button label="Try again" secondary onPress={() => void perform(async () => { if (session) await loadSession(session.id); else await loadOverview(); })}/></Panel>}
      {loading && <ActivityIndicator size="large" color={cream} style={{ marginTop: 100 }}/ >}
      {!loading && pairPrompt && <Panel><Text style={st.panelTitle}>Connect with your person</Text><Text style={st.body}>Browse all 70 games now. Connect when you’re ready to play together.</Text>
        <Button label="Connect now" onPress={() => router.push('/(main)/friend-add' as Href)}/><Button label="Not now" secondary onPress={() => setPairPrompt(false)}/></Panel>}
      {!loading && session?.completedAt && session.result && <>
        <Text style={st.eyebrow}>RESULTS · {selectedGame?.title}</Text>
        <Text style={st.heroTitle}>{session.result.outcome === 'win' ? 'You won this round!' : session.result.outcome === 'lose' ? `${partnerName} won this round` : 'It’s a draw!'}</Text>
        <Text style={st.heroSub}>One point for each correct guess.</Text>
        <Panel><View style={st.scoreRow}><View style={st.scoreCell}><Text style={st.panelTitle}>You</Text><Text style={st.score}>{session.result.mine}/6</Text></View>
          <View style={st.scoreCell}><Text style={st.panelTitle}>{partnerName}</Text><Text style={st.score}>{session.result.partner}/6</Text></View></View>
          <Text style={st.hint}>You knew {partnerName} {session.result.outcome === 'win' ? 'just a little better.' : session.result.outcome === 'lose' ? 'a little less this time.' : 'equally well this time.'}</Text></Panel>
        <Panel><Text style={st.panelTitle}>How you matched</Text>
          {session.questions.slice(0, showAllAnswers ? 6 : 2).map((item, index) => {
            const answer = session.partnerOwnAnswers?.[index] ?? -1;
            const guess = session.guesses[index];
            return <View style={st.resultQuestion} key={index}><Text style={st.resultHeading}>{String(index + 1).padStart(2, '0')}  {item.self}</Text>
              <Text style={st.resultLine}>{partnerName} chose: {item.options[answer]}</Text>
              <Text style={st.resultLine}>You guessed: {item.options[guess]}  {answer === guess ? '✓' : '×'}</Text></View>;
          })}
          {!showAllAnswers && <Button label="See all 6 answers →" secondary onPress={() => setShowAllAnswers(true)}/>}</Panel>
        <Button label="Play again →" onPress={() => selectedGame && start(selectedGame)} disabled={busy || !selectedGame}/>
        <Button label="Back to Game Room" secondary onPress={exitToList}/>
      </>}
      {!loading && waiting && session && <>
        <Text style={st.eyebrow}>BOTH ROUNDS COMPLETE</Text><Text style={st.heroTitle}>Waiting for {partnerName}</Text>
        <Text style={st.heroSub}>Your answers and guesses are saved.</Text>
        <Panel><View style={st.waitRow}><Text style={st.panelTitle}>You</Text><Text style={st.waitStatus}>12/12 completed ✓</Text></View>
          <View style={st.divider}/><View style={st.waitRow}><Text style={st.panelTitle}>{partnerName}</Text><Text style={st.waitStatus}>{session.partnerOwnCount + session.partnerGuessCount}/12</Text></View>
          <Text style={st.hint}>Results unlock when you both finish.</Text></Panel>
        <Text style={st.heroSub}>You can leave. We’ll save your place.</Text>
        <Button label="Check for results" secondary disabled={busy} onPress={() => void perform(async () => { const next = await loadSession(session.id); if (next.completedAt) await loadOverview(); })}/>
        <Button label="Back to Game Room →" onPress={exitToList}/>
        <Button label={session.notifyReady ? 'Notifications on ✓' : 'Notify me when ready'} secondary onPress={notify} disabled={busy}/>
      </>}
      {!loading && showTransition && session && !waiting && <>
        <View style={st.transitionIcon}><Text style={st.transitionEmoji}>🃏</Text></View><Text style={st.eyebrowCenter}>STEP 1 COMPLETE</Text>
        <Panel style={{ marginTop: 28, alignItems: 'center' }}><Text style={st.panelHero}>Now, think like {partnerName}</Text>
          <Text style={[st.body, { textAlign: 'center' }]}>Choose the answers you think {partnerName} would pick.</Text></Panel>
        <Button label="Start guessing →" onPress={() => setShowTransition(false)}/>
      </>}
      {!loading && answering && session && question && <>
        <Text style={st.eyebrow}>STEP {phase === 'own' ? '1' : '2'} OF 2</Text>
        <Text style={st.heroTitle}>{phase === 'own' ? 'Your answers' : `Guess ${partnerName}’s answers`}</Text>
        <View style={st.progressRow}><Text style={st.progressLabel}>{questionIndex + 1} of 6</Text>{Array.from({ length: 6 }, (_, i) => <View key={i} style={[st.dot, i < questionIndex && st.dotDone, i === questionIndex && st.dotCurrent]}/>)}</View>
        <Panel style={{ marginTop: 22 }}><Text style={st.question}>{phase === 'own' ? question.self : question.partner.replaceAll('[Name]', partnerName)}</Text>
          {question.options.map((option, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${labels[index]}. ${option}`} accessibilityState={{selected:pendingChoice===index,disabled:busy}} disabled={busy} onPress={() => answer(index)} style={({ pressed }) => [st.option, (pressed||pendingChoice===index) && st.optionSelected, busy&&pendingChoice!==index && { opacity: .65 }]}>
            <Text style={st.optionLetter}>{labels[index]}</Text><Text style={st.optionText}>{option}</Text><Text style={[st.optionCircle,pendingChoice===index&&st.optionCheck]}>{pendingChoice===index?'✓':'○'}</Text></Pressable>)}
        </Panel><Text style={st.hintLight}>Tap an answer to continue · Each choice is saved</Text>
      </>}
      {!loading && !session && selected && <>
        <Text style={st.eyebrow}>{selected.category.toUpperCase()} {selected.spicy !== '—' ? selected.spicy : ''}</Text>
        <Text style={st.heroTitle}>{selected.title}</Text><Text style={st.heroSub}>{selected.hook}</Text>
        <Panel><View style={st.step}><Text style={st.stepNumber}>01</Text><Image source={BURROW_GAME_RULE_ICONS[0]} style={{width:48,height:48}} resizeMode="contain"/><Text style={st.stepText}>Answer all 6 questions about yourself</Text></View>
          <View style={st.divider}/><View style={st.step}><Text style={st.stepNumber}>02</Text><Image source={BURROW_GAME_RULE_ICONS[1]} style={{width:48,height:48}} resizeMode="contain"/><Text style={st.stepText}>Guess your partner’s answers</Text></View>
          <View style={st.divider}/><View style={st.step}><Text style={st.stepNumber}>03</Text><Image source={BURROW_GAME_RULE_ICONS[2]} style={{width:48,height:48}} resizeMode="contain"/><Text style={st.stepText}>Compare scores after you both finish</Text></View></Panel>
        {!overview?.availableIds.includes(selected.id) && <Text style={st.hintLight}>Unlock once for 20 carrots. This game stays in your collection.</Text>}
        <Button label={overview?.availableIds.includes(selected.id) ? 'Start game →' : 'Unlock for 🥕 20 & start →'} disabled={busy} onPress={() => {
          if (overview?.availableIds.includes(selected.id)) start(selected);
          else Alert.alert('Unlock this game?', `Spend 20 carrots to unlock ${selected.title} permanently?`, [
            { text: 'Cancel', style: 'cancel' }, { text: 'Unlock', onPress: () => start(selected) },
          ]);
        }}/>
      </>}
      {!loading && !session && !selected && overview && <>
        <Image source={gameRoomHero} style={st.catalogueHero} resizeMode="cover" accessibilityLabel="Two bunnies playing a board game in their cozy cave" />
        {active.length > 0 && <><Text style={st.sectionTitle}>{active.some(item => item.ownCount + item.guessCount === 0 && item.partnerOwnCount + item.partnerGuessCount > 0) ? `Pending Game from ${partnerName}` : 'Continue playing'}</Text>{active.map(item => {
          const game = overview.games.find(g => g.id === item.gameId);
          return <Pressable key={item.id} accessibilityRole="button" style={st.continueCard} onPress={() => void perform(async () => { await loadSession(item.id); setSelected(game ?? null); setShowTransition(item.ownCount === 6 && item.guessCount === 0); })}>
            {game && <Image source={gameRoomIcons[game.id]} style={st.continueIcon} resizeMode="contain" />}<View style={{ flex: 1 }}><Text style={st.continueTitle}>{game?.title ?? item.gameId}</Text><Text style={st.continueSub}>{item.ownCount + item.guessCount}/12 · {item.ownCount + item.guessCount === 12 ? 'Waiting for partner' : 'Continue'}</Text></View><Text style={st.continueArrow}>{item.ownCount + item.guessCount === 0 ? 'Play Now' : 'Continue →'}</Text>
          </Pressable>;
        })}</>}
        <Text style={st.sectionTitle}>Latest</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.gameRow}>
          {overview.games.slice(-4).reverse().map(game => <GameTile key={game.id} game={game} width={tileWidth} onPress={() => begin(game)}/>)}
        </ScrollView>
        {overview.categories.map(category => <View key={category} style={st.categorySection}><Text style={st.sectionTitle}>{category}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.gameRow}>{overview.games.filter(game => game.category === category).map(game =>
            <GameTile key={game.id} game={game} width={tileWidth} onPress={() => begin(game)}/>)}</ScrollView></View>)}
        {recentResults.length > 0 && <><Text style={st.sectionTitle}>Past rounds</Text>{recentResults.map(item => {
          const game = overview.games.find(g => g.id === item.gameId);
          return <Pressable key={item.id} accessibilityRole="button" style={st.continueCard} onPress={() => void perform(async () => { await loadSession(item.id); setSelected(game ?? null); setShowAllAnswers(false); })}>
            {game && <Image source={gameRoomIcons[game.id]} style={st.continueIcon} resizeMode="contain" />}<View style={{ flex: 1 }}><Text style={st.continueTitle}>{game?.title ?? item.gameId}</Text><Text style={st.continueSub}>See results</Text></View><Text style={st.continueArrow}>→</Text>
          </Pressable>;
        })}</>}
        <Text style={st.hintLight}>A game unlock belongs to the account that bought it and remains available permanently.</Text>
      </>}
      {busy && <ActivityIndicator color={cream} style={{ marginTop: 14 }}/ >}
    </ScrollView>
  </ImageBackground>;
}

function GameTile({ game, width, onPress }: { game: GameSummary; width: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={game.title} style={[st.gameTile, { width }]} onPress={onPress}>
    <Image source={gameRoomIcons[game.id]} style={{ width: width * .65, height: width * .65 }} resizeMode="contain" />
    <Text style={st.tileTitle} numberOfLines={2} adjustsFontSizeToFit>{game.title}</Text>
  </Pressable>;
}

const st = StyleSheet.create({
  root: { flex: 1 }, top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12, paddingBottom: 12 },
  back: { width: 45, height: 45, borderRadius: 24, backgroundColor: '#FFFFFF30', alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#FFF', fontSize: 39, lineHeight: 42, marginTop: -7 }, topTitle: { color: '#FFF', fontSize: 25, fontWeight: '800', flex: 1 },
  catalogueTitle: { textAlign: 'center' }, historyButton: { width: 45, height: 45, borderRadius: 24, backgroundColor: '#FFFFFF30', alignItems: 'center', justifyContent: 'center' },
  historyIcon: { position: 'absolute', top: 1, left: 5, fontSize: 17, zIndex: 1 }, historyPage: { color: cream, fontSize: 29, lineHeight: 35 },
  wallet: { backgroundColor: cream, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8 }, walletText: { color: ink, fontWeight: '800' },
  scroll: { flex: 1 }, content: { padding: 18, gap: 18 }, catalogueContent: { paddingTop: 0, gap: 10 },
  catalogueHero: { width: '100%', aspectRatio: 1.83, borderRadius: 23, borderWidth: 3, borderColor: '#9A5939', overflow: 'hidden', marginBottom: 2 },
  heroTitle: { color: '#FFF', fontSize: 37, lineHeight: 43, fontWeight: '900', marginTop: 16 },
  heroSub: { color: '#F5D4BE', fontSize: 19, lineHeight: 26 }, eyebrow: { color: '#E7C3A9', fontSize: 15, letterSpacing: 2, fontWeight: '800', marginTop: 22 },
  eyebrowCenter: { color: '#F5D4BE', textAlign: 'center', fontSize: 16, letterSpacing: 2, fontWeight: '800' },
  panel: { backgroundColor: cream, borderRadius: 25, padding: 20, gap: 14, shadowColor: '#251107', shadowOpacity: .33, shadowOffset: { width: 0, height: 7 }, shadowRadius: 0, elevation: 5 },
  panelTitle: { color: ink, fontSize: 22, fontWeight: '800' }, panelHero: { color: ink, fontSize: 30, fontWeight: '900', textAlign: 'center' }, body: { color: muted, fontSize: 18, lineHeight: 25 },
  button: { borderRadius: 40, paddingVertical: 17, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: cream, minHeight: 58, shadowColor: '#241208', shadowOffset: { width: 0, height: 5 }, shadowOpacity: .5, shadowRadius: 0, elevation: 4 },
  buttonText: { color: ink, fontSize: 21, fontWeight: '800', textAlign: 'center' }, secondaryButton: { borderColor: '#F5D9C7', borderWidth: 1.5, backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 }, secondaryText: { color: '#FFF' },
  sectionTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', marginTop: 8 }, categorySection: { gap: 7, marginTop: 8 }, gameRow: { gap: 9, paddingBottom: 4 },
  gameTile: { backgroundColor: '#EEE9DB', borderRadius: 13, padding: 5, gap: 3, alignItems: 'center', justifyContent: 'center', shadowColor: '#26160F', shadowOpacity: .35, shadowOffset: { width: 0, height: 3 }, shadowRadius: 0, elevation: 3 },
  tileTitle: { color: ink, fontWeight: '800', fontSize: 11, lineHeight: 13, minHeight: 27, textAlign: 'center', width: '100%' },
  continueCard: { backgroundColor: '#EEE9DB', borderRadius: 15, padding: 10, minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#26160F', shadowOpacity: .35, shadowOffset: { width: 0, height: 3 }, shadowRadius: 0, elevation: 3 }, continueIcon: { width: 47, height: 47 },
  continueTitle: { color: ink, fontSize: 15, fontWeight: '800' }, continueSub: { color: muted, fontSize: 11 }, continueArrow: { color: '#F9781E', fontSize: 13, fontWeight: '800' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 10 }, stepNumber: { color: ink, backgroundColor: '#F6E8D8', overflow: 'hidden', borderRadius: 24, padding: 11, fontSize: 18, fontWeight: '800' },
  stepText: { flex: 1, color: ink, fontSize: 18, fontWeight: '700' }, divider: { backgroundColor: '#E7D2BD', height: 1 }, hintLight: { color: '#F5D4BE', textAlign: 'center', fontSize: 15, lineHeight: 21 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }, progressLabel: { color: '#F5D4BE', fontSize: 17, fontWeight: '700', marginRight: 8 },
  dot: { width: 19, height: 19, borderRadius: 10, borderColor: '#BA9073', borderWidth: 2 }, dotDone: { backgroundColor: orange, borderColor: orange }, dotCurrent: { backgroundColor: '#F8A62A', borderColor: cream },
  question: { color: ink, fontSize: 26, lineHeight: 32, fontWeight: '900', marginBottom: 6 },
  option: { borderColor: '#F0E2D3', borderWidth: 1.5, borderRadius: 16, padding: 12, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionSelected: { borderColor: orange, backgroundColor: '#FFF3E9' },
  optionLetter: { color: ink, fontSize: 18, fontWeight: '800', backgroundColor: '#F7E9DC', overflow: 'hidden', borderRadius: 22, width: 44, height: 44, textAlign: 'center', textAlignVertical: 'center', lineHeight: 44 },
  optionText: { color: ink, fontSize: 18, fontWeight: '700', flex: 1 }, optionCircle: { color: '#B39A85', fontSize: 29 },
  optionCheck: { color: orange, fontWeight: '900' },
  transitionIcon: { alignItems: 'center', marginTop: 90 }, transitionEmoji: { fontSize: 100 },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }, waitStatus: { color: orange, fontSize: 18, fontWeight: '800' },
  hint: { color: muted, fontSize: 15, textAlign: 'center', lineHeight: 22 }, scoreRow: { flexDirection: 'row' }, scoreCell: { flex: 1, alignItems: 'center' }, score: { color: ink, fontSize: 38, fontWeight: '900' },
  resultQuestion: { borderBottomWidth: 1, borderBottomColor: '#EAD8C4', paddingVertical: 11, gap: 4 }, resultHeading: { color: ink, fontSize: 17, fontWeight: '800' }, resultLine: { color: muted, fontSize: 15 },
  error: { color: '#A92921', fontSize: 17, fontWeight: '700' },
});
