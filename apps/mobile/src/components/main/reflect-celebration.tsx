import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';

// Mount once with the input screen, not on the expensive settlement render.
// One native composition retains the existing double-density, five-second effect.
const SOURCE = require('../../../assets/animations/reflect-dense.json');

export const ReflectCelebration = memo(function ReflectCelebration({ active }: { active: boolean }) {
  const animation = useRef<LottieView | null>(null);
  const laidOut = useRef(false);
  const started = useRef(false);
  const completed = useRef(false);
  const enabled = useRef(active);
  enabled.current = active;
  const frame = useRef<number | null>(null);
  const [finished, setFinished] = useState(false);

  const start = useCallback(() => {
    if (!enabled.current || started.current || completed.current || !laidOut.current
      || !animation.current || AppState.currentState !== 'active' || frame.current !== null) return;
    // Native layout/attachment must be committed before sending the command.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!enabled.current || started.current || completed.current || !animation.current
        || AppState.currentState !== 'active') return;
      started.current = true;
      animation.current.play(SOURCE.ip, SOURCE.op);
    });
  }, []);
  const capture = useCallback((view: LottieView | null) => {
    animation.current = view;
    if (view) start();
  }, [start]);

  useEffect(() => { if (active) start(); }, [active, start]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!enabled.current || completed.current) return;
      if (state !== 'active') {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        animation.current?.pause();
      } else if (started.current) {
        animation.current?.resume();
      } else {
        start();
      }
    });
    return () => {
      subscription.remove();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      animation.current?.pause();
    };
  }, [start]);

  if (finished) return null;
  return (
    <View pointerEvents="none" accessible={false} collapsable={false}
      style={[styles.layer, { opacity: active ? 1 : 0 }]}>
      <LottieView
        ref={capture}
        source={SOURCE}
        // Native autoplay also handles late composition loading. Do not gate
        // playback on onAnimationLoaded: some native load paths miss that event.
        autoPlay={active}
        loop={false}
        renderMode={Platform.OS === 'android' ? 'HARDWARE' : 'AUTOMATIC'}
        hardwareAccelerationAndroid={Platform.OS === 'android'}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        onLayout={(event) => {
          laidOut.current = event.nativeEvent.layout.width > 0 && event.nativeEvent.layout.height > 0;
          start();
        }}
        onAnimationLoaded={start}
        onAnimationFinish={(cancelled) => {
          if (cancelled || !enabled.current || !started.current) return;
          completed.current = true;
          setFinished(true);
        }}
        onAnimationFailure={(error) => {
          console.warn('[reflect] celebration animation failed:', error);
          completed.current = true;
          setFinished(true);
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
});
