import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from './burrow-image';
import { BurrowBackButton } from './burrow-back-button';
import { useBurrow } from '@/lib/burrow-store';
import { gameHistory, type GameHistoryPage } from '@/lib/burrow-game-room-api';
import { cacheGameHistory, gameHistoryNeedsRefresh, getCachedGameHistory } from '@/lib/burrow-game-room-cache';
import { GAME_ROOM_GAMES } from '@/lib/burrow-game-room-content';
import { gameRoomIcons } from '@/lib/burrow-game-room-art';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { gameResultViewed, useLocalGames } from '@/lib/burrow-game-local';
import { openPreparedBurrow } from '@/lib/burrow-page-entry';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';

const games = new Map(GAME_ROOM_GAMES.map(game => [game.id, game]));
const empty: GameHistoryPage = { paired: false, rounds: [], nextCursor: null };
const labels = { win: 'Win', tie: 'Tie', lose: 'Lose' };

export function GameHistoryScreen() {
  usePageBackGesture(true);
  const { data } = useBurrow();
  const insets = useSafeAreaInsets();
  const scope = data ? `${data.profile.id}:${data.partner?.id ?? ''}:${data.pairVersion ?? ''}` : '';
  useLocalGames(scope); // Viewing a result updates this retained history immediately.
  const [snapshot, setSnapshot] = useState(() => ({ scope, page: getCachedGameHistory(scope) }));
  const page = (snapshot.scope === scope ? snapshot.page : getCachedGameHistory(scope)) ?? empty;
  const archived=page.rounds.filter(round=>!!round.resultViewedAt||gameResultViewed(round.id,scope));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(0), busy = useRef(false), live = useRef(false);
  const currentScope = useRef(scope); currentScope.current = scope;
  const partnerName = data?.partner?.display_name?.trim() || 'your person';

  const load = useCallback(async (cursor?: string | null) => {
    if (!scope || !live.current || busy.current) return;
    const request = ++requests.current, epoch = sessionEpoch();
    const current = () => live.current && request === requests.current && epoch === sessionEpoch() && currentScope.current === scope;
    busy.current = true; setLoading(true); setError(null);
    try {
      const next = await gameHistory(cursor);
      if (!current()) return;
      const cached = getCachedGameHistory(scope);
      // Refreshes must not erase older local games or a round completed while
      // the background request was in flight. Server scores replace old copies.
      const merged = { ...next, rounds: Array.from(new Map([...(cached?.rounds ?? []), ...next.rounds]
        .map(round => [round.id, round])).values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) };
      cacheGameHistory(merged, Date.now(), scope);
      setSnapshot({ scope, page: merged });
    } catch (e) {
      if (!current()) return;
      const code = e instanceof Error ? e.message : '';
      if (code === 'pair_changed' || code === 'not_paired' || code === 'session_changed') {
        setSnapshot({ scope, page: empty });
        cacheGameHistory(empty, 0, scope);
        setError('Your connection changed. Return to your room and try again.');
      } else if (cursor) setError('Could not load earlier games. Please try again.');
    } finally { if (current()) { busy.current = false; setLoading(false); } }
  }, [scope]);

  useFocusEffect(useCallback(() => {
    live.current = true; busy.current = false; setLoading(false); setError(null);
    setSnapshot({ scope, page: getCachedGameHistory(scope) });
    const identity = subscribeSessionIdentity(() => {
      requests.current++; busy.current = false; setLoading(false);
      setSnapshot({ scope: '', page: null });
    });
    if (scope && gameHistoryNeedsRefresh(Date.now(), scope)) void load();
    return () => { live.current = false; requests.current++; busy.current = false; identity(); };
  }, [scope, load]));
  const activity=useRef(data?.attention?.games);
  useEffect(()=>{
    const changed=activity.current!==data?.attention?.games;
    activity.current=data?.attention?.games;
    if(changed&&live.current)void load();
  },[data?.attention?.games,load]);

  return <View style={s.root}>
    <View style={[s.header, { paddingTop: insets.top + 12 }]}>
      <BurrowBackButton light onPress={() => router.back()} />
      <Text accessibilityRole="header" style={s.title}>Game History</Text><View style={{ width: 45 }} />
    </View>
    <FlatList data={archived} keyExtractor={round=>round.id} initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
      contentContainerStyle={[s.content, { paddingBottom: Math.max(24, insets.bottom + 20) }]} ListHeaderComponent={<>
      <Text style={s.subtitle}>You & {partnerName}</Text>
      {error && <View style={s.notice}><Text accessibilityRole="alert" style={s.noticeText}>{error}</Text>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void load()} style={s.retry}><Text style={s.retryText}>Retry</Text></Pressable></View>}
      {!archived.length && <Text style={s.empty}>No history yet</Text>}
      </>} renderItem={({item:round}) => {
        const game = games.get(round.gameId), outcome = round.result?.outcome;
        return <Pressable accessibilityRole="button" accessibilityLabel={`${game?.title ?? round.gameId}. ${outcome ? labels[outcome] : 'View result'}`}
          style={({ pressed }) => [s.row, pressed && { opacity: .8 }]} onPress={() => openPreparedBurrow({ pathname: '/(main)/game-room', params: { sessionId: round.id, source: 'history' } } as Href)}>
          <Image source={gameRoomIcons[round.gameId]} contentFit="contain" style={s.icon} />
          <View style={s.details}><Text style={s.gameName}>{game?.title ?? round.gameId}</Text>
            <Text style={s.date}>{new Date(round.completedAt).toLocaleDateString()}</Text>
            {round.result && <Text style={s.score}>You {round.result.mine} · {partnerName} {round.result.partner}</Text>}
          </View>
          <View style={s.outcomeColumn}>{outcome && <View style={[s.badge, outcome === 'win' ? s.win : outcome === 'lose' ? s.lose : s.tie]}>
            <Text style={s.outcome}>{labels[outcome]}</Text></View>}<Text style={s.arrow}>›</Text></View>
        </Pressable>;
      }} ListFooterComponent={page.nextCursor ? <Pressable accessibilityRole="button" disabled={loading} onPress={() => void load(page.nextCursor)} style={s.more}><Text style={s.moreText}>Load earlier games</Text></Pressable> : null}/>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#492817' },
  header: { paddingHorizontal: 18, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, color: '#FFF9EF', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  content: { paddingHorizontal: 18, gap: 14 }, subtitle: { color: '#FFF0DE', textAlign: 'center', fontSize: 17, marginBottom: 8 },
  row: { backgroundColor: '#FFF9EF', borderRadius: 23, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  icon: { width: 55, height: 55 }, details: { flex: 1, gap: 4 }, gameName: { color: '#3C1D12', fontSize: 17, fontWeight: '800' },
  date: { color: '#80604F', fontSize: 13 }, score: { color: '#80604F', fontSize: 13 }, outcomeColumn: { alignItems: 'center', gap: 5 },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 13 }, win: { backgroundColor: '#D5E7C5' },
  tie: { backgroundColor: '#F5E2BB' }, lose: { backgroundColor: '#F1D3CB' }, outcome: { color: '#3C1D12', fontSize: 14, fontWeight: '800' },
  arrow: { color: '#80604F', fontSize: 22 }, empty: { color: '#FFF0DE', textAlign: 'center', marginTop: 65, fontSize: 17, lineHeight: 25 },
  notice: { backgroundColor: '#FFF9EF', borderRadius: 20, padding: 18, gap: 12 }, noticeText: { color: '#80604F', fontSize: 15 },
  retry: { alignSelf: 'flex-start' }, retryText: { color: '#844624', fontSize: 16, fontWeight: '800' },
  more: { padding: 17, borderRadius: 25, borderWidth: 1, borderColor: '#FFF0DE', alignItems: 'center' }, moreText: { color: '#FFF9EF', fontSize: 16, fontWeight: '700' },
});
