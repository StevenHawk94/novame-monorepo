import { Redirect, useLocalSearchParams } from 'expo-router';
import { GameRoomScreen } from '@/components/burrow/game-room-screen';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';

export default function GameRoomRoute() {
  const enabled = useMajorUpdateEnabled();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  if (!enabled) return <Redirect href="/(main)/(tabs)" />;
  return <GameRoomScreen initialSessionId={typeof sessionId === 'string' ? sessionId : undefined} />;
}
