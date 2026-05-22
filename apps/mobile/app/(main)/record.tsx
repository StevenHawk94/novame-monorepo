/**
 * Record modal — recording flow entry point.
 *
 * 7-phase state machine (mirrors old visdom-capacitor RecordOverlay.js
 * exactly, but expressed as RN components driven by phase state):
 *
 *   choose       — pick "Record" or "Type instead"
 *   recording    — circular progress timer + pause/cancel/save (3.7.4 real)
 *   publish      — recording complete + description input + Transform
 *   type-input   — multiline text input + Transform
 *   publishing   — 2.5s spin animation while POST in flight
 *   analyzing    — 2s spin animation while card is generated
 *   insight      — score + flippable card + B/C blocks + tasks + Done
 *
 * Stage 3.7.4 — recording phase real audio + permission flow.
 * Stage 3.7.5+ — publish / type-input / publishing / analyzing / insight real UI + API.
 */

import { useEffect, useRef, useState, useMemo} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  InteractionManager
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets } from 'expo-audio';
import type { AudioRecorder } from 'expo-audio';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import {
  PRICING_TIERS,
  MIN_RECORDING_SECONDS,
  MIN_TYPED_CHARS,
  idToSlug,
  type PricingTierKey,
} from '@novame/core';

import { haptics } from '@/lib/haptics';
import { apiClient } from '@/lib/api';
import { getCurrentSession } from '@/lib/auth';
import { getCachedAssetUri } from '@/lib/asset-cache';
import { clearCachedCharacterState, fetchCharacterState} from '@/lib/character-state';
import { emitHomeRefresh } from '@/lib/home-refresh-signal';
import { incrementPublishCount, getPublishCount } from '@/lib/publish-count';
import { getTaskCompletionCount } from '@/lib/task-completion-count';
import {
  shouldShowRatingPrompt,
  markRatingPromptShown,
  emitRatingPromptRequest,
} from '@/lib/rating-prompt';
import { peekSkinUnlockQueueHead } from '@/lib/skin-unlock-store';
import {
  configureAudioSession,
  prepareAndStart,
  pauseRecording,
  resumeRecording,
  stopRecording,
  cancelRecording as cancelRecorder,
  formatDuration,
  type RecordingResult,
} from '@/lib/audio-recorder';
import {
  requestMicPermission,
  openAppSettings,
} from '@/lib/permissions';
import { getCachedSubscriptionTier } from '@/lib/subscription';
import { storage } from '@/lib/storage';
import { fetchDailyLimit } from '@/lib/daily-limit-api';
import { invalidateDailyTasks } from '@/lib/daily-tasks-api';
import { getCachedWisdoms, invalidateWisdoms } from '@/lib/wisdoms-api';
import { invalidateLeaderboard } from '@/lib/leaderboard-api';
import { invalidateUserStats } from '@/lib/user-stats-api';
import { invalidateSeekQuestions } from '@/lib/seek-questions-cache';
import { ApiError } from '@novame/api-client';
import { fetchMeStats, invalidateMeStats } from '@/lib/me-stats';
import { CardSpinAnimation } from '@/components/cards/CardSpinAnimation';
import { Confetti } from '@/components/cards/Confetti';
import { FlippableCard } from '@/components/cards/FlippableCard';
import {
  InsightView,
  type AspireImpactDisplay,
  type CardCollectionInfo,
} from '@/components/insight/insight-view';

// ---- Phase state machine ----

const PHASE = {
  CHOOSE: 'choose',
  RECORDING: 'recording',
  PUBLISH: 'publish',
  TYPE_INPUT: 'type-input',
  PUBLISHING: 'publishing',
  ANALYZING: 'analyzing',
  INSIGHT: 'insight',
} as const;

type Phase = (typeof PHASE)[keyof typeof PHASE];

// ---- Phase-shared props ----

type PhaseProps = {
  recorder: AudioRecorder;
  recordingDurationSec: number;
  setRecordingDurationSec: (n: number) => void;
  recordingResult: RecordingResult | null;
  setRecordingResult: (r: RecordingResult | null) => void;
  description: string;
  setDescription: (s: string) => void;
  typedText: string;
  setTypedText: (s: string) => void;
  publishedCard: PublishedCardData | null;
  setPublishedCard: (c: PublishedCardData | null) => void;
  publishedCardCollection: CardCollectionInfo | null;
  setPublishedCardCollection: (c: CardCollectionInfo | null) => void;
  publishedAspireImpact: AspireImpactDisplay | null;
  setPublishedAspireImpact: (a: AspireImpactDisplay | null) => void;
  communityCount: number;
  publishedEmotion: string;
  setPublishedEmotion: (s: string) => void;
  lastPublishMessage: string | null;
  setLastPublishMessage: (s: string | null) => void;
  goTo: (next: Phase) => void;
  close: () => void;
  showMicDenied: () => void;
  // Seek-question context. Populated when this modal was opened from
  // Discover or Question Detail's "Offer Wisdom" CTA. Phases that
  // publish wisdom (PhasePublishing) read these to forward forceKeyword
  // + seekQuestionId to /api/publish-wisdom.
  seekForceKeyword?: string;
  seekQuestionId?: string;
  seekQuestionText?: string;
  // Stage 5.IAP.5 (Bug #1): aggressive-upsell signal. PhasePublishing
  // sets this when the publish consumed the last quota slot;
  // PhaseInsight close handler reads it.
  setQuotaExhaustedAfterPublish?: (v: boolean) => void;
  quotaExhaustedAfterPublish?: boolean;
};

// ---- Placeholder primitives (used by phases not yet rewritten) ----

function PlaceholderButton({
  label,
  onPress,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const bg =
    variant === 'primary'
      ? '#A855F7'
      : variant === 'secondary'
        ? 'rgba(255,255,255,0.08)'
        : 'transparent';
  const color = variant === 'ghost' ? 'rgba(255,255,255,0.5)' : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        phStyles.button,
        { backgroundColor: bg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[phStyles.buttonLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function PhaseFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={phStyles.frame}>
      <Text style={phStyles.frameTitle}>{title}</Text>
      {subtitle ? <Text style={phStyles.frameSubtitle}>{subtitle}</Text> : null}
      <View style={phStyles.frameBody}>{children}</View>
    </View>
  );
}

const phStyles = StyleSheet.create({
  frame: {
    flex: 1,
    paddingHorizontal: 32,
    // Stage 6.RecordVisual: bumped from 80 -> 120. Record screen is a
    // 'fullScreenModal' presentation (no swipe-down dismiss, see
    // (main)/_layout.tsx). fullScreenModal extends to status bar so
    // PhaseFrame needs generous top padding for breathing room.
    paddingTop: 120,
    paddingBottom: 40,
    alignItems: 'center',
  },
  frameTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  frameSubtitle: {
    // Stage 6.RecordVisual: bumped contrast from 0.4 -> 0.85 — pale white
    // on the purple background was hard to read.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    marginBottom: 32,
    textAlign: 'center',
  },
  frameBody: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    gap: 14,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
});

// ---- Phase: choose (3.7.3 + permission flow added in 3.7.4) ----

function PhaseChoose({ goTo, close, showMicDenied, seekForceKeyword }: PhaseProps) {
  const [requesting, setRequesting] = useState(false);

  // Stage 5.IAP.4: pre-flight quota check. If the user is at or over
  // their monthly insight quota, close this modal and push the
  // paywall. We do NOT block on the request -- if it fails (network),
  // we fall through to letting the user record/type and let the
  // server-side gate in publish-wisdom catch it.
  const checkQuotaThenAdvance = async (
    next: typeof PHASE.RECORDING | typeof PHASE.TYPE_INPUT,
  ): Promise<void> => {
    try {
      const session = await getCurrentSession();
      const userId = session?.user?.id;
      if (!userId) {
        // No session shouldn't happen at this point but if it does,
        // skip the check rather than block.
        goTo(next);
        return;
      }
      const limit = await fetchDailyLimit(userId);
      if (!limit.allowed) {
        haptics.warning();
        close();
        // Wait one tick so the close animation can begin before we
        // push the paywall on top of the modal stack.
        setTimeout(() => {
          router.push('/(main)/(modals)/subscription-paywall');
        }, 100);
        return;
      }
    } catch (e) {
      console.warn('[record/choose] quota pre-check failed:', e);
      // fall through -- server will block if actually over.
    }
    goTo(next);
  };

  const handleRecordTap = async () => {
    if (requesting) return;
    haptics.light();
    setRequesting(true);
    try {
      const res = await requestMicPermission();
      if (res.granted) {
        await checkQuotaThenAdvance(PHASE.RECORDING);
      } else if (!res.canAskAgain) {
        // System will not show prompt again — direct user to Settings.
        showMicDenied();
      } else {
        // User actively denied this prompt; stay on choose phase.
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleTypeTap = () => {
    void haptics.light();
    void checkQuotaThenAdvance(PHASE.TYPE_INPUT);
  };

  return (
    <View style={chooseStyles.root}>
      {seekForceKeyword ? (
        <View style={chooseStyles.seekKeywordPillWrap}>
          <View style={chooseStyles.seekKeywordPill}>
            <Text style={chooseStyles.seekKeywordPillText}>{seekForceKeyword}</Text>
          </View>
        </View>
      ) : null}
      <View style={chooseStyles.headerBlock}>
        <Text style={chooseStyles.title}>
          {seekForceKeyword ? 'Share Your Wisdom' : 'Release Your Day'}
        </Text>
        <Text style={chooseStyles.subtitle}>
          {seekForceKeyword
            ? 'Offer a moment/a thought in your life that that can create the wisdom to answer the question.'
            : 'Share a moment you witnessed, an action you took, or a thought that\u2019s lingering in your mind.'}
        </Text>
      </View>

      <View style={chooseStyles.recordBlock}>
        <Pressable
          onPress={handleRecordTap}
          disabled={requesting}
          style={({ pressed }) => [
            chooseStyles.micButton,
            {
              opacity: requesting ? 0.6 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
        >
          <MaterialIcons name="mic" size={36} color="#FFFFFF" />
          <Text style={chooseStyles.micLabel}>Record</Text>
        </Pressable>
        <Text style={chooseStyles.recordHint}>Tap to start recording</Text>
      </View>

      <View style={chooseStyles.typeBlock}>
        <Pressable
          onPress={handleTypeTap}
          style={({ pressed }) => [
            chooseStyles.typeButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <MaterialIcons
            name="edit-note"
            size={22}
            color="#1F1147"
          />
          <Text style={chooseStyles.typeLabel}>Type instead</Text>
        </Pressable>
        <Text style={chooseStyles.typeHint}>
          Not feeling like speaking right now?
        </Text>
      </View>

      <Pressable onPress={() => { void haptics.light(); close(); }} style={chooseStyles.cancelButton}>
        <Text style={chooseStyles.cancelLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const chooseStyles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    // Stage 6.RecordVisual: bumped 84 -> 110 for breathing room on fullScreenModal.
    paddingTop: 110,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBlock: {
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    // Stage 6.RecordVisual: high-contrast subtitle on purple bg.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 8,
  },
  recordBlock: {
    alignItems: 'center',
  },
  micButton: {
    // Stage 6.RecordVisual: was '#A855F7' (purple) — invisible on purple bg.
    // Pink is the brand primary CTA color used across the record flow.
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 12,
    marginBottom: 18,
  },
  micLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    marginTop: 4,
  },
  recordHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  typeBlock: {
    alignItems: 'center',
  },
  typeButton: {
    // Stage 6.RecordVisual: white pill (secondary CTA per ux spec).
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
  },
  typeLabel: {
    color: '#1F1147',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  typeHint: {
    // Stage 6.RecordVisual: bumped from 0.2 (invisible) to 0.7 + size 14.
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  cancelLabel: {
    // Stage 6.RecordVisual: high-contrast white for the dismiss action.
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  seekKeywordPillWrap: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 4,
  },
  seekKeywordPill: {
    // Stage 6.RecordVisual: white pill on purple bg with pink-tinted text
    // for the seek-question context label.
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  seekKeywordPillText: {
    color: '#EC4899',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

// ---- Phase: recording (3.7.4 real UI + real audio) ----
//
// 1:1 visual parity with old RecordOverlay.js phase === 'recording'
// (lines 599-683). Real audio via expo-audio's AudioRecorder, driven
// by our imperative wrapper in src/lib/audio-recorder.ts.
//
// Lifecycle:
//   - mount: configureAudioSession → prepareAndStart(recorder) → start
//     100ms tick interval that updates recordingDurationSec.
//   - pause/resume: pauseRecording / resumeRecording (audio-recorder
//     wrapper) + stop/start the tick interval, preserving paused offset.
//   - save: stop ticking → stopRecording → if duration < 20s show min
//     warning and stay; else commit RecordingResult and goTo publish.
//   - cancel: stop ticking → cancelRecording (deletes file) → close.
//   - max-second auto-save: if recordingDurationSec >= maxSeconds while
//     active, fire handleSave automatically (matches old behavior).
//
// Subscription tier drives maxSeconds + bottom hint:
//   - tierLimits.maxSecondsPerRecord — Bug #2 fix: read from PRICING_TIERS
//     instead of the old hardcoded 600. Free/Basic = 300s, Pro/Ultra = 600s.
//   - tierLimits.name — Bug #1 fix: bottom hint shows "Plan: Free" instead
//     of fake "Today: X left" (old RecordOverlay relied on a window global
//     that was never assigned, displaying stale daily-remaining info).
//
// SVG progress ring matches the web version's geometry exactly:
//   viewBox 260x260, R=115, glowing dot at progress tip, gradient
//   #7C3AED → #A855F7 → #C084FC.

const RING_RADIUS = 115;
const RING_CENTER = 130;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function PhaseRecording({
  recorder,
  recordingDurationSec,
  setRecordingDurationSec,
  setRecordingResult,
  goTo,
  close,
}: PhaseProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [showMinWarning, setShowMinWarning] = useState(false);
  const [errored, setErrored] = useState(false);

  // Subscription tier — read once at mount. Stale-while-revalidate is
  // fine here; tier changes via IAP are rare and a paywall flow that
  // happens between phases will refresh the cache before next entry.
  const tier: PricingTierKey = getCachedSubscriptionTier();
  const tierLimits = PRICING_TIERS[tier];
  const maxSeconds = tierLimits.maxSecondsPerRecord;

  // Timer refs — startTimeMs anchors the wall clock at recording start
  // (re-anchored on every resume). pausedAccumMs holds total paused-out
  // milliseconds so duration reads are wall-clock-stable across pauses.
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtMsRef = useRef<number>(0);
  const pausedAccumMsRef = useRef<number>(0);
  const pauseStartedAtMsRef = useRef<number | null>(null);

  // Track whether we've already triggered a save to prevent double-fire
  // from the max-seconds effect racing with a manual Save tap.
  const savingRef = useRef(false);

  const stopTick = () => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  };

  const startTick = () => {
    stopTick();
    tickIntervalRef.current = setInterval(() => {
      const elapsedMs =
        Date.now() - startedAtMsRef.current - pausedAccumMsRef.current;
      setRecordingDurationSec(Math.floor(elapsedMs / 1000));
    }, 100);
  };

  // Mount: configure session, prepare, start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await configureAudioSession();
        if (cancelled) return;
        await prepareAndStart(recorder);
        if (cancelled) return;
        startedAtMsRef.current = Date.now();
        pausedAccumMsRef.current = 0;
        setRecordingDurationSec(0);
        startTick();
      } catch (err) {
        console.error('[record] failed to start:', err);
        setErrored(true);
      }
    })();

    return () => {
      cancelled = true;
      stopTick();
      // Unmount cleanup — best-effort cancel. If user already pressed
      // Save (savingRef true), let the save flow own the recorder.
      if (!savingRef.current) {
        void cancelRecorder(recorder);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePauseToggle = () => {
    haptics.light();
    if (isPaused) {
      // Resume: account for pause duration so timer stays consistent.
      if (pauseStartedAtMsRef.current !== null) {
        pausedAccumMsRef.current += Date.now() - pauseStartedAtMsRef.current;
        pauseStartedAtMsRef.current = null;
      }
      try {
        resumeRecording(recorder);
        startTick();
        setIsPaused(false);
      } catch (err) {
        console.error('[record] resume failed:', err);
        setErrored(true);
      }
    } else {
      // Pause: stop tick first so duration display freezes immediately.
      stopTick();
      pauseStartedAtMsRef.current = Date.now();
      try {
        pauseRecording(recorder);
        setIsPaused(true);
      } catch (err) {
        console.error('[record] pause failed:', err);
        setErrored(true);
      }
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (recordingDurationSec < MIN_RECORDING_SECONDS) {
      setShowMinWarning(true);
      setTimeout(() => setShowMinWarning(false), 3000);
      haptics.warning();
      return;
    }
    savingRef.current = true;
    haptics.medium();
    stopTick();
    try {
      const result = await stopRecording(recorder);
      // Android SDK 54 zero-byte issue (expo/expo#39646): if the file
      // claims 0 bytes we treat as failure. iOS not affected.
      if (result.sizeBytes === 0) {
        console.error(
          '[record] stop produced zero-byte file — likely Android bug',
        );
        setErrored(true);
        savingRef.current = false;
        return;
      }
      setRecordingResult(result);
      goTo(PHASE.PUBLISH);
    } catch (err) {
      console.error('[record] save failed:', err);
      setErrored(true);
      savingRef.current = false;
    }
  };

  const handleCancel = () => {
    haptics.light();
    stopTick();
    void cancelRecorder(recorder);
    close();
  };

  // Auto-save when duration crosses tier max. Equivalent to the old
  // useEffect that called handleSave when recordingTime >= maxSeconds.
  useEffect(() => {
    if (
      recordingDurationSec >= maxSeconds &&
      !isPaused &&
      !savingRef.current &&
      !errored
    ) {
      void handleSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingDurationSec, maxSeconds, isPaused, errored]);

  // ---- ring math ----
  const progress = Math.min(recordingDurationSec / maxSeconds, 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  // Glowing dot position (clockwise from top, -90deg origin)
  const angleDeg = progress * 360 - 90;
  const angleRad = (angleDeg * Math.PI) / 180;
  const dotX = RING_CENTER + RING_RADIUS * Math.cos(angleRad);
  const dotY = RING_CENTER + RING_RADIUS * Math.sin(angleRad);

  const secsLeftToMin = Math.max(
    0,
    MIN_RECORDING_SECONDS - recordingDurationSec,
  );

  if (errored) {
    return (
      <View style={recStyles.root}>
        <View style={recStyles.errorBlock}>
          <Text style={recStyles.errorTitle}>Recording failed</Text>
          <Text style={recStyles.errorBody}>
            Something went wrong. Please try again.
          </Text>
          <Pressable
            onPress={() => { void haptics.light(); close(); }}
            style={({ pressed }) => [
              recStyles.errorButton,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={recStyles.errorButtonLabel}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={recStyles.root}>
      {/* Top "Recording" indicator */}
      <View style={recStyles.topIndicator}>
        <View style={recStyles.topIndicatorRow}>
          <View style={recStyles.recDot} />
          <Text style={recStyles.recLabel}>RECORDING</Text>
        </View>
      </View>

      {/* Circular progress timer */}
      <View style={recStyles.ringWrap}>
        <Svg width={260} height={260} viewBox="0 0 260 260">
          <Defs>
            {/* Stage 6.RecordVisual: was purple gradient (invisible on purple bg).
                Pink gradient now contrasts against the new background. */}
            <LinearGradient id="recGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#F472B6" />
              <Stop offset="50%" stopColor="#EC4899" />
              <Stop offset="100%" stopColor="#DB2777" />
            </LinearGradient>
          </Defs>
          {/* White inner disc fills the ring interior so the timer digits
              sit on a clean white surface against the purple bg.
              Radius = RING_RADIUS - strokeWidth/2 - 4 so it tucks neatly
              inside the progress arc without overlapping the stroke. */}
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS - 7}
            fill="#FFFFFF"
          />
          {/* Background track. Stage 6.RecordVisual: white-tint for contrast
              against the new purple background. */}
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={6}
          />
          {/* Progress arc — rotated -90deg via origin so it starts at top */}
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke="url(#recGrad)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${RING_CIRCUMFERENCE}`}
            strokeDashoffset={`${dashOffset}`}
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
          />
          {/* Glowing dot at progress tip. Stage 6.RecordVisual: pink glow. */}
          {progress > 0.005 ? (
            <>
              <Circle cx={dotX} cy={dotY} r={8} fill="rgba(236,72,153,0.4)" />
              <Circle cx={dotX} cy={dotY} r={5} fill="#F472B6" />
            </>
          ) : null}
        </Svg>
        {/* Centered timer */}
        <View pointerEvents="none" style={recStyles.timerCenter}>
          <Text style={recStyles.timerText}>
            {formatDuration(recordingDurationSec)}
          </Text>
        </View>
      </View>

      {/* Min warning + plan/limit hint */}
      <View style={recStyles.hintBlock}>
        {secsLeftToMin > 0 ? (
          <Text
            style={[
              recStyles.minHint,
              showMinWarning ? recStyles.minHintWarning : null,
            ]}
          >
            Min 20s required ({secsLeftToMin}s left)
          </Text>
        ) : null}
        <Text style={recStyles.planHint}>
          Max: {formatDuration(maxSeconds)} · Plan: {tierLimits.name}
        </Text>
      </View>

      {/* Bottom controls: Cancel / Pause / Save */}
      <View style={recStyles.controls}>
        <View style={recStyles.controlSlot}>
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [
              recStyles.smallButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <MaterialIcons name="close" size={26} color="#1F1147" />
          </Pressable>
          <Text style={recStyles.smallLabel}>CANCEL</Text>
        </View>

        <View style={recStyles.controlSlot}>
          <Pressable
            onPress={handlePauseToggle}
            style={({ pressed }) => [
              recStyles.bigButton,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <MaterialIcons
              name={isPaused ? 'play-arrow' : 'pause'}
              size={34}
              color="#FFFFFF"
            />
          </Pressable>
          <Text style={recStyles.smallLabel}>
            {isPaused ? 'RESUME' : 'PAUSE'}
          </Text>
        </View>

        <View style={recStyles.controlSlot}>
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [
              recStyles.smallButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <MaterialIcons name="check" size={26} color="#1F1147" />
          </Pressable>
          <Text style={recStyles.smallLabel}>SAVE</Text>
        </View>
      </View>
    </View>
  );
}

const recStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    // Stage 6.RecordVisual: 56 -> 90 for fullScreenModal status-bar clearance.
    paddingTop: 90,
    paddingBottom: 48,
  },
  topIndicator: {
    alignItems: 'center',
    marginBottom: 28,
  },
  topIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recDot: {
    // Stage 6.RecordVisual: red kept — universal "recording" semantic.
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.5,
  },
  ringWrap: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  timerCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerText: {
    // Stage 6.RecordVisual: deep-purple text sits on the new white inner
    // disc of the ring (white digits on white bg would be invisible).
    color: '#1F1147',
    fontSize: 64,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  hintBlock: {
    alignItems: 'center',
    marginTop: 28,
    height: 52,
  },
  minHint: {
    // Stage 6.RecordVisual: bumped contrast 0.6 -> 0.9 + size 13 -> 15.
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  minHintWarning: {
    color: '#FCA5A5',
  },
  planHint: {
    // Stage 6.RecordVisual: bumped 0.3 -> 0.7 + size 12 -> 14.
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 32,
    marginTop: 'auto',
  },
  controlSlot: {
    alignItems: 'center',
    gap: 8,
  },
  smallButton: {
    // Stage 6.RecordVisual: secondary CTA — white background + deep-purple icon.
    // Larger 60 (was 56) for better tap target.
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  bigButton: {
    // Stage 6.RecordVisual: primary CTA — pink (was purple, invisible on
    // purple bg). Slightly larger 68 (was 64).
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 8,
  },
  smallLabel: {
    // Stage 6.RecordVisual: bumped 0.3 -> 0.85 + 10 -> 12 for legibility.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  errorBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  errorBody: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorButton: {
    // Stage 6.RecordVisual: pink primary on purple bg.
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#EC4899',
  },
  errorButtonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
});

// ---- Phase: publish (3.7.5 real UI) ----
//
// Shown after a successful recording stop. The user reviews the duration,
// optionally adds a short description, and confirms with Transform.
// Transform pushes us to the publishing phase, where 3.7.7 will fire the
// real /api/publish-wisdom POST.
//
// Cancel deletes the on-disk recording file and dismisses the modal.
// No confirmation dialog — getting here required pressing Save in the
// recording phase, so Cancel here is a deliberate "discard" action.

function PhasePublish({
  recorder,
  recordingDurationSec,
  description,
  setDescription,
  goTo,
  close,
}: PhaseProps) {
  const handleTransform = () => {
    haptics.medium();
    Keyboard.dismiss();
    goTo(PHASE.PUBLISHING);
  };

  const handleCancel = () => {
    haptics.light();
    Keyboard.dismiss();
    void cancelRecorder(recorder);
    close();
  };

  const handleDismissKeyboard = () => {
    Keyboard.dismiss();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={pubStyles.root}
      keyboardVerticalOffset={0}
    >
      <TouchableWithoutFeedback onPress={handleDismissKeyboard} accessible={false}>
        <View style={pubStyles.body}>
          <View style={pubStyles.iconCircle}>
            <MaterialIcons name="mic" size={34} color="#1F1147" />
          </View>
          <Text style={pubStyles.title}>Recording Complete</Text>
          <Text style={pubStyles.duration}>
            {formatDuration(recordingDurationSec)} recorded
          </Text>

          <Pressable
            onPress={handleTransform}
            style={({ pressed }) => [
              pubStyles.primaryButton,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={pubStyles.primaryLabel}>Transform</Text>
          </Pressable>

          <Pressable onPress={handleCancel} style={pubStyles.cancelButton}>
            <Text style={pubStyles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const pubStyles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 32,
    // Stage 6.RecordVisual: 64 -> 100 for fullScreenModal status-bar clearance.
    paddingTop: 100,
    paddingBottom: 48,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    // Stage 6.RecordVisual: white surface for the mic indicator.
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    marginBottom: 6,
  },
  duration: {
    // Stage 6.RecordVisual: bumped contrast 0.4 -> 0.85.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginBottom: 36,
  },
  descInput: {
    // Stage 6.RecordVisual: white optional-description input.
    width: '100%',
    minHeight: 88,
    maxHeight: 160,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    color: '#1F1147',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  primaryButton: {
    // Stage 6.RecordVisual: pink primary CTA.
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 8,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  cancelButton: {
    paddingVertical: 12,
    marginTop: 18,
  },
  cancelLabel: {
    // Stage 6.RecordVisual: high-contrast white for dismiss.
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});

// ---- Phase: type-input (3.7.6 real UI) ----
//
// Parallel input path to recording. The user types their wisdom directly
// instead of speaking it. Selected from choose phase via "Type instead".
//
// Layout:
//   - top bar: back arrow (returns to choose), title, spacer
//   - large multiline textarea (autofocus, char counter)
//   - description input (optional, single-line, 200-char cap)
//   - Transform primary button (disabled until typedText.length >= MIN_TYPED_CHARS)
//
// Tier-driven limits:
//   - typedText cap = tierLimits.dailyTypeChars (Free 2000 / Basic 3000 /
//     Pro/Ultra 5000). Server publish-wisdom is the authoritative quota
//     check; this maxLength is just a UI-side safeguard so we don't send
//     pointlessly-large blobs over the wire.
//   - MIN_TYPED_CHARS = 10 — enforced as button disabled state.
//
// Cancel from choose phase already handles modal dismiss; this phase
// only offers Back (to choose) — no separate Cancel needed since the
// recording file doesn't exist in this branch.

function PhaseTypeInput({
  typedText,
  setTypedText,
  description,
  setDescription,
  goTo,
}: PhaseProps) {
  const tier: PricingTierKey = getCachedSubscriptionTier();
  const tierLimits = PRICING_TIERS[tier];
  const maxChars = tierLimits.dailyTypeChars;

  const trimmedLength = typedText.trim().length;
  const canTransform = trimmedLength >= MIN_TYPED_CHARS;
  const insets = useSafeAreaInsets();

  // Stage 3.10.x: keyboardVerticalOffset = top safe-area inset so the
  // input + Transform button stay above the keyboard. iOS modals have
  // a status-bar offset KeyboardAvoidingView doesn't auto-detect.

  // Stage 3.10.x draft persistence: typedText is mirrored to MMKV on
  // every keystroke; cleared only on successful submit (handleTransform
  // path that goTo PUBLISHING). Back / dismiss / accidental close all
  // preserve the draft so users don't lose their work.

  const handleBack = () => {
    haptics.light();
    Keyboard.dismiss();
    goTo(PHASE.CHOOSE);
  };

  const handleTransform = () => {
    if (!canTransform) return;
    haptics.medium();
    Keyboard.dismiss();
    goTo(PHASE.PUBLISHING);
  };

  const handleDismissKeyboard = () => {
    Keyboard.dismiss();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={typeStyles.root}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <TouchableWithoutFeedback onPress={handleDismissKeyboard} accessible={false}>
        <View style={typeStyles.fullArea}>
          <View style={typeStyles.header}>
            <Pressable
              onPress={handleBack}
              style={({ pressed }) => [
                typeStyles.backButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <MaterialIcons name="arrow-back" size={24} color="#1F1147" />
            </Pressable>
            <Text style={typeStyles.headerTitle}>Unload Your Mind Here</Text>
            <View style={typeStyles.headerSpacer} />
          </View>

          <ScrollView
            style={typeStyles.body}
            contentContainerStyle={typeStyles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TextInput
              value={typedText}
              onChangeText={setTypedText}
              placeholder="What happened around you... and what shifted inside you?"
              placeholderTextColor="rgba(31,17,71,0.4)"
              maxLength={maxChars}
              multiline
              autoFocus
              textAlignVertical="top"
              style={[typeStyles.mainInput, typeStyles.mainInputFlex]}
            />
            <View style={typeStyles.counterRow}>
              <Text style={typeStyles.counterText}>
                Daily limit: {maxChars.toLocaleString()} chars
              </Text>
              <Text style={typeStyles.counterText}>
                {typedText.length.toLocaleString()}/{maxChars.toLocaleString()}
              </Text>
            </View>
          </ScrollView>

          <View style={typeStyles.footer}>
            <Pressable
              onPress={handleTransform}
              disabled={!canTransform}
              style={({ pressed }) => [
                typeStyles.primaryButton,
                {
                  opacity: !canTransform ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={typeStyles.primaryLabel}>Transform</Text>
            </Pressable>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const typeStyles = StyleSheet.create({
  root: {
    flex: 1,
    // Stage 6.RecordVisual: 16 -> 80 for fullScreenModal status-bar clearance.
    paddingTop: 80,
  },
  fullArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    // Stage 6.RecordVisual: white circular back button.
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingBottom: 12,
  },
  mainInput: {
    // Stage 6.RecordVisual: white textarea + deep-purple text (was a
    // semi-transparent dark surface that was invisible on the new
    // purple bg).
    color: '#1F1147',
    fontSize: 17,
    fontFamily: 'Inter_400Regular',
    lineHeight: 24,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  mainInputFlex: {
    // Stage 3.10.x: input fills remaining space above keyboard.
    flex: 1,
    minHeight: 280,
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  counterText: {
    // Stage 6.RecordVisual: high-contrast on purple bg.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
  },
  descInput: {
    // Stage 6.RecordVisual: white optional-description input.
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    color: '#1F1147',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  primaryButton: {
    // Stage 6.RecordVisual: pink primary CTA (was purple, invisible).
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
});

// ---- Publish lifecycle (3.7.7) ----
//
// publishing → analyzing → insight is a single network-driven flow.
// We split it into two visual phases so the user feels the difference
// between "uploading + transcribing" and "AI generating insight".
// The actual server call is a single POST /api/publish-wisdom returning
// { wisdom, card, characterBMessage }.
//
// Privacy model: NovaMe wisdoms are always private (user-only). The
// public/social surface (Discover feed, likes, comments) was removed
// from the product. We do not send isPublic — server will treat the
// field as absent and persist the wisdom as private.
//
// Side effects fired after publish succeeds (fire-and-forget):
//   - POST /api/character-state action='record_complete' → wp/exp/level
//   - POST /api/daily-tasks action='create' → daily task entries from card
//
// (character-message is generated server-side inside publish-wisdom and
// written to profiles.character_b_message — no separate client call.)
//
// Side-effect failures are warn-logged and swallowed. The user must see
// the insight regardless. Worst case, character state self-corrects on
// the next /api/character-state GET (Home tab refresh interval).
//
// Seek context (forceKeyword / seekQuestionId): NOT wired in 3.7.7.
// Will be added in 3.9 when SeekView triggers record entry.

type PublishWisdomResponse = {
  success: boolean;
  wisdom?: {
    id: string;
    audioUrl?: string;
    text?: string;
    categories?: string[];
    duration?: number;
  };
  card?: {
    id?: string;
    keyword?: string;
    keyword_id?: string;
    quote_short?: string;
    insight_full?: string;
    // Legacy fields — kept so this response type still describes
    // wisdoms generated by older server versions during a rolling
    // deploy. New wisdoms have these null and use reframe instead.
    card_b?: string;
    card_c?: string;
    task_1?: string;
    task_2?: string;
    task_1_keyword?: string;
    task_2_keyword?: string;
    wisdom_emotion?: string;
    // Stage 6: 3-part Core Reframing + reflective question + aspire
    // impacts (rendered in the redesigned InsightView).
    reframe?: {
      mirror_hook: { title: string; body: string };
      flipped_lens: { title: string; body: string };
      permission_slip: { title: string; body: string };
    } | null;
    reflective_question?: {
      validation: string;
      question: string;
    } | null;
    aspire_impacts?: Array<{ keyword: string; direction: 'positive' | 'negative' }> | null;
  } | null;
  // Stage 6: post-update aspire_scores snapshot from the server, used
  // to size the Aspire progress bar in the insight page. Null when
  // this wisdom didn't touch any aspire keywords.
  aspireScores?: Record<string, number> | null;
  characterBMessage?: string | null;
  // Stage 5.WR.2 (Bug 1 fix): server returns this when this publish
  // consumed the user's last monthly quota slot. Mobile uses it to
  // trigger the post-publish paywall on PhaseInsight close, replacing
  // the earlier race-prone follow-up fetchDailyLimit pattern.
  quotaExhausted?: boolean;
};

type PublishedCardData = NonNullable<PublishWisdomResponse['card']>;

async function callPublishWisdom(args: {
  userId: string;
  isTyped: boolean;
  description: string;
  // record-mode fields (ignored when isTyped)
  audioUri?: string;
  durationSec?: number;
  // typed-mode fields (ignored when !isTyped)
  text?: string;
  // Seek-question fields. Forwarded to /api/publish-wisdom so the
  // server pins card art to the question's tag (forceKeyword) and
  // links the new card into seek_question_cards (seekQuestionId).
  forceKeyword?: string | null;
  seekQuestionId?: string | null;
}): Promise<PublishWisdomResponse> {
  if (args.isTyped) {
    return apiClient.post<PublishWisdomResponse>('/api/publish-wisdom', {
      userId: args.userId,
      text: args.text ?? '',
      description: args.description,
      isTyped: true,
      forceKeyword: args.forceKeyword ?? null,
      seekQuestionId: args.seekQuestionId ?? null,
    });
  }

  // Record mode: multipart with the on-disk audio file. RN's FormData
  // accepts a { uri, name, type } object as a "file" field — the bridge
  // wraps this into a multipart blob before sending.
  const fd = new FormData();
  const filename = `wisdom-${Date.now()}.m4a`;
  fd.append('audio', {
    uri: args.audioUri ?? '',
    name: filename,
    type: 'audio/m4a',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  fd.append('userId', args.userId);
  fd.append('duration', String(args.durationSec ?? 0));
  fd.append('description', args.description);
  if (args.forceKeyword) fd.append('forceKeyword', args.forceKeyword);
  if (args.seekQuestionId) fd.append('seekQuestionId', args.seekQuestionId);

  return apiClient.post<PublishWisdomResponse>('/api/publish-wisdom', fd);
}

async function fireRecordCompleteSideEffects(args: {
  userId: string;
  card: PublishedCardData | null;
}): Promise<void> {
  // Stage 6: wisdomScore parameter removed. The server-side
  // record_complete action no longer awards EXP based on a per-wisdom
  // AI score — EXP is now earned from completing daily tasks only.
  // What the call still does (unchanged):
  //   - increments total_recording_seconds / total_cards_created
  //   - restores WP to 100 + bumps last_recording_at (drives Home's
  //     hungry -> chill mode swap on the character animation)
  apiClient
    .post('/api/character-state', {
      userId: args.userId,
      action: 'record_complete',
    })
    .catch((err) => console.warn('[publish] character-state failed:', err));

  // 2. daily-tasks — create wisdom tasks from card.task_1/task_2.
  if (args.card?.task_1 || args.card?.task_2) {
    const tasks: Array<{ text: string; keyword: string }> = [];
    if (args.card.task_1) {
      tasks.push({
        text: args.card.task_1,
        keyword: args.card.task_1_keyword ?? '',
      });
    }
    if (args.card.task_2) {
      tasks.push({
        text: args.card.task_2,
        keyword: args.card.task_2_keyword ?? '',
      });
    }
    apiClient
      .post('/api/daily-tasks', {
        userId: args.userId,
        action: 'create',
        tasks,
      })
      .catch((err) => console.warn('[publish] daily-tasks failed:', err));
  }
}

// ---- Phase: publishing (3.7.7 real publish call + 2.5s minimum hold) ----
//
// Runs the publish lifecycle. We start the network request immediately
// on mount, then guarantee at least 2500ms in this phase before moving
// to analyzing. The analyzing phase keeps spinning until the request
// resolves; insight is rendered with the real card data.
//
// We use an in-flight ref so React Strict Mode double-mount in dev
// doesn't fire two POSTs.

function PhasePublishing({
  recordingDurationSec,
  recordingResult,
  description,
  typedText,
  setPublishedCard,
  setPublishedEmotion,
  setPublishedCardCollection,
  setPublishedAspireImpact,
  setLastPublishMessage,
  goTo,
  close,
  seekForceKeyword,
  seekQuestionId,
  setQuotaExhaustedAfterPublish,
}: PhaseProps) {
  const inflightRef = useRef(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    const isTyped = !recordingResult; // entered from type-input branch
    const minHoldMs = 2500;

    (async () => {
      try {
        const session = await getCurrentSession();
        const userId = session?.user?.id;
        if (!userId) {
          throw new Error('No active session for publish');
        }

        const responsePromise = callPublishWisdom({
          userId,
          isTyped,
          description,
          audioUri: recordingResult?.uri,
          durationSec: recordingDurationSec,
          text: isTyped ? typedText.trim() : undefined,
          forceKeyword: seekForceKeyword || null,
          seekQuestionId: seekQuestionId || null,
        });

        // Guarantee ~2.5s minimum in publishing phase before showing
        // analyzing. The fetch may take less or more; we wait whichever
        // is longer.
        await new Promise((r) => setTimeout(r, minHoldMs));
        goTo(PHASE.ANALYZING);

        const response = await responsePromise;
        if (!response.success) {
          throw new Error('publish-wisdom returned non-success');
        }

        void fireRecordCompleteSideEffects({
          userId,
          card: response.card ?? null,
        });

        // Me-stats now stale (totalWords / totalCards / usedThisMonth /
        // totalExp all changed). Invalidate cache + fire silent refetch
        // so when the user returns to Home and opens Me, the numbers
        // are current. Stage 3.10.1.
        invalidateMeStats();
        void fetchMeStats(userId).catch(() => {});

        // Stage 6 SWR: publish creates 2 new daily tasks (task_1 / task_2).
        // Invalidate the daily-tasks cache so when the user returns to
        // Growth tab, the new tasks appear (cache-first read shows old
        // list instantly + background fetch swaps in fresh data).
        invalidateDailyTasks();

        // Stage 6 SWR: every Cold-data cache that publish makes stale.
        // None of these trigger an immediate fetch -- the user pays
        // network cost only for the pages they actually visit next
        // (lazy revalidation).
        invalidateWisdoms();         // My Logs (new wisdom row)
        invalidateLeaderboard();      // Ranking (totalMinutes/wisdomCount bump)
        invalidateUserStats();        // Assets (totalWords / uniqueKeywords)
        invalidateSeekQuestions();    // Discover feed (cards count badge)

        // Stage 5.WR.2 (Bug 1 fix): server-driven paywall trigger.
        // publish-wisdom now echoes a quotaExhausted flag synchronously
        // in its success response (true when usedThisMonth+1 >= monthlyLimit).
        // This replaces the earlier race-prone pattern of firing a
        // separate fetchDailyLimit RPC and setting state asynchronously
        // -- PhaseInsight could render and the user could close it
        // before the follow-up fetch resolved.
        if (response.quotaExhausted) {
          setQuotaExhaustedAfterPublish?.(true);
        }

        setPublishedCard(response.card ?? null);
        setPublishedEmotion(response.card?.wisdom_emotion ?? 'Reflective');

        // Stage 6: compute Card Collection notification data.
        // "isNewType" is true when the user has zero prior wisdoms in
        // this keyword. cachedWisdoms holds the user's My Logs feed
        // (excluding the wisdom we just published). After publish we
        // need to count *before* this wisdom to know whether it was
        // a first-of-its-kind.
        const cachedNow = getCachedWisdoms()?.wisdoms ?? [];
        const newKeywordId = response.card?.keyword_id ?? null;
        const priorSameKeyword = newKeywordId
          ? cachedNow.filter((w) => w.card?.keyword_id === newKeywordId).length
          : 0;
        const isNewType = priorSameKeyword === 0;
        const priorDistinctTypes = new Set(
          cachedNow
            .map((w) => w.card?.keyword_id)
            .filter((id): id is string => !!id),
        );
        const typesCollectedIncludingThis = isNewType
          ? priorDistinctTypes.size + 1
          : priorDistinctTypes.size;
        const displayKeyword =
          response.card?.keyword
          ?? (newKeywordId ? idToSlug(newKeywordId) ?? 'Wisdom' : 'Wisdom');
        setPublishedCardCollection({
          isNewType,
          keyword: displayKeyword,
          typesCollected: typesCollectedIncludingThis,
          cardsCollectedForKeyword: priorSameKeyword + 1,
        });

        // Stage 6: compute Aspire progress-bar data from response.
        // The server returned the *post-update* aspire_scores snapshot
        // alongside the card. We pick aspire_impacts[0] (the AI's
        // most-relevant impact for this wisdom) and look up its
        // current score in the snapshot.
        const impacts = response.card?.aspire_impacts ?? [];
        if (impacts.length > 0 && response.aspireScores) {
          const top = impacts[0];
          const currentScore = response.aspireScores[top.keyword] ?? 70;
          setPublishedAspireImpact({
            keyword: top.keyword,
            deltaPercent: top.direction === 'positive' ? 2 : -2,
            currentScore,
          });
        } else {
          setPublishedAspireImpact(null);
        }
        if (response.characterBMessage) {
          setLastPublishMessage(response.characterBMessage);
          // Stage 5.WR.2 (Bug 2 fix): persist the AI-generated
          // character message to MMKV with a timestamp. The home tab
          // speech bubble uses this within a 1-hour window before
          // falling back to the random wp/mode-based fallback lines.
          // New publishes within the hour refresh the timestamp, so
          // a user who publishes multiple wisdoms gets the latest
          // message and the window restarts.
          try {
            storage.set(
              'novame_last_publish_message',
              JSON.stringify({
                message: response.characterBMessage,
                timestampMs: Date.now(),
              }),
            );
          } catch (e) {
            console.warn('[publish] persist character message failed:', e);
          }
        }

        // Stage 3.10.x: clear typed-text draft only on successful publish.
        // All other exit paths (back, accidental dismiss, error retry)
        // preserve the draft.
        try {
          storage.remove('novame_record_typed_draft');
        } catch {
          // best-effort
        }

        goTo(PHASE.INSIGHT);
      } catch (err) {
        console.error('[publish] failed:', err);
        // Stage 5.IAP.4: typed error routing.
        //   - 402 QUOTA_EXCEEDED       -> close + paywall
        //   - 422 TRANSCRIPTION_FAILED -> show retryable error screen
        //   - 500 CARD_GENERATION_FAILED -> show retryable error screen
        //   - anything else            -> generic error screen
        if (err instanceof ApiError) {
          const code =
            typeof err.body === 'object' &&
            err.body !== null &&
            'code' in err.body
              ? (err.body as { code?: string }).code
              : undefined;

          if (err.status === 402 && code === 'QUOTA_EXCEEDED') {
            inflightRef.current = false;
            close();
            setTimeout(() => {
              router.push('/(main)/(modals)/subscription-paywall');
            }, 100);
            return;
          }
          // 422 (TRANSCRIPTION_FAILED) and 500 (CARD_GENERATION_FAILED)
          // both fall through to the generic errored screen, which
          // already gives the user a "try again" affordance. The
          // crucial difference vs the old behavior is that the server
          // has now ROLLED BACK the wisdom row, so the user is not
          // billed a quota slot for the failed attempt.
        }
        setErrored(true);
        inflightRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (errored) {
    return (
      <View style={pubgStyles.root}>
        <Text style={pubgStyles.errorTitle}>Publishing failed</Text>
        <Text style={pubgStyles.errorBody}>
          Something went wrong while saving your wisdom. Please try again.
        </Text>
        <Pressable
          onPress={() => { void haptics.light(); goTo(recordingResult ? PHASE.PUBLISH : PHASE.TYPE_INPUT); }}
          style={({ pressed }) => [
            pubgStyles.retryButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={pubgStyles.retryLabel}>Back</Text>
        </Pressable>
        <Pressable onPress={() => { void haptics.light(); close(); }} style={pubgStyles.closeButton}>
          <Text style={pubgStyles.closeLabel}>Close</Text>
        </Pressable>
      </View>
    );
  }

  // Stage 3.8.3.lottie.B (2025-11-XX): spinning UI moved to record.tsx
  // main render so the same CardSpinAnimation instance persists across
  // PUBLISHING -> ANALYZING phase transitions. Without this lift, the
  // Lottie animation would unmount + remount when phase flipped, causing
  // a visible flicker / restart from frame 0.
  //
  // PhasePublishing now renders ONLY the errored state. The success path
  // returns null and lets the main render's <CardSpinAnimation> show
  // through. Network side effects (publish-wisdom POST + state setters)
  // continue to live in this component's useEffect above.
  return null;
}

// ---- Phase: analyzing (3.7.7 real — keeps spinning until publish resolves) ----
//
// Visual-only — the publishing phase started the network call and will
// drive us to insight when it resolves. No new request fires here.

function PhaseAnalyzing(_props: PhaseProps) {
  // Stage 3.8.3.lottie.B: rendered as null. Spinning UI now lives in
  // the parent record.tsx main render so the same CardSpinAnimation
  // instance persists across PUBLISHING -> ANALYZING transition.
  // This component is kept (rather than deleted) for symmetry with the
  // phase enum and to leave room for future phase-specific behavior.
  return null;
}

const pubgStyles = StyleSheet.create({
  loaderHost: {
    // Stage 6.RecordVisual: was '#0A0820' deep-near-black. Transparent now
    // so root purple bg shows through (rootStyles.root is the source of truth).
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    gap: 12,
  },
  loaderTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 32,
  },
  loaderSub: {
    // Stage 6.RecordVisual: 0.7 -> #FFFFFF for legibility on purple bg.
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  loaderHint: {
    // Stage 6.RecordVisual: 0.4 -> 0.85.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  label1: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginTop: 12,
    textAlign: 'center',
  },
  label2: {
    // Stage 6.RecordVisual: 0.7 -> #FFFFFF.
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  sublabel: {
    // Stage 6.RecordVisual: 0.4 -> 0.85.
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorBody: {
    // Stage 6.RecordVisual: 0.5 -> #FFFFFF.
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    // Stage 6.RecordVisual: pink primary CTA.
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  closeButton: {
    paddingVertical: 12,
    marginTop: 8,
  },
  closeLabel: {
    // Stage 6.RecordVisual: 0.4 (invisible) -> #FFFFFF.
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});

// ---- Phase: insight (3.7.9 real UI) ----
//
// Final phase of the recording flow. Shows the AI-generated wisdom card
// returned by /api/publish-wisdom plus the user-impact metadata (score,
// emotion, daily tasks). Done dismisses the modal and triggers a Home
// tab refresh so the new wp/exp/level lands immediately.
//
// Layout (top to bottom, scrollable):
//   1. "WISDOM INSIGHT" title
//   2. Score ring + Wisdom Emotion (side-by-side)
//   3. FlippableCardStub (3.8 will swap to real 3D flip)
//   4. Card B — Feel Seen / Emotional Validation
//   5. Card C — Root Insight
//   6. Wisdom Tasks (only when card.task_1 / task_2 set)
//   7. Done primary button (sticky bottom)
//
// Server quirk: card_b and card_c arrive as "Title: <title>\n<body>"
// strings even though generate-card.js produces card_b_title and
// card_c_title as separate fields server-side, then re-merges them
// before returning. We regex out the title here. See backlog B48 for
// the server-side cleanup that would let us drop the regex.
//
// Done side effects:
//   - clearCachedCharacterState() — forces Home tab to re-fetch on
//     next mount, so the new wp/exp/level are visible immediately.
//   - Skin unlock detection (level cross threshold) — console.log
//     placeholder until 3.10 wires SkinUnlockOverlay.
//   - First-wisdom paywall (free user, first ever wisdom) — console.log
//     placeholder until 3.10 wires SubscriptionPaywall.




function PhaseInsight({

  publishedCard,
  publishedEmotion,
  publishedCardCollection,
  publishedAspireImpact,
  communityCount,
  close,
  quotaExhaustedAfterPublish,
}: PhaseProps) {
  // Stage 5.WR.2 (Bug 1 fix): start prefetching latest character state
  // the moment the insight screen renders. By the time the user reads
  // the wisdom card and taps Done (~5-30s typical), the fetch has
  // long completed and the home tab will read fresh data from cache
  // on next focus. If the user taps Done immediately (~1s), handleDone
  // awaits this promise so the cache is hot before close.
  const insets = useSafeAreaInsets();
  const prefetchRef = useRef<Promise<unknown> | null>(null);
  const [doneBusy, setDoneBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getCurrentSession();
      if (cancelled) return;
      const userId = session?.user?.id;
      if (!userId) return;
      // fetchCharacterState writes MMKV cache as a side effect.
      // We don't need the return value here; we only need the cache
      // to be hot when home tab reads it on focus.
      prefetchRef.current = fetchCharacterState(userId).catch((e) => {
        console.warn('[insight prefetch] fetchCharacterState failed:', e);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stage 5.IAP.5 (Bug #1, aggressive upsell): wrap close so that if
  // this publish consumed the user's last quota slot, we route to the
  // paywall instead of just dismissing. The 350ms delay lets the modal
  // dismiss animation start before the paywall presents.
  const handleClose = () => {
    // Stage 5.WR.2 (Bug 2 fix, third pass): emit home-refresh signal
    // on every close path. expo-router v6 doesn't fire useFocusEffect
    // on tab when modals open/close, so the home tab needs this
    // explicit signal to know its cached data may have changed.
    // Idempotent -- the home tab's subscriber reads cache + refetches,
    // both safe to repeat.
    emitHomeRefresh();

    // Stage 6.RatingPrompt: priority chain for post-publish modals --
    // only ONE should display. Anything higher than rating prompt
    // wins and we yield WITHOUT marking the prompt as shown, so the
    // next milestone gets a fresh shot.
    //
    //   1. Paywall (highest -- quota exhausted, business critical)
    //   2. Skin unlock (next -- celebrate level-up moment)
    //   3. Rating prompt (lowest -- yields to anything more important)

    if (quotaExhaustedAfterPublish) {
      // Stage 5.WR.2 (Bug 2 fix, FOURTH pass): industry-standard
      // modal-after-modal handling per Whitespectre RN modal guide
      // and react-native-modal Issue #484.
      //
      // Root cause: iOS UIKit forbids presenting a second modal while
      // the first is still dismissing — "the presenting view controller
      // (which is now hidden) cannot present another view controller
      // on top of that one." Previous attempts (close() + setTimeout(350),
      // then router.replace) both ran into this: router.replace at the
      // expo-router level is just a logical route swap, but underneath
      // iOS still has to dismiss record then present paywall, and
      // they overlap when dismiss animation is mid-flight. Result is
      // a ghost view that survives in the UIKit window hierarchy and
      // blocks home tab touches after paywall closes.
      //
      // Correct flow: close the record modal, wait for ALL interactions
      // (including the dismiss animation) to complete, THEN push the
      // paywall. InteractionManager is React Native's official API
      // for this — it tracks animation/gesture/interaction completion
      // at the runtime level, not a timer guess.
      close();
      InteractionManager.runAfterInteractions(() => {
        router.push('/(main)/(modals)/subscription-paywall');
      });
      return;
    }

    // Skin unlock takes the next slot. If the queue has items
    // pending, SkinUnlockModal in (tabs)/_layout.tsx will surface
    // automatically as soon as we close. Yield without burning the
    // rating prompt opportunity -- the next milestone publish still
    // gets a chance to ask.
    if (peekSkinUnlockQueueHead() !== undefined) {
      close();
      return;
    }

    // Rating prompt -- only if milestone (3 / 10 / 30) is hit, the
    // user hasn't expressed before, and cooldown has passed. Mark
    // as shown immediately so dismissal-without-engaging starts the
    // cooldown clock. Use InteractionManager so the BottomSheet
    // presents AFTER the record modal has finished dismissing
    // (iOS UIKit forbids two-modal overlap).
    const publishCount = getPublishCount();
    const taskCompletionCount = getTaskCompletionCount();
    const isSubscribed = getCachedSubscriptionTier() !== 'free';
    if (
      shouldShowRatingPrompt({
        publishCount,
        taskCompletionCount,
        isSubscribed,
      })
    ) {
      markRatingPromptShown();
      close();
      InteractionManager.runAfterInteractions(() => {
        emitRatingPromptRequest();
      });
      return;
    }

    close();
  };
  const handleDone = async () => {
    if (doneBusy) return;
    setDoneBusy(true);
    haptics.medium();

    // Stage 5.WR.2 (Bug 1 fix): await prefetch promise so cache is
    // populated BEFORE home tab re-renders. If the prefetch already
    // completed (user dwelled > 1s on insight), this resolves
    // immediately. If user tapped Done quickly, this waits up to
    // ~600ms. The doneBusy state disables the button so double-
    // taps don't spawn parallel close calls.
    //
    // We removed the old clearCachedCharacterState() call: clearing
    // the cache then closing without refetching left home tab with
    // no data to render (the cause of the 10+ second "Loading..."
    // and missing wp/exp updates). The prefetch path now keeps
    // cache FRESH instead of EMPTY.
    try {
      if (prefetchRef.current) {
        await prefetchRef.current;
      }
    } catch {
      // Already swallowed by the .catch in the prefetch effect;
      // belt-and-suspenders.
    }

    // Stage 6.RatingPrompt: increment the lifetime publish counter
    // now that the user has consumed their generated insight and is
    // about to dismiss. This is the "signature interaction" moment
    // per Apple HIG -- the right point to potentially trigger a
    // rating ask on the next handleClose tick.
    incrementPublishCount();

    handleClose();
  };

  return (
    <View style={insightStyles.root}>
      <Confetti />

      <ScrollView
        contentContainerStyle={insightStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <InsightView
          card={publishedCard}
          emotion={publishedEmotion}
          cardCollection={publishedCardCollection}
          aspireImpact={publishedAspireImpact}
          communityCount={communityCount}
          topExtraPadding={Math.max(0, insets.top - 4)}
        />

        {/* Bottom spacer so Done button has air */}
        <View style={{ height: 16 }} />
      </ScrollView>

      <View style={insightStyles.doneBar}>
        <Pressable
          onPress={handleDone}
          disabled={doneBusy}
          style={({ pressed }) => [
            insightStyles.doneButton,
            { opacity: doneBusy ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={insightStyles.doneLabel}>
            {doneBusy ? 'Loading...' : 'Done'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  root: {
    flex: 1,
    // Stage 6.RecordBgFix (post-revert): PhaseInsight gets its own
    // white root so InsightView's Block 4 (reframe) + spacing between
    // self-styled blocks renders on white. Independent of rootStyles
    // (the shared dark-purple #1A0F3D background of CHOOSE / RECORDING
    // / PUBLISHING / TYPE_INPUT). Matches wisdom-insight.tsx root.
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingBottom: 16,
  },
  doneBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  doneButton: {
    // Stage 6.RecordVisual: pink primary CTA (was '#A855F7' purple, invisible).
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 8,
  },
  doneLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
});

// ---- MicDenied dialog (3.7.4 — shown over choose phase when system
//      will no longer prompt for permission) ----

function MicDenied({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <View style={denyStyles.scrim}>
      <View style={denyStyles.card}>
        <Text style={denyStyles.emoji}>🎙️</Text>
        <Text style={denyStyles.title}>Microphone Permission Required</Text>
        <Text style={denyStyles.body}>
          Microphone access has been disabled. To use recording, please
          enable it in your device's Settings.
        </Text>
        <Pressable
          onPress={onOpenSettings}
          style={({ pressed }) => [
            denyStyles.primaryButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={denyStyles.primaryLabel}>Go to Settings</Text>
        </Pressable>
        <Pressable onPress={onClose} style={denyStyles.cancelButton}>
          <Text style={denyStyles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const denyStyles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 32,
  },
  card: {
    // Stage 6.RecordVisual: card matches paywall-purple brand tone,
    // pink-tinted border (was '#1A1040' near-black with purple border).
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderWidth: 1,
    borderColor: 'rgba(236,72,153,0.4)',
  },
  emoji: {
    fontSize: 42,
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    // Stage 6.RecordVisual: 0.5 -> #FFFFFF for legibility.
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryButton: {
    // Stage 6.RecordVisual: pink primary CTA (was purple, invisible on bg).
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 12,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  cancelButton: {
    paddingVertical: 10,
  },
  cancelLabel: {
    // Stage 6.RecordVisual: 0.4 (invisible) -> #FFFFFF.
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});

// ---- Main component ----

type RecordRouteParams = {
  questionId?: string;
  forceKeyword?: string;
  questionText?: string;
};

export default function RecordModal() {
  // Seek-question context (set when this modal is opened from
  // Discover or Question Detail's "Offer Wisdom" CTA). When present,
  // we show a top banner naming the question and forward forceKeyword
  // + seekQuestionId on publish so the card art matches the tag and
  // the new card is automatically linked to the question.
  const seekParams = useLocalSearchParams<RecordRouteParams>();
  const seekQuestionId = (seekParams.questionId || '').trim();
  const seekForceKeyword = (seekParams.forceKeyword || '').trim();
  const seekQuestionText = (seekParams.questionText || '').trim();
  const isSeekContext = seekQuestionId.length > 0;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [phase, setPhase] = useState<Phase>(PHASE.CHOOSE);
  // Stage 5.IAP.5 (Bug #1, aggressive upsell): set to true by
  // PhasePublishing when the just-completed publish consumed the
  // user's last monthly quota slot. PhaseInsight reads this on
  // close and routes to the paywall instead of just closing.
  const [quotaExhaustedAfterPublish, setQuotaExhaustedAfterPublish] =
    useState(false);
  const [recordingDurationSec, setRecordingDurationSec] = useState(0);
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const [description, setDescription] = useState('');
  // Stage 3.10.x: hydrate typedText from MMKV draft on mount.
  // Cleared only on successful publish (see PhasePublishing.useEffect
  // success branch).
  const [typedText, setTypedTextRaw] = useState(
    () => storage.getString('novame_record_typed_draft') ?? '',
  );
  const setTypedText = (next: string) => {
    setTypedTextRaw(next);
    if (next) {
      storage.set('novame_record_typed_draft', next);
    } else {
      storage.remove('novame_record_typed_draft');
    }
  };
  const [publishedCard, setPublishedCard] = useState<PublishedCardData | null>(null);
  const [publishedCardCollection, setPublishedCardCollection] =
    useState<CardCollectionInfo | null>(null);
  const [publishedAspireImpact, setPublishedAspireImpact] =
    useState<AspireImpactDisplay | null>(null);
  // Stage 6: stable community-count for this publish modal session.
  // useMemo with [] deps keeps the number stable across re-renders.
  const communityCount = useMemo(
    () => 50 + Math.floor(Math.random() * 1951),
    [],
  );
  const [publishedEmotion, setPublishedEmotion] = useState<string>('');
  const [lastPublishMessage, setLastPublishMessage] = useState<string | null>(null);
  const [micDeniedVisible, setMicDeniedVisible] = useState(false);

  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const goTo = (next: Phase) => setPhase(next);
  const close = () => router.back();
  const showMicDenied = () => setMicDeniedVisible(true);
  const hideMicDenied = () => setMicDeniedVisible(false);

  const phaseProps: PhaseProps = {
    recorder,
    recordingDurationSec,
    setRecordingDurationSec,
    recordingResult,
    setRecordingResult,
    description,
    setDescription,
    typedText,
    setTypedText,
    publishedCard,
    setPublishedCard,
    publishedCardCollection,
    setPublishedCardCollection,
    publishedAspireImpact,
    setPublishedAspireImpact,
    communityCount,
    publishedEmotion,
    setPublishedEmotion,
    lastPublishMessage,
    setLastPublishMessage,
    goTo,
    close,
    showMicDenied,
    seekForceKeyword,
    seekQuestionId,
    seekQuestionText,
    setQuotaExhaustedAfterPublish,
    quotaExhaustedAfterPublish,
  };

  return (
    <View style={rootStyles.root}>
      {phase === PHASE.CHOOSE ? <PhaseChoose {...phaseProps} /> : null}
      {phase === PHASE.RECORDING ? <PhaseRecording {...phaseProps} /> : null}
      {phase === PHASE.PUBLISH ? <PhasePublish {...phaseProps} /> : null}
      {phase === PHASE.TYPE_INPUT ? <PhaseTypeInput {...phaseProps} /> : null}
      {/* Spinning UI lifted out of PhasePublishing/PhaseAnalyzing so
          the SAME CardSpinAnimation instance persists across the
          PUBLISHING -> ANALYZING phase flip. Only the labels change;
          the Lottie keeps playing without restart. */}
      {(phase === PHASE.PUBLISHING || phase === PHASE.ANALYZING) ? (
        <View style={pubgStyles.loaderHost}>
          <CardSpinAnimation
            mode="continuous"
            label1={
              phase === PHASE.PUBLISHING
                ? 'Wait for it...'
                : 'Generating your wisdom card...'
            }
            label2={
              phase === PHASE.PUBLISHING ? 'Your legacy is loading.' : undefined
            }
            sublabel={
              phase === PHASE.PUBLISHING
                ? 'Almost there'
                : 'Analyzing patterns and insights'
            }
          />
        </View>
      ) : null}
      {phase === PHASE.PUBLISHING ? <PhasePublishing {...phaseProps} /> : null}
      {phase === PHASE.ANALYZING ? <PhaseAnalyzing {...phaseProps} /> : null}
      {phase === PHASE.INSIGHT ? <PhaseInsight {...phaseProps} /> : null}
      {micDeniedVisible ? (
        <MicDenied
          onClose={hideMicDenied}
          onOpenSettings={() => {
            void openAppSettings();
            hideMicDenied();
          }}
        />
      ) : null}
    </View>
  );
}

const rootStyles = StyleSheet.create({
  root: {
    flex: 1,
    // Stage 6.RecordBgFix (reverted from Stage 6 Insight redesign):
    // Insight page redesign needed a white container, but routing that
    // through the SHARED rootStyles.root made every earlier phase
    // (Choose / Recording / Publishing / Type Input) lose its purple
    // background — white labels on white root went invisible. Reverted
    // to deep purple here; InsightView ships its own white container
    // internally so PhaseInsight still renders white on top of this
    // purple root. Matches wisdom-text.tsx (#1A0F3D) for continuity
    // when TYPE_INPUT pushes into wisdom-text.
    backgroundColor: '#1A0F3D',
  },
});
