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
    // Stage 5.WR.2 (Bug 3 fix, second pass): correct level-up sequence.
    //
    // The user's perception of level-up is a 4-stage event:
    //   1. Their current bar position rises smoothly to 100% (this
    //      is the visual reward for THIS xp gain — the user must
    //      feel the bar fill before the level changes).
    //   2. The bar holds at 100% briefly to confirm the level-up
    //      moment (a beat for the eye to register the milestone).
    //   3. The bar snaps to 0 (instantly, no animation) as the
    //      level number ticks up.
    //   4. The bar rises from 0 to the new level's progress
    //      (the leftover xp that overflowed past the prior cap).
    //
    // First-pass fix did 1+3+4 only (skipping the fill to 100%) so
    // users saw the bar abruptly disappear instead of completing
    // the fill they earned. Now restored.
    //
    // Stage 1 duration is proportional to remaining distance from
    // the current progress to 1.0 — so a near-full bar finishes
    // quickly, a half-full one takes longer. Keeps the "linear xp
    // gain" perception consistent.
    //
    // Detection heuristic unchanged: target < progress.value AND
    // drop > 0.5 catches level-up specifically. Small in-level
    // decreases (which shouldn't happen) don't false-fire.
    const isLevelUp = target < progress.value && progress.value - target > 0.5;
    if (isLevelUp) {
      const fillRemaining = Math.max(0, 1 - progress.value);
      // Scale fill-to-full duration by remaining distance. Floor at
      // 80ms so very-near-full bars still show a small visible fill
      // rather than snapping. Ceiling at FILL_DURATION_MS so a
      // hypothetical "level up from 0%" case still fits.
      const fillToFullMs = Math.max(
        80,
        Math.min(FILL_DURATION_MS, fillRemaining * FILL_DURATION_MS),
      );
      progress.value = withSequence(
        // 1. Current position → 100% (the xp the user just earned)
        withTiming(1, {
          duration: fillToFullMs,
          easing: Easing.out(Easing.cubic),
        }),
        // 2. Hold at 100% for the level-up "moment"
        withTiming(1, { duration: 200, easing: Easing.linear }),
        // 3. Snap to 0 instantly (no animation)
        withTiming(0, { duration: 0 }),
        // 4. 0 → new level's target (leftover overflow xp)
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
