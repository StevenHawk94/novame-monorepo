/**
 * EXP banner — Stage 6 SEVENTH rewrite (Plan C: clean-slate, JS-driven).
 *
 * Previous six rewrites all tried to make Reanimated's withSequence
 * or shared-value cross-thread reads carry the level-up decision
 * logic. Every iteration failed in a new way:
 *   - withSequence + cancelAnimation race -> stale frame replay
 *   - withSequence trusting interrupt -> works for same-level but
 *     mis-fires on parent re-render
 *   - shared-value prevLevel -> JS read is async cross-thread, so
 *     React StrictMode / HMR / rapid setState can read stale and
 *     mis-classify same-level as level-up
 *   - JS targetLevelRef + complex state machine -> race between
 *     refs and the in-flight `withTiming` callback when refreshChar
 *     resolves mid-sequence; visible as "bar fills to 100% then
 *     retreats then re-fills"
 *
 * Root cause across all attempts: trying to bolt animation control
 * onto a single SharedValue that Reanimated owns the lifecycle of.
 *
 * Plan C architecture:
 *
 *   - displayLevel / displayMax / displayXp are React state. Pure JS.
 *     The Lv. label and xp ticker render from these directly.
 *   - progressRatio is a Reanimated SharedValue. It drives ONLY the
 *     bar fill width. Nothing reads it back to JS.
 *   - Animation is a JS state machine. Each segment of motion calls
 *     two things in parallel, both keyed to the same start timestamp
 *     and duration so they stay in lockstep:
 *       (a) progressRatio = withTiming(targetRatio, {duration, easing})
 *       (b) a requestAnimationFrame loop that tweens displayXp
 *           from startXp to endXp using the same easing-out-cubic.
 *     When the bar finishes (Reanimated callback) the next segment
 *     starts. The xp ticker is finalized by its own rAF loop hitting
 *     the duration boundary -- not by the Reanimated callback.
 *   - Level-up detection is `level !== displayLevel`. JS comparison,
 *     no SharedValue involved.
 *
 * Why bar and number stay in sync without cross-thread coordination:
 * both are driven by the same wall-clock time + same easing function.
 * They converge on the same end value at the same instant
 * independently. No JS<->UI synchronization needed.
 */
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { getExpNeeded } from '@novame/core';

const TASK_BANNER_SOURCE = require('../../../assets/images/growth/task-banner.webp');

const BANNER_ASPECT = 460 / 130;
const BANNER_MAX_WIDTH = 280;

// First fill (or same-level fill) gets the full 800ms for celebration.
// Subsequent fills in a multi-level burst are compressed so a +3 lv
// gain doesn't drag past ~2s total.
const FILL_DURATION_MS = 800;
const FILL_DURATION_MS_FAST = 400;
const LEVEL_UP_HOLD_MS = 200;

// Easing.out(cubic) in closed form so the rAF tween for the xp number
// matches Reanimated's Easing.out(Easing.cubic) on the bar.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export type ExpBannerProps = {
  level: number;
  expCurrent: number;
  expNeeded: number;
};

export function ExpBanner({ level, expCurrent, expNeeded }: ExpBannerProps) {
  // ---- Display state (what the UI shows right now) ----
  const [displayLevel, setDisplayLevel] = useState(level);
  const [displayMax, setDisplayMax] = useState(expNeeded);
  const [displayXp, setDisplayXp] = useState(expCurrent);

  // ---- Synchronous truth refs ----
  // displayXp / displayMax / displayLevel are async to read (React
  // state). When the animation pipeline needs the "current visual
  // value" to use as a tween start point, it MUST read from a
  // synchronous source -- reading from state would give a stale
  // value during the same tick the snap happened. These refs
  // mirror the latest committed-or-about-to-commit values.
  const displayXpRef = useRef(expCurrent);
  const displayMaxRef = useRef(expNeeded);
  const displayLevelRef = useRef(level);
  const progressRatioRef = useRef(
    expNeeded > 0 ? Math.min(1, Math.max(0, expCurrent / expNeeded)) : 0,
  );

  // ---- Bar width (UI thread) ----
  const progressRatio = useSharedValue(
    expNeeded > 0 ? Math.min(1, Math.max(0, expCurrent / expNeeded)) : 0,
  );

  // ---- Animation control refs ----
  // Sequence id increments every time we kick off a new top-level
  // animation (i.e. props change reaches the effect). In-flight
  // segments check this id before advancing; if it changed, the
  // segment bails. This is the core "drop stale animation" mechanism
  // that makes the component robust to mid-animation prop updates
  // (e.g. server refreshChar landing during a level-up sequence).
  const sequenceIdRef = useRef(0);
  // Active rAF id, so a new sequence can cancel the previous rAF
  // tween for the xp number.
  const rafIdRef = useRef<number | null>(null);
  // Last props seen by the effect, so we can skip work when nothing
  // actually changed (defensive against parent re-renders that don't
  // move any of the numbers).
  const lastPropsRef = useRef({ level, expCurrent, expNeeded });

  // ---- Helpers ----

  const cancelRaf = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  /**
   * Tween a numeric React state from `startVal` to `endVal` over
   * `durationMs` using ease-out-cubic. Resolves when done OR when a
   * newer sequence supersedes (mySequenceId !== sequenceIdRef.current).
   *
   * The bar and the number both call this conceptually; in practice
   * the bar uses Reanimated's withTiming (UI thread) and the number
   * uses this rAF tween (JS thread). Same easing + same duration +
   * same start time = visually identical motion.
   */
  const tweenXpNumber = (
    startVal: number,
    endVal: number,
    durationMs: number,
    mySequenceId: number,
    onDone: () => void,
  ) => {
    cancelRaf();
    if (durationMs <= 0) {
      setDisplayXp(Math.round(endVal));
      onDone();
      return;
    }
    const startedAt = performance.now();
    const step = () => {
      // Stale-sequence guard. A newer animation started, bail.
      if (mySequenceId !== sequenceIdRef.current) return;
      const elapsed = performance.now() - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      const nextVal = Math.round(startVal + (endVal - startVal) * eased);
      // Update ref synchronously so a follow-up segment in the same
      // tick reads the true current value, not a stale React state.
      displayXpRef.current = nextVal;
      setDisplayXp(nextVal);
      if (t >= 1) {
        rafIdRef.current = null;
        onDone();
        return;
      }
      rafIdRef.current = requestAnimationFrame(step);
    };
    rafIdRef.current = requestAnimationFrame(step);
  };

  /**
   * One "fill" segment. Animates BOTH the bar ratio (UI thread) and
   * the xp number (JS thread) from their current displayed values
   * to (targetRatio, targetXp) over durationMs.
   *
   * onDone fires when the JS-side tween completes. We use the JS
   * tween as the authoritative "done" signal because Reanimated's
   * withTiming callback runs on the UI thread and would need a
   * runOnJS hop -- which historically was a source of timing skew
   * (callback firing a frame later than the visual finish). The JS
   * tween hits its boundary at exactly performance.now() = start +
   * duration, which is the same wall-clock moment the bar finishes.
   */
  const fillSegment = (
    targetRatio: number,
    targetXp: number,
    durationMs: number,
    mySequenceId: number,
    onDone: () => void,
  ) => {
    // Bar (UI thread).
    progressRatio.value = withTiming(targetRatio, {
      duration: durationMs,
      easing: Easing.out(Easing.cubic),
    });
    // Mirror the bar's destination on the JS side. Even though the
    // worklet animates progressRatio.value in parallel, our ref
    // tracks the LOGICAL destination so the next segment's startXp
    // / start ratio reads true intent, not mid-animation noise.
    progressRatioRef.current = targetRatio;
    // Number (JS thread). Start from the ref — guaranteed
    // synchronous, never stale.
    const startXp = displayXpRef.current;
    tweenXpNumber(startXp, targetXp, durationMs, mySequenceId, onDone);
  };

  /**
   * Instant snap of bar and number simultaneously, with a two-layer
   * requestAnimationFrame settle so React commit + UI paint complete
   * before the caller's onCommitted fires.
   *
   * Why two layers (this is THE critical fix for the "bar rebound"
   * bug observed across rewrites 1-6):
   *
   *   Frame N:     snapTo() called.
   *                - Refs updated synchronously (displayXpRef etc.)
   *                - progressRatio.value = 0 dispatched to worklet
   *                  (queued for the next UI-thread tick)
   *                - setState calls scheduled (queued for React commit)
   *   Frame N+1:   First rAF callback fires. React has typically
   *                committed by now, but the next paint hasn't
   *                rendered yet -- the bar visually still shows the
   *                pre-snap width. If onCommitted ran here, the next
   *                withTiming(targetRatio, 800ms) would start while
   *                the worklet's last RENDERED frame is still ~1.0,
   *                producing visible motion from 1.0 backward to
   *                targetRatio. THIS IS THE REBOUND.
   *   Frame N+2:   Second rAF fires. The 0-width frame has been
   *                painted. Worklet's rendered frame is 0. Now a
   *                new withTiming(targetRatio, 800ms) starts from
   *                the freshly-painted 0 and moves forward only.
   *
   * The React reference solution this component is modeled on
   * (provided by the product team) uses the same two-rAF pattern
   * with isTransitioning toggle. We adapt it for RN/Reanimated by
   * keeping the "two-layer settle" idea and replacing the toggle
   * with withTiming(_, duration:0) for the snap itself.
   */
  const snapTo = (
    ratio: number,
    xp: number,
    max: number,
    lvl: number,
    mySequenceId: number,
    onCommitted: () => void,
  ) => {
    cancelRaf();
    // Refs update synchronously -- any code path reading these in
    // the same tick (e.g. a stale callback firing before the rAF
    // wait) sees the correct post-snap values.
    displayXpRef.current = xp;
    displayMaxRef.current = max;
    displayLevelRef.current = lvl;
    progressRatioRef.current = ratio;
    // Worklet update: instant.
    progressRatio.value = withTiming(ratio, { duration: 0 });
    // React state update: triggers commit on next tick.
    setDisplayXp(xp);
    setDisplayMax(max);
    setDisplayLevel(lvl);
    // Two-layer rAF before signaling "snap fully settled."
    requestAnimationFrame(() => {
      if (mySequenceId !== sequenceIdRef.current) return;
      requestAnimationFrame(() => {
        if (mySequenceId !== sequenceIdRef.current) return;
        onCommitted();
      });
    });
  };

  // ---- Main effect: react to props ----
  useEffect(() => {
    const prev = lastPropsRef.current;
    // Defensive: parent re-rendered but nothing relevant moved.
    if (
      prev.level === level &&
      prev.expCurrent === expCurrent &&
      prev.expNeeded === expNeeded
    ) {
      return;
    }
    lastPropsRef.current = { level, expCurrent, expNeeded };

    // Kick off a new sequence. Any in-flight rAF tween or pending
    // onDone callbacks tied to the previous sequence id will detect
    // the mismatch and bail.
    const mySequenceId = ++sequenceIdRef.current;

    // ----- Case 1: same level. Single fill, no celebration. -----
    // Read level via ref -- it's the synchronous truth, displayLevel
    // state may not have committed yet after a recent snap.
    if (level === displayLevelRef.current) {
      // Possibly nudge displayMax if the server adjusted expNeeded
      // without a level change (rare; e.g. balance tuning while a
      // user is online).
      if (displayMaxRef.current !== expNeeded) {
        displayMaxRef.current = expNeeded;
        setDisplayMax(expNeeded);
      }
      const targetRatio = expNeeded > 0 ? Math.min(1, expCurrent / expNeeded) : 0;
      fillSegment(targetRatio, expCurrent, FILL_DURATION_MS, mySequenceId, () => {
        // Same-level fill done. Nothing more to do.
      });
      return;
    }

    // ----- Case 2: level-up (possibly multi-level). -----
    // Plan, executed via async callback chain:
    //   For each intermediate level [displayLevel .. level - 1]:
    //     fill currentDisplay -> 100% of currentMax
    //     hold LEVEL_UP_HOLD_MS at 100%
    //     snap to (ratio=0, xp=0, max=getExpNeeded(nextLevel), level=nextLevel)
    //   Finally: fill 0 -> targetRatio of level's cap, xp 0 -> expCurrent
    //
    // First fill uses FILL_DURATION_MS for celebration; subsequent
    // intermediates use FILL_DURATION_MS_FAST so a +3 lv burst stays
    // under ~2s.

    // Build the plan as a sequence of steps. We execute them via a
    // recursive runStep so each step's onDone can read state fresh
    // (state may have advanced since the plan was built, but the
    // plan only encodes target maxes / levels, which are stable).
    type Step =
      | { kind: 'fill-to-cap'; max: number; nextLevel: number; durationMs: number }
      | { kind: 'final-fill'; targetRatio: number; targetXp: number; max: number };

    const plan: Step[] = [];
    // Plan starts from the currently DISPLAYED state, read from refs
    // (synchronous truth, never stale).
    let cursorLevel = displayLevelRef.current;
    let cursorMax = displayMaxRef.current;
    let isFirst = true;
    while (cursorLevel < level) {
      plan.push({
        kind: 'fill-to-cap',
        max: cursorMax,
        nextLevel: cursorLevel + 1,
        durationMs: isFirst ? FILL_DURATION_MS : FILL_DURATION_MS_FAST,
      });
      cursorLevel += 1;
      cursorMax = getExpNeeded(cursorLevel);
      isFirst = false;
    }
    // Final segment inside the destination level. Note expNeeded
    // from props is authoritative for the destination cap (should
    // equal cursorMax after the loop, but trust props if they
    // disagree -- e.g. mid-tune curve change).
    const finalRatio = expNeeded > 0 ? Math.min(1, expCurrent / expNeeded) : 0;
    plan.push({
      kind: 'final-fill',
      targetRatio: finalRatio,
      targetXp: expCurrent,
      max: expNeeded,
    });

    let stepIdx = 0;
    const runStep = () => {
      if (mySequenceId !== sequenceIdRef.current) return; // superseded
      if (stepIdx >= plan.length) return;
      const step = plan[stepIdx++];

      if (step.kind === 'fill-to-cap') {
        // Phase 1: fill current displayed XP up to the cap.
        fillSegment(1, step.max, step.durationMs, mySequenceId, () => {
          if (mySequenceId !== sequenceIdRef.current) return;
          // Phase 2: hold for celebration beat, then snap.
          setTimeout(() => {
            if (mySequenceId !== sequenceIdRef.current) return;
            // Phase 3: snap to 0 on the next level's cap.
            const nextMax =
              stepIdx < plan.length && plan[stepIdx].kind === 'fill-to-cap'
                ? (plan[stepIdx] as { max: number }).max
                : (plan[stepIdx] as { max: number }).max;
            // snapTo handles the two-layer rAF settle internally
            // and invokes onCommitted only after the 0-width frame
            // has been painted. THIS is what prevents the next
            // withTiming from starting against a stale ~1.0 worklet
            // frame and animating backward.
            snapTo(0, 0, nextMax, step.nextLevel, mySequenceId, () => {
              runStep();
            });
          }, LEVEL_UP_HOLD_MS);
        });
      } else {
        // Final fill inside the destination level. Update displayMax
        // first (and its ref) so the ticker label denominator matches
        // what we're filling toward.
        if (displayMaxRef.current !== step.max) {
          displayMaxRef.current = step.max;
          setDisplayMax(step.max);
        }
        fillSegment(
          step.targetRatio,
          step.targetXp,
          FILL_DURATION_MS,
          mySequenceId,
          () => {
            // Sequence complete.
          },
        );
      }
    };

    runStep();
    // Intentional deps: only the props. displayLevel / displayMax /
    // displayXp are mutated BY this effect (and its async callbacks),
    // so listing them would cause self-retrigger. We read them via
    // refs above for any synchronous "where am I now" lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, expCurrent, expNeeded]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cancelRaf();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Render ----
  const fillStyle = useAnimatedStyle(() => ({
    width: `${progressRatio.value * 100}%`,
  }));

  const expLabel = `${displayXp} / ${displayMax}xp`;

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
          <Text style={styles.lvLabel}>Lv. {displayLevel}</Text>
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
