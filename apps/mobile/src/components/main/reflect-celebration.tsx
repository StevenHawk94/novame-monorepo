import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import LottieView, { type AnimationObject } from 'lottie-react-native';

// Warm the composition before completion, then give each visible run a fresh
// native instance. A hidden/preloaded instance may have finished or detached.
const SOURCE = require('../../../assets/animations/reflect-dense.json');

// Quests supplies a recolored copy, sharing this exact playback lifecycle.
// Keep source stable for a run; mount with a new key to prepare another run.
export const ReflectCelebration = memo(function ReflectCelebration({ active, source = SOURCE, onComplete }: {
  active: boolean;
  source?: AnimationObject;
  onComplete?: () => void;
}) {
  const animation = useRef<LottieView | null>(null);
  const [laidOut, setLaidOut] = useState(false);
  const completed = useRef(false);
  const enabled = useRef(active);
  enabled.current = active;
  const attempts = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [finished, setFinished] = useState(false);
  const completeCallback = useRef(onComplete);
  completeCallback.current = onComplete;
  const shouldPlay = active && laidOut;
  const instanceKey = shouldPlay ? `run-${attempt}` : 'preload';
  const currentInstance = useRef(instanceKey);
  currentInstance.current = instanceKey;
  const capture = useCallback((view: LottieView | null) => {
    if (currentInstance.current !== instanceKey) return;
    animation.current = view;
    if (view && AppState.currentState !== 'active') view.pause();
  }, [instanceKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!enabled.current || completed.current) return;
      if (state !== 'active') {
        animation.current?.pause();
      } else {
        animation.current?.resume();
      }
    });
    return () => {
      subscription.remove();
      animation.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!shouldPlay || finished) return;
    // A native finish callback can be lost on detach. Allow the entire
    // composition plus loading slack, counting foreground time only.
    let remaining = ((source.op - source.ip) / source.fr) * 1000 + 2500;
    if (!Number.isFinite(remaining) || remaining < 2500) remaining = 10000;
    let began = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      if (timer !== undefined) { clearTimeout(timer); remaining -= Date.now() - began; timer = undefined; }
    };
    const resume = () => {
      if (timer !== undefined || completed.current) return;
      began = Date.now();
      timer = setTimeout(() => {
        if (completed.current || !enabled.current) return;
        completed.current = true;
        setFinished(true);
        completeCallback.current?.();
      }, Math.max(remaining, 0));
    };
    if (AppState.currentState === 'active') resume();
    const subscription = AppState.addEventListener('change', state => state === 'active' ? resume() : pause());
    return () => { pause(); subscription.remove(); };
  }, [shouldPlay, finished, source, attempt]);

  if (finished) return null;
  return (
    <View pointerEvents="none" accessible={false} collapsable={false}
      onLayout={(event) => {
        // A temporary zero layout on tab detach must not replace run-N with
        // preload and then autoplay run-N again when the tab reattaches.
        if (event.nativeEvent.layout.width > 0 && event.nativeEvent.layout.height > 0) setLaidOut(true);
      }}
      style={[styles.layer, { opacity: active ? 1 : 0 }]}>
      <LottieView
        key={instanceKey}
        ref={capture}
        source={source}
        // One playback authority. Native autoplay waits for composition loading;
        // an imperative play() sent earlier can be lost on iOS. Do not wait for
        // onAnimationLoaded either: the installed iOS JSON path can miss it.
        autoPlay={shouldPlay}
        speed={shouldPlay ? 1 : 0}
        loop={false}
        renderMode={Platform.OS === 'android' ? (attempt === 0 ? 'HARDWARE' : 'SOFTWARE') : 'AUTOMATIC'}
        hardwareAccelerationAndroid={Platform.OS === 'android' && attempt === 0}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        onAnimationFinish={(cancelled) => {
          if (cancelled || !enabled.current || !shouldPlay || completed.current
            || currentInstance.current !== instanceKey) return;
          completed.current = true;
          setFinished(true);
          onComplete?.();
        }}
        onAnimationFailure={(error) => {
          if (completed.current || currentInstance.current !== instanceKey) return;
          console.warn('[celebration] animation failed:', error);
          // A failed warm-up must not permanently disable the upcoming run.
          if (!shouldPlay || !enabled.current) return;
          if (attempts.current === 0) {
            attempts.current = 1;
            currentInstance.current = 'retry-pending';
            setAttempt(1);
            return;
          }
          completed.current = true;
          setFinished(true);
          onComplete?.();
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
});
