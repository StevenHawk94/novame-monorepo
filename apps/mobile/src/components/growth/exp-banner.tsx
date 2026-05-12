/**
 * EXP banner — Stage 3.9.A.2.3
 *
 * Stacked: ribbon-art title + purple capsule with the level + EXP bar.
 *
 * The bar fill is animated via reanimated so that incoming exp values
 * (e.g. after completing a daily task) flow in like water rather than
 * snapping. The text labels (Lv. N / current/needed xp) update
 * instantly on prop change so the user reads the new state before
 * the bar finishes filling.
 */
import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const TASK_BANNER_SOURCE = require('../../../assets/images/growth/task-banner.webp');

const BANNER_ASPECT = 460 / 130;
const BANNER_MAX_WIDTH = 280;

const FILL_DURATION_MS = 800;

export type ExpBannerProps = {
  level: number;
  expCurrent: number;
  expNeeded: number;
};

export function ExpBanner({ level, expCurrent, expNeeded }: ExpBannerProps) {
  const target =
    expNeeded > 0 ? Math.min(1, Math.max(0, expCurrent / expNeeded)) : 0;
  const progress = useSharedValue(target);

  useEffect(() => {
    // Stage 5.WR.2 (Bug 5 fix): detect level-up to avoid the
    // "rewind" bug. When the user levels up:
    //   prev render: expCurrent=20, expNeeded=20 -> target=1.0
    //   next render: expCurrent=0,  expNeeded=50 -> target=0.0
    // Plain withTiming(0.0) would visually reverse the bar from
    // full back to empty, which users perceive as a glitch.
    //
    // Level-up heuristic: target < progress.value AND drop > 0.5.
    // This catches the actual level-up case (full -> 0) without
    // false-firing on small in-level decreases (which shouldn't
    // happen anyway since EXP only grows in normal flow).
    //
    // Sequence: confirm-fill (100ms) -> instant snap to 0 (0ms) ->
    // animate up to new target (800ms). The 100ms confirm-fill is
    // the "level-up flash" — visual reward.
    const isLevelUp = target < progress.value && progress.value - target > 0.5;
    if (isLevelUp) {
      progress.value = withSequence(
        withTiming(1, { duration: 100, easing: Easing.linear }),
        withTiming(0, { duration: 0 }),
        withTiming(target, {
          duration: FILL_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        }),
      );
    } else {
      progress.value = withTiming(target, {
        duration: FILL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [target, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const expLabel = `${expCurrent} / ${expNeeded}xp`;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleBannerWrap}>
        <Image
          source={TASK_BANNER_SOURCE}
          style={styles.bannerImg}
          resizeMode="contain"
        />
        <Text style={styles.titleText}>Grow with Your Pal</Text>
      </View>

      <View style={styles.expCard}>
        <View style={styles.barLabelRow}>
          <Text style={styles.lvLabel}>Lv. {level}</Text>
          <Text style={styles.expLabel}>{expLabel}</Text>
        </View>
        <View style={styles.barTrack}>
          <Animated.View style={[styles.barFill, fillStyle]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    marginTop: 12,
  },
  titleBannerWrap: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: BANNER_MAX_WIDTH,
    aspectRatio: BANNER_ASPECT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  bannerImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  titleText: {
    color: '#1F1F1F',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: -16,
  },
  expCard: {
    backgroundColor: '#7C3AED',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  barLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  lvLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  expLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '700',
  },
  barTrack: {
    height: 10,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#F5641F',
    borderRadius: 999,
  },
});
