import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';

type SwipeDownToDismissProps = {
  children: ReactNode;
  onDismiss: () => void;
  /** Keep the wrapper mounted while temporarily disabling its gesture. */
  enabled?: boolean;
  /** For scrollable entry screens, only begin when their scroll is at the top. */
  canStart?: () => boolean;
};

/**
 * Full-screen downward-dismiss gesture used only by first-level picker pages.
 * Child input flows deliberately do not mount this wrapper, so an in-progress
 * reflection or focus session cannot be dismissed by an accidental swipe.
 */
export function SwipeDownToDismiss({ children, onDismiss, enabled = true, canStart }: SwipeDownToDismissProps) {
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss);
  const enabledRef = useRef(enabled);
  const canStartRef = useRef(canStart);

  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { canStartRef.current = canStart; }, [canStart]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (!enabledRef.current) return false;
      if (canStartRef.current && !canStartRef.current()) return false;
      return gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx) * 1.25;
    },
    onPanResponderMove: (_event, gesture) => {
      translateY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy >= 110 || (gesture.dy >= 45 && gesture.vy >= 1.1)) {
        Animated.timing(translateY, {
          toValue: screenHeight + 80,
          duration: 170,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) dismissRef.current();
        });
        return;
      }
      Animated.spring(translateY, {
        toValue: 0,
        damping: 20,
        stiffness: 240,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateY, {
        toValue: 0,
        damping: 20,
        stiffness: 240,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
  }), [screenHeight, translateY]);

  return (
    <Animated.View
      style={[styles.root, { transform: [{ translateY }] }]}
      {...responder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
