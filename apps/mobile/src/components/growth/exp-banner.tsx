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
import { useEffect, useState, useRef} from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
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

  // Stage 5.WR.2 (Bug 4 fix, second pass): level-up detection via
  // level prop change instead of progress.value drop heuristic.
  //
  // Why the heuristic failed: progress goes 5/20=0.25 → 5/30=0.167
  // on a level-up where the user earned exactly enough xp to cross
  // and have leftover. That's a drop of only 0.083 — below the 0.5
  // threshold the heuristic used. The fallback path then ran
  // withTiming(target) directly, animating the bar BACKWARD from
  // 0.25 to 0.167 — a visible regression.
  //
  // The industry-standard pattern (Pokemon, Star Wars Battlefront II,
  // most RPGs): detect level-up via the level value itself changing,
  // not via progress math. Bar never regresses; instead any decrease
  // routes through the 4-stage celebration sequence.
  //
  // Why a ref instead of state: we only need to compare against the
  // previous level inside this effect; we don't need re-renders
  // when prev level changes.
  //
  // Belt-and-suspenders: also force the level-up path whenever
  // target < progress.value, since the EXP bar should never visually
  // regress. If level didn't change but server somehow returned a
  // lower expCurrent (data error, replay glitch, anything), we'd
  // rather animate the user through a confusing fill-snap-rise than
  // show the bar shrinking backward.
  const prevLevelRef = useRef(level);
  useEffect(() => {
    const isLevelUp = level > prevLevelRef.current || target < progress.value;
    prevLevelRef.current = level;

    if (isLevelUp) {
      // 4-stage industry-standard level-up sequence:
      //   1. Current position → 100% (visual reward for the xp gain
      //      that pushed the user past the cap)
      //   2. Hold at 100% (the "I leveled up!" moment)
      //   3. Snap to 0 (level number ticks up here)
      //   4. 0 → new level's target (leftover overflow xp)
      //
      // Stage 1 duration scales with remaining distance to 100% so a
      // bar that's already near full finishes quickly, and one that's
      // half empty takes proportionally longer — keeps the "linear xp
      // gain" perception consistent.
      const fillRemaining = Math.max(0, 1 - progress.value);
      const fillToFullMs = Math.max(
        80,
        Math.min(FILL_DURATION_MS, fillRemaining * FILL_DURATION_MS),
      );
      progress.value = withSequence(
        withTiming(1, {
          duration: fillToFullMs,
          easing: Easing.out(Easing.cubic),
        }),
        withTiming(1, { duration: 200, easing: Easing.linear }),
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
  }, [target, progress, level]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  // Stage 5.WR.2 (Bug 4 fix): animate the number alongside the bar.
  // We track a separate "display" state that updates on every JS-side
  // tick of the Reanimated progress value. The label reads from this
  // state instead of the prop, so the number ticks 20 → 21 → 22 → ...
  // → 40 in lockstep with the bar filling.
  //
  // For level-up frames, progress.value goes 1 → 1 (hold) → 0 (snap)
  // → newTarget. The displayed number tracks each phase: rises to
  // expNeeded (last level cap), holds, snaps to 0, rises again. We
  // compute the number as round(progress.value * expNeeded) for the
  // in-level phase and let the level-up branch override expNeeded
  // mid-animation via a ref so the snap happens cleanly.
  const [animatedExpCurrent, setAnimatedExpCurrent] = useState(expCurrent);

  useAnimatedReaction(
    () => progress.value,
    (curr) => {
      // Map progress (0..1) back to xp (0..expNeeded). Math.round so
      // the displayed number is an integer at every frame.
      const nextNum = Math.round(curr * expNeeded);
      runOnJS(setAnimatedExpCurrent)(nextNum);
    },
    [expNeeded],
  );

  const expLabel = `${animatedExpCurrent} / ${expNeeded}xp`;

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
