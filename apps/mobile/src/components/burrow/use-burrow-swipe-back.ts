import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

/** Edge-initiated back gesture avoids stealing horizontal rails and toy drags. */
export function useBurrowSwipeBack(onBack: () => void) {
  const callback = useRef(onBack);
  callback.current = onBack;
  return useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      gesture.x0 <= 36 && gesture.dx > 22 && Math.abs(gesture.dy) < 25,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx >= 85 && Math.abs(gesture.dy) < 80) callback.current();
    },
  }).panHandlers, []);
}
