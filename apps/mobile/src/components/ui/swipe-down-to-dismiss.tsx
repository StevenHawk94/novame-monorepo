import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';

type SwipeDownToDismissProps = {
  children: ReactNode;
  onDismiss: () => void;
  /** Keep the wrapper mounted while temporarily disabling its gesture. */
  enabled?: boolean;
  /** For scrollable entry screens, only begin when their scroll is at the top. */
  canStart?: () => boolean;
};

type NativeStackTransitionNavigation = {
  addListener: (
    event: 'transitionStart' | 'transitionEnd',
    listener: (event: { data?: { closing?: boolean } }) => void,
  ) => () => void;
};

/**
 * Full-screen downward-dismiss gesture used only by first-level picker pages.
 * Child input flows deliberately do not mount this wrapper, so an in-progress
 * reflection or focus session cannot be dismissed by an accidental swipe.
 * This wrapper only recognizes intent. The native stack animates the entire
 * route out; never hide its contents before the navigator has removed it.
 */
export function SwipeDownToDismiss({ children, onDismiss, enabled = true, canStart }: SwipeDownToDismissProps) {
  const navigation = useNavigation();
  const dismissRef = useRef(onDismiss);
  const enabledRef = useRef(enabled);
  const armedRef = useRef(false);
  const canStartRef = useRef(canStart);

  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { canStartRef.current = canStart; }, [canStart]);

  useEffect(() => {
    // An entry route mounts while the opening finger may still be
    // down. Arm from the navigator's transitionEnd signal instead of guessing
    // a device-dependent delay: the opening touch can never become a dismiss
    // pan, while an intentional swipe works as soon as the page is fully open.
    armedRef.current = false;
    // Expo Router's inferred type only includes core navigation events, but
    // these routes are native-stack screens and emit transition events.
    const transitionNavigation =
      navigation as unknown as NativeStackTransitionNavigation;
    const unsubscribeStart = transitionNavigation.addListener(
      'transitionStart',
      (event) => {
        if (event.data?.closing) armedRef.current = false;
      },
    );
    const unsubscribeEnd = transitionNavigation.addListener(
      'transitionEnd',
      (event) => {
        if (!event.data?.closing) armedRef.current = true;
      },
    );
    return () => {
      armedRef.current = false;
      unsubscribeStart();
      unsubscribeEnd();
    };
  }, [navigation]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (!enabledRef.current || !armedRef.current) return false;
      if (canStartRef.current && !canStartRef.current()) return false;
      return gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx) * 1.25;
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!enabledRef.current || !armedRef.current) return;
      if (gesture.dy >= 110 || (gesture.dy >= 45 && gesture.vy >= 1.1)) {
        armedRef.current = false;
        // Identical close path to the back button. The page remains visible
        // until its native exit begins; there is no second, invisible close.
        dismissRef.current();
      }
    },
  }), []);

  return (
    <View
      style={styles.root}
      {...responder.panHandlers}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
