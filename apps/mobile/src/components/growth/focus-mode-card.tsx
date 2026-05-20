/**
 * Focus Mode card — Stage 3.9.A.2.1, Stage 6 visual refresh.
 *
 * Single horizontal card with a lightning icon + "Focus Mode" label
 * + sublabel + Start button on the right.
 *
 * Behavior:
 *   - mode === 'play' + wp > 0:  Button is orange "Start", breathing
 *     animation loops (scale 1.0 -> 1.04 + shadow opacity 0.4 -> 0.7,
 *     1.5s full cycle). Tap fires onStart.
 *   - mode === 'play' + wp <= 0: Button is grey "WP empty", disabled,
 *     no animation.
 *   - mode === 'study':          Button is green "In Progress",
 *     disabled (study runs until WP hits 0), no animation.
 *
 * Breathing animation rationale:
 *   - 1.5s full cycle (750ms one-way, withRepeat with reverse=true)
 *     matches industry UI breathing tempo (Sleep app, Headspace, Calm).
 *   - Easing.inOut(quad) gives the "slow start, fast middle, slow end"
 *     feel of real breathing — linear feels mechanical, cubic too
 *     dramatic.
 *   - 4% scale amplitude + shadow opacity swing creates visual density
 *     without being distracting. Scale alone reads as mechanical.
 *   - Animated.View wraps the Pressable (not the other way around)
 *     because Pressable's style={({pressed}) => [...]} closure is a
 *     JS-thread function, incompatible with useAnimatedStyle worklets.
 *     The outer Animated.View carries the breath transform; the inner
 *     Pressable composes its own press-down transform — RN flattens
 *     them automatically (scale 1.04 * scale 0.96 = ~1.0 on press).
 */
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// Bundle asset for the Focus Mode icon. Resolved via Metro's asset
// pipeline (require returns a numeric module id usable as <Image>
// source).
const FOCUS_ICON_SOURCE = require('../../../assets/images/growth/focus-icon.png');


import type { CharacterMode } from '@/lib/constants';
import { WP_STUDY_DECAY_PER_HOUR } from '@/lib/constants';

export type FocusModeCardProps = {
  mode: CharacterMode;
  wp: number;
  busy?: boolean;
  onStart: () => void;
};

export function FocusModeCard({ mode, wp, busy, onStart }: FocusModeCardProps) {
  const isStudy = mode === 'study';
  const wpZero = wp <= 0;
  const canStart = !isStudy && !wpZero && !busy;

  const buttonLabel = isStudy ? 'XP Boost Active' : wpZero ? 'Low WP' : 'Start';

  // Countdown when study mode is active: time remaining until WP hits 0.
  // wp / decayPerHour = hours remaining. Recomputed on every render
  // (parent re-renders ~every 30s via wpVisual decay tick), so the
  // displayed countdown stays roughly in sync with the bar.
  const studyHoursLeft = isStudy && wp > 0 ? wp / WP_STUDY_DECAY_PER_HOUR : 0;
  const studyTotalMinutes = Math.max(0, Math.round(studyHoursLeft * 60));
  const studyH = Math.floor(studyTotalMinutes / 60);
  const studyM = studyTotalMinutes % 60;
  const studyCountdown = `${studyH}h ${studyM}m`;

  const sublabel = isStudy
    ? `XP is gaining faster, Your Pal will finish study in ${studyCountdown}`
    : wpZero
      ? 'Recover Your WP to Start'
      : 'Start to boost your XP faster';

  // Breathing animation SharedValue. Oscillates 0 <-> 1 when canStart,
  // held at 0 otherwise. Cancellation is explicit on the else branch
  // so a flipped state immediately stills the button — without cancel,
  // the in-flight withTiming would continue to its target before stopping.
  const breath = useSharedValue(0);

  useEffect(() => {
    if (canStart) {
      breath.value = withRepeat(
        withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }),
        -1,    // infinite
        true,  // reverse on each iteration: 0 -> 1 -> 0 -> 1 ...
      );
    } else {
      cancelAnimation(breath);
      breath.value = 0;
    }
  }, [canStart, breath]);

  const breathStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(breath.value, [0, 1], [1, 1.04]) },
    ],
    shadowOpacity: interpolate(breath.value, [0, 1], [0.4, 0.7]),
  }));

  // Color palette per state — new design figure 1:
  //   canStart (wp>=10, mode='play')  -> purple, breathing
  //   isStudy (study mode active)     -> green, "XP Boost Active"
  //   wpZero (wp<10)                  -> red, "Low WP" (was grey)
  const buttonColors: [string, string] = canStart
    ? ['#8B5CF6', '#7C3AED']
    : isStudy
      ? ['#34D399', '#10B981']
      : ['#F87171', '#EF4444'];

  const shadowColor = canStart ? '#7C3AED' : isStudy ? '#10B981' : '#EF4444';

  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        <View style={styles.iconBubble}>
          {FOCUS_ICON_SOURCE ? (
            <Image
              source={FOCUS_ICON_SOURCE}
              style={styles.iconImg}
              resizeMode="contain"
            />
          ) : (
            <MaterialIcons name="bolt" size={28} color="#FFFFFF" />
          )}
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title}>Study Mode</Text>
          <Text style={styles.sub}>{sublabel}</Text>
        </View>
        {/* Outer Animated.View carries breath animation (scale + shadow).
            Inner Pressable handles press feedback independently — RN
            composes the two transforms automatically. canStart gates
            whether breathStyle applies; non-active states get a static
            shadowColor only. */}
        <Animated.View style={canStart ? breathStyle : undefined}>
          <Pressable
            onPress={onStart}
            disabled={!canStart}
            style={({ pressed }) => [
              styles.btnWrap,
              { shadowColor },
              !canStart && styles.btnWrapDisabled,
              pressed && canStart && styles.btnWrapPressed,
            ]}
          >
            <LinearGradient
              colors={buttonColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.btn}
            >
              <Text style={styles.btnText}>{buttonLabel}</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    paddingHorizontal: 0,
    marginTop: 14,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#1A0F3D',
  },
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  iconImg: {
    width: '100%',
    height: '100%',
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  sub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  btnWrap: {
    borderRadius: 999,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  btnWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  btnWrapPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  btn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 999,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
