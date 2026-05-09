/**
 * CardSpinAnimation — Stage 3.8.3.lottie (2025-11-XX)
 *
 * Spinning ticket loader powered by Lottie. Used by:
 *   - record.tsx publishing/analyzing phases (mode='continuous')
 *   - onboarding/step-spinning.tsx (mode='timed', duration=3000)
 *
 * The Lottie file (assets/animations/ticket-spin.json) was derived
 * from a LottieFiles "rotating ticket" template, customized to
 * remove the joystick element and recolor the border to NovaMe
 * purple (#A855F7).
 *
 * Native dep: lottie-react-native@7.3.6 + lottie-ios@4.6.0 (installed
 * via pod install on 2025-11-XX). If you see "Unimplemented component:
 * <LottieAnimationView>", the iOS build needs `npx expo run:ios`
 * to recompile.
 *
 * Layout: dead-simplest centered column. 0 absolutes, 0 transforms,
 * 0 perspective — Lottie native bridge handles all rendering.
 */
import { useEffect } from 'react';
import LottieView from 'lottie-react-native';
import { StyleSheet, Text, View } from 'react-native';

const TICKET_LOTTIE = require('../../../assets/animations/ticket-spin.json');

export type CardSpinAnimationProps = {
  label1: string;
  label2?: string;
  sublabel: string;
  mode?: 'timed' | 'continuous';
  duration?: number;
  onDone?: () => void;
};

export function CardSpinAnimation({
  label1,
  label2,
  sublabel,
  mode = 'timed',
  duration,
  onDone,
}: CardSpinAnimationProps) {
  // Timed mode: schedule onDone
  useEffect(() => {
    if (mode !== 'timed') return;
    if (typeof duration !== 'number' || !onDone) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [mode, duration, onDone]);

  return (
    <View style={styles.root}>
      {/* Top half: Lottie centered in its own region. Position is
          independent of label count, so publishing (3 labels) and
          analyzing (2 labels) phases render the animation at the
          same screen Y. */}
      <View style={styles.topHalf}>
        <LottieView
          source={TICKET_LOTTIE}
          autoPlay
          loop
          style={styles.lottie}
          resizeMode="contain"
        />
      </View>

      {/* Bottom half: labels anchored to a fixed height region,
          top-aligned. label2 is optional; its presence/absence does
          not affect Lottie position above. */}
      <View style={styles.bottomHalf}>
        <Text style={styles.label1} numberOfLines={2}>
          {label1}
        </Text>
        {label2 ? (
          <Text style={styles.label2} numberOfLines={2}>
            {label2}
          </Text>
        ) : null}
        <Text style={styles.sublabel} numberOfLines={2}>
          {sublabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 32,
  },
  topHalf: {
    // Lottie aligned to BOTTOM of top half. With topHalf:bottomHalf
    // = 1:1 (each 50% of screen), the Lottie's bottom edge sits at
    // screen 50%, so its CENTER (220px tall, 110px above bottom)
    // lands at roughly screen 45% — what user wants.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bottomHalf: {
    // Labels at TOP of bottom half. With a small paddingTop they
    // visually sit just below the Lottie regardless of label count.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 24,
  },
  lottie: {
    width: 220,
    height: 220,
  },
  label1: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    textAlign: 'center',
  },
  label2: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
  sublabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 8,
  },
});
