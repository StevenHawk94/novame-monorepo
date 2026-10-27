import type { GestureResponderEvent } from 'react-native';

export const LEFT_EDGE_BACK_WIDTH = 24;
export const LEFT_EDGE_RESPONSE_DISTANCE = { start: 0, end: LEFT_EDGE_BACK_WIDTH };

/** Single native policy for every horizontally pushed page. Internal pages
 * should be real stack entries, not turn this off based on their UI mode. */
export const HORIZONTAL_EDGE_BACK_OPTIONS = {
  gestureEnabled: true,
  gestureDirection: 'horizontal' as const,
  fullScreenGestureEnabled: false,
  gestureResponseDistance: LEFT_EDGE_RESPONSE_DISTANCE,
  animationMatchesGesture: true,
};

/** PanResponder's x0 is still zero during responder negotiation. Capture the
 * real screen-space touch-down, not local coordinates or the latest move. */
export function pageTouchStartX(event: GestureResponderEvent): number | null {
  const touches = event.nativeEvent.touches;
  if (touches.length !== 1) return null;
  const x = touches[0].pageX;
  return Number.isFinite(x) && x >= 0 ? x : null;
}

export function shouldStartEdgeBack(startX: number | null, dx: number, dy: number, touches = 1) {
  return startX !== null && startX >= 0 && startX <= LEFT_EDGE_BACK_WIDTH && touches === 1
    && dx > 10 && Math.abs(dy) < Math.abs(dx) / 2;
}
