import { Redirect, useLocalSearchParams } from 'expo-router';
import { GameRoomScreen } from '@/components/burrow/game-room-screen';
import { GameHistoryScreen } from '@/components/burrow/game-history-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';

export default function GameRoomRoute() {
  const enabled = useMajorUpdateEnabled();
  const { gameId, sessionId, history, source } = useLocalSearchParams<{ gameId?: string; sessionId?: string; history?: string; source?: string }>();
  if (!enabled) return <Redirect href="/(main)/(tabs)" />;
  if (history === '1') return <GameHistoryScreen />;
  return <GameRoomScreen initialGameId={typeof gameId === 'string' ? gameId : undefined}
    initialSessionId={typeof sessionId === 'string' ? sessionId : undefined} fromHistory={source === 'history'} />;
}
