/**
 * EXP banner — Stage 3.9.A.2.3
 *
 * Stacked: ribbon-art title + purple capsule with the level + EXP bar.
 *
 * Animation philosophy (Stage 5.WR.2, SIXTH and FINAL rewrite):
 *
 * Reanimated's withTiming/withSequence are interruption-safe by design.
 * When a new withTiming starts while a previous animation is still
 * running, Reanimated automatically picks up from the worklet's current
 * frame and animates to the new target. No cancelAnimation needed.
 *
 * Previous five attempts all failed because they tried to "help"
 * Reanimated handle interruption — calling cancelAnimation, then
 * setting progress.value = stableValue, then starting a new
 * withTiming. The intermediate manual writes were ASYNCHRONOUS
 * cross-thread operations (JS → UI thread), so the next withTiming
 * still read the worklet's stale frame, not the just-written value.
 * Result: animation from a wrong start point → visible regression
 * or replay.
 *
 * This rewrite trusts Reanimated:
 *   - The useEffect only calls withTiming or withSequence. Nothing else.
 *   - State tracking (prev level, prev target) uses sharedValues, not
 *     refs. sharedValue reads inside a worklet are synchronous; refs
 *     are JS-only and would have the same cross-thread issue.
 *
 * Level-up detection runs JS-side (the level prop change is React-
 * triggered, not worklet-triggered), but the decision feeds straight
 * into withSequence/withTiming without intermediate progress.value
 * writes — so there is no JS/worklet race surface.
 */
import { useEffect, useMemo, useState } from 'react';
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
const LEVEL_UP_HOLD_MS = 200;

export type ExpBannerProps = {
  level: number;
  expCurrent: number;
  expNeeded: number;
};

export function ExpBanner({ level, expCurrent, expNeeded }: ExpBannerProps) {
  // Stable derived value — only changes when the underlying numbers
  // do. Prevents useEffect re-runs on parent re-renders where the
  // expCurrent/expNeeded didn't actually change.
  const target = useMemo(() => {
    if (expNeeded <= 0) return 0;
    return Math.min(1, Math.max(0, expCurrent / expNeeded));
  }, [expCurrent, expNeeded]);

  // The shared value driving the bar fill. Lives on the UI thread.
  const progress = useSharedValue(target);

  // Track previous level on the UI thread (via sharedValue), not the
  // JS thread (via useRef). Worklets read sharedValues synchronously;
  // they cannot read refs at all. Putting prev-level on the UI thread
  // means level-up detection inside a worklet would be possible, and
  // even when we read it from JS (as we do below), the value is the
  // same one the worklet sees — no thread skew.
  const prevLevel = useSharedValue(level);

  useEffect(() => {
    const isLevelUp = level > prevLevel.value;
    // Update the tracker BEFORE issuing the animation. Subsequent
    // effect runs read the just-updated value.
    prevLevel.value = level;

    if (isLevelUp) {
      // 4-stage industry-standard level-up celebration:
      //   1. current → 100% (reward the xp gain that crossed the cap)
      //   2. hold at 100% (the "I leveled up!" moment)
      //   3. snap to 0 (instant, the level number flips here)
      //   4. 0 → new level's target (the leftover overflow xp)
      //
      // Stage 1's duration scales with how much of the bar is empty,
      // so a near-full bar tops off quickly while a half-empty one
      // gets more time. Keeps the perceived xp-per-second feel
      // consistent regardless of where the bar started.
      //
      // Critically: this withSequence call SUPERSEDES any in-flight
      // animation on `progress`. Reanimated starts the new sequence
      // from the worklet's current frame — no cancel/set/restart
      // gymnastics needed, and no cross-thread race window.
      const startValue = progress.value;
      const fillRemaining = Math.max(0, 1 - startValue);
      const fillToFullMs = Math.max(
        80,
        Math.min(FILL_DURATION_MS, fillRemaining * FILL_DURATION_MS),
      );

      progress.value = withSequence(
        withTiming(1, {
          duration: fillToFullMs,
          easing: Easing.out(Easing.cubic),
        }),
        withTiming(1, { duration: LEVEL_UP_HOLD_MS, easing: Easing.linear }),
        withTiming(0, { duration: 0 }),
        withTiming(target, {
          duration: FILL_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        }),
      );
    } else {
      // Same-level update. Trust withTiming to animate from the
      // worklet's current frame to the new target. If a level-up
      // sequence is still in flight (rare — the user would have to
      // tap a task within ~2s of the previous level-up), withTiming
      // picks up from wherever it is and smoothly bends toward the
      // new target. No replay.
      progress.value = withTiming(target, {
        duration: FILL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [target, level, progress, prevLevel]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  // Animated xp number — ticks 30 → 31 → 32 ... in lockstep with the
  // bar filling. During a level-up sequence the number climbs to
  // expNeeded (cap), holds, snaps to 0, then climbs to the leftover —
  // matching the bar's 4-stage motion exactly because they're both
  // driven by progress.value.
  const [animatedExpCurrent, setAnimatedExpCurrent] = useState(expCurrent);
  useAnimatedReaction(
    () => progress.value,
    (curr) => {
      runOnJS(setAnimatedExpCurrent)(Math.round(curr * expNeeded));
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
