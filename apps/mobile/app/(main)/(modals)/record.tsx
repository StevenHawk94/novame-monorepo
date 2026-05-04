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

import { useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets } from 'expo-audio';
import type { AudioRecorder } from 'expo-audio';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import {
  PRICING_TIERS,
  MIN_RECORDING_SECONDS,
  MIN_TYPED_CHARS,
  type PricingTierKey,
} from '@novame/core';

import { haptics } from '@/lib/haptics';
import { apiClient } from '@/lib/api';
import { getCurrentSession } from '@/lib/auth';
import { getCachedAssetUri } from '@/lib/asset-cache';
import { clearCachedCharacterState } from '@/lib/character-state';
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
import { CardSpinStub, ConfettiStub, FlippableCardStub } from '@/components/onboarding/stubs';

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
  publishedScore: number;
  setPublishedScore: (n: number) => void;
  publishedEmotion: string;
  setPublishedEmotion: (s: string) => void;
  lastPublishMessage: string | null;
  setLastPublishMessage: (s: string | null) => void;
  goTo: (next: Phase) => void;
  close: () => void;
  showMicDenied: () => void;
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
    paddingTop: 80,
    paddingBottom: 40,
    alignItems: 'center',
  },
  frameTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  frameSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
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
    fontSize: 15,
    fontWeight: '700',
  },
});

// ---- Phase: choose (3.7.3 + permission flow added in 3.7.4) ----

function PhaseChoose({ goTo, close, showMicDenied }: PhaseProps) {
  const [requesting, setRequesting] = useState(false);

  const handleRecordTap = async () => {
    if (requesting) return;
    haptics.light();
    setRequesting(true);
    try {
      const res = await requestMicPermission();
      if (res.granted) {
        goTo(PHASE.RECORDING);
      } else if (!res.canAskAgain) {
        // System will not show prompt again — direct user to Settings.
        showMicDenied();
      } else {
        // User actively denied this prompt; stay on choose phase.
        // (Old RecordOverlay treated this the same as canAskAgain=false,
        // but we're more conservative — only push Settings dialog when
        // the system actually blocks future prompts.)
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleTypeTap = () => {
    goTo(PHASE.TYPE_INPUT);
  };

  return (
    <View style={chooseStyles.root}>
      <View style={chooseStyles.headerBlock}>
        <Text style={chooseStyles.title}>Release Your Day</Text>
        <Text style={chooseStyles.subtitle}>
          Share a moment you witnessed, an action you took, or a thought
          that's lingering in your mind.
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
            size={20}
            color="rgba(255,255,255,0.5)"
          />
          <Text style={chooseStyles.typeLabel}>Type instead</Text>
        </Pressable>
        <Text style={chooseStyles.typeHint}>
          Not feeling like speaking right now?
        </Text>
      </View>

      <Pressable onPress={close} style={chooseStyles.cancelButton}>
        <Text style={chooseStyles.cancelLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const chooseStyles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBlock: {
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  recordBlock: {
    alignItems: 'center',
  },
  micButton: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A855F7',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
    marginBottom: 16,
  },
  micLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginTop: 4,
  },
  recordHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  typeBlock: {
    alignItems: 'center',
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  typeLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  typeHint: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
  cancelButton: {
    paddingVertical: 8,
  },
  cancelLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
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
            onPress={close}
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
            <LinearGradient id="recGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#7C3AED" />
              <Stop offset="50%" stopColor="#A855F7" />
              <Stop offset="100%" stopColor="#C084FC" />
            </LinearGradient>
          </Defs>
          {/* Background track */}
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(168,85,247,0.15)"
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
          {/* Glowing dot at progress tip */}
          {progress > 0.005 ? (
            <>
              <Circle cx={dotX} cy={dotY} r={8} fill="rgba(168,85,247,0.3)" />
              <Circle cx={dotX} cy={dotY} r={5} fill="#C084FC" />
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
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
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
              size={32}
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
            <MaterialIcons name="check" size={24} color="#FFFFFF" />
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
    paddingTop: 56,
    paddingBottom: 48,
  },
  topIndicator: {
    alignItems: 'center',
    marginBottom: 24,
  },
  topIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
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
    color: '#FFFFFF',
    fontSize: 56,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  hintBlock: {
    alignItems: 'center',
    marginTop: 24,
    height: 44,
  },
  minHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  minHintWarning: {
    color: '#F87171',
  },
  planHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
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
    gap: 6,
  },
  smallButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  bigButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A855F7',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 8,
  },
  smallLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  errorBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  errorBody: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#A855F7',
  },
  errorButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
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
            <MaterialIcons name="mic" size={32} color="#FFFFFF" />
          </View>
          <Text style={pubStyles.title}>Recording Complete</Text>
          <Text style={pubStyles.duration}>
            {formatDuration(recordingDurationSec)} recorded
          </Text>

          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Add a description (optional)..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            maxLength={300}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={pubStyles.descInput}
          />

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
    paddingTop: 64,
    paddingBottom: 48,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A855F7',
    marginBottom: 16,
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  duration: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 32,
  },
  descInput: {
    width: '100%',
    minHeight: 88,
    maxHeight: 160,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#A855F7',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  cancelButton: {
    paddingVertical: 12,
    marginTop: 16,
  },
  cancelLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
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

  // Dynamic textarea height — grows with content up to a sensible cap.
  // Industry standard: min 120px (~4 lines), grows up to 280px before
  // the inner scroll kicks in. Empty state shows the placeholder height.
  const [textareaHeight, setTextareaHeight] = useState(120);

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
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
              <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
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
              onContentSizeChange={(e) => {
                const next = e.nativeEvent.contentSize.height;
                // Clamp 120-280 — within bounds the input grows with content,
                // beyond it the inner scroll engages.
                setTextareaHeight(Math.min(280, Math.max(120, next + 24)));
              }}
              placeholder="What happened around you... and what shifted inside you?"
              placeholderTextColor="rgba(255,255,255,0.2)"
              maxLength={maxChars}
              multiline
              autoFocus
              textAlignVertical="top"
              style={[typeStyles.mainInput, { height: textareaHeight }]}
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
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Brief description (optional)"
              placeholderTextColor="rgba(255,255,255,0.2)"
              maxLength={200}
              style={typeStyles.descInput}
            />

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
    paddingTop: 16,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
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
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  counterText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
  },
  descInput: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 12,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#A855F7',
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 16,
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
    card_b?: string;
    card_b_title?: string;
    card_c?: string;
    card_c_title?: string;
    task_1?: string;
    task_2?: string;
    task_1_keyword?: string;
    task_2_keyword?: string;
    wisdom_score?: number;
    wisdom_emotion?: string;
  } | null;
  characterBMessage?: string | null;
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
}): Promise<PublishWisdomResponse> {
  if (args.isTyped) {
    return apiClient.post<PublishWisdomResponse>('/api/publish-wisdom', {
      userId: args.userId,
      text: args.text ?? '',
      description: args.description,
      isTyped: true,
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

  return apiClient.post<PublishWisdomResponse>('/api/publish-wisdom', fd);
}

async function fireRecordCompleteSideEffects(args: {
  userId: string;
  wisdomScore: number;
  card: PublishedCardData | null;
}): Promise<void> {
  // 1. character-state record_complete — server updates wp/exp/level.
  apiClient
    .post('/api/character-state', {
      userId: args.userId,
      action: 'record_complete',
      wisdomScore: args.wisdomScore,
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
  setPublishedScore,
  setPublishedEmotion,
  setLastPublishMessage,
  goTo,
  close,
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

        const score = response.card?.wisdom_score ?? 78;
        void fireRecordCompleteSideEffects({
          userId,
          wisdomScore: score,
          card: response.card ?? null,
        });

        setPublishedCard(response.card ?? null);
        setPublishedScore(score);
        setPublishedEmotion(response.card?.wisdom_emotion ?? 'Thoughtful');
        if (response.characterBMessage) {
          setLastPublishMessage(response.characterBMessage);
        }

        goTo(PHASE.INSIGHT);
      } catch (err) {
        console.error('[publish] failed:', err);
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
          onPress={() => goTo(recordingResult ? PHASE.PUBLISH : PHASE.TYPE_INPUT)}
          style={({ pressed }) => [
            pubgStyles.retryButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={pubgStyles.retryLabel}>Back</Text>
        </Pressable>
        <Pressable onPress={close} style={pubgStyles.closeButton}>
          <Text style={pubgStyles.closeLabel}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <CardSpinStub
      mode="continuous"
      label1="Wait for it..."
      label2="Your legacy is loading."
      sublabel="Almost there"
    />
  );
}

// ---- Phase: analyzing (3.7.7 real — keeps spinning until publish resolves) ----
//
// Visual-only — the publishing phase started the network call and will
// drive us to insight when it resolves. No new request fires here.

function PhaseAnalyzing(_props: PhaseProps) {
  return (
    <CardSpinStub
      mode="continuous"
      label1="Generating your wisdom card..."
      sublabel="Analyzing patterns and insights"
    />
  );
}

const pubgStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  label1: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginTop: 12,
    textAlign: 'center',
  },
  label2: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  sublabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorBody: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#A855F7',
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  closeButton: {
    paddingVertical: 12,
    marginTop: 8,
  },
  closeLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
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

const KEYWORD_ID_TO_NAME: Record<string, string> = {
  'mind-clarity': 'Clarity',
  'mind-grounding': 'Grounding',
  'mind-focus': 'Focus',
  'mind-curiosity': 'Curiosity',
  'mind-stillness': 'Stillness',
  'mind-objectivity': 'Objectivity',
  'mind-adaptability': 'Adaptability',
  'mind-unlearning': 'Unlearning',
  'mind-vision': 'Vision',
  'mind-acceptance': 'Acceptance',
  'mind-humor': 'Humor',
  'mind-intuition': 'Intuition',
  'heart-resilience': 'Resilience',
  'heart-boundaries': 'Boundaries',
  'heart-self-compassion': 'Self-Compassion',
  'heart-courage': 'Courage',
  'heart-vulnerability': 'Vulnerability',
  'heart-empathy': 'Empathy',
  'heart-gratitude': 'Gratitude',
  'heart-patience': 'Patience',
  'heart-forgiveness': 'Forgiveness',
  'heart-release': 'Release',
  'heart-balance': 'Balance',
  'heart-joy': 'Joy',
  'action-initiative': 'Initiative',
  'action-consistency': 'Consistency',
  'action-discipline': 'Discipline',
  'action-decisiveness': 'Decisiveness',
  'action-purpose': 'Purpose',
  'action-rest': 'Rest',
  'action-resourcefulness': 'Resourcefulness',
  'action-accountability': 'Accountability',
  'action-boldness': 'Boldness',
  'action-endurance': 'Endurance',
  'action-communication': 'Communication',
  'action-momentum': 'Momentum',
  'connection-sovereignty': 'Sovereignty',
  'connection-authenticity': 'Authenticity',
  'connection-inspiration': 'Inspiration',
  'connection-generosity': 'Generosity',
  'connection-trust': 'Trust',
  'connection-reciprocity': 'Reciprocity',
  'connection-collaboration': 'Collaboration',
  'connection-leadership': 'Leadership',
  'connection-harmony': 'Harmony',
  'connection-legacy': 'Legacy',
  'connection-respect': 'Respect',
  'connection-loyalty': 'Loyalty',
};

/**
 * Extract `{ title, body }` from a server-merged "Title: xxx\n<body>"
 * string. Falls back to empty title and full string as body if the
 * regex doesn't match.
 */
function splitTitleBody(raw: string): { title: string; body: string } {
  if (!raw) return { title: '', body: '' };
  const m = raw.match(/^Title:\s*(.+?)\n([\s\S]*)$/);
  if (m) return { title: m[1].trim(), body: m[2].trim() };
  return { title: '', body: raw };
}

const INSIGHT_RING_R = 38;
const INSIGHT_RING_C = 2 * Math.PI * INSIGHT_RING_R;

function PhaseInsight({
  publishedCard,
  publishedScore,
  publishedEmotion,
  goTo,
  close,
}: PhaseProps) {
  const card = publishedCard;

  // Keyword resolution — server returns keyword_id like 'mind-clarity'.
  // Display name comes from our local lookup table; if a brand-new
  // keyword_id ever shows up we degrade gracefully to 'Clarity'.
  const keywordId = card?.keyword_id ?? 'mind-clarity';
  const keywordName =
    card?.keyword ?? KEYWORD_ID_TO_NAME[keywordId] ?? 'Clarity';

  // Card front image — pulled from R2 cards cache via filename pattern.
  // 3.8 FlippableCard real version will also use this URI.
  const frontFilename = `${keywordId}-front.webp`;
  const frontUri = getCachedAssetUri(frontFilename);

  // Quote shown on the static card front.
  const quoteShort =
    card?.quote_short ?? 'Reflection turns experience into wisdom.';

  // B / C — pull title + body out of the server-merged blob.
  const b = splitTitleBody(card?.card_b ?? '');
  const c = splitTitleBody(card?.card_c ?? '');

  // Tasks block — only render when at least one task exists.
  const hasTasks = !!(card?.task_1 || card?.task_2);

  // Score ring math.
  const score = Math.max(0, Math.min(100, Math.round(publishedScore)));
  const ringDashOffset = INSIGHT_RING_C * (1 - score / 100);

  const handleDone = () => {
    haptics.medium();

    // Force Home tab to re-fetch character state on next mount so the
    // freshly-updated wp/exp/level are visible without manual reload.
    clearCachedCharacterState();

    // 3.10 placeholder: skin unlock detection.
    // Server-side character-state record_complete already updated the
    // level; if it crossed an OUTFIT_UNLOCK_LEVELS threshold and the
    // outfit hasn't been seen yet, 3.10 will surface a SkinUnlockOverlay
    // here. For now we just log so 3.10 can locate the integration point.
    console.log('[insight] Done — skin-unlock detection placeholder (3.10)');

    // 3.10 placeholder: first-wisdom paywall trigger.
    // If this was the user's first ever wisdom AND they're on the free
    // tier, the old web app showed the paywall after a 300ms delay.
    // 3.10 will wire openPaywall('first-wisdom') here.
    console.log('[insight] Done — first-wisdom paywall placeholder (3.10)');

    close();
  };

  return (
    <View style={insightStyles.root}>
      <ConfettiStub />

      <ScrollView
        contentContainerStyle={insightStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={insightStyles.title}>WISDOM INSIGHT</Text>

        {/* Score + Emotion row */}
        <View style={insightStyles.metaRow}>
          <View style={insightStyles.scoreCol}>
            <View style={insightStyles.scoreRingWrap}>
              <Svg width={90} height={90} viewBox="0 0 90 90">
                <Circle
                  cx={45}
                  cy={45}
                  r={INSIGHT_RING_R}
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={6}
                />
                <Circle
                  cx={45}
                  cy={45}
                  r={INSIGHT_RING_R}
                  fill="none"
                  stroke="#A855F7"
                  strokeWidth={6}
                  strokeLinecap="round"
                  strokeDasharray={`${INSIGHT_RING_C}`}
                  strokeDashoffset={`${ringDashOffset}`}
                  transform="rotate(-90 45 45)"
                />
              </Svg>
              <View pointerEvents="none" style={insightStyles.scoreCenter}>
                <Text style={insightStyles.scoreValue}>{score}</Text>
                <Text style={insightStyles.scoreMax}>/100</Text>
              </View>
            </View>
            <View style={insightStyles.scoreLabelRow}>
              <MaterialIcons name="star" size={14} color="#FACC15" />
              <Text style={insightStyles.scoreLabel}>Wisdom Score</Text>
            </View>
          </View>

          <View style={insightStyles.emotionCol}>
            <MaterialIcons
              name="sentiment-satisfied"
              size={36}
              color="#C084FC"
            />
            <Text style={insightStyles.emotionCaption}>Wisdom Emotion:</Text>
            <Text style={insightStyles.emotionValue}>
              {publishedEmotion || 'Thoughtful'}
            </Text>
          </View>
        </View>

        {/* Flippable wisdom card */}
        <View style={insightStyles.cardWrap}>
          <FlippableCardStub
            frontUri={frontUri}
            quoteShort={quoteShort}
            width={260}
          />
        </View>
        <Text style={insightStyles.flipHint}>Tap to flip</Text>

        {/* Card B — Feel Seen */}
        <View style={insightStyles.glassCard}>
          <View style={insightStyles.glassHeader}>
            <MaterialIcons name="psychology" size={18} color="#C084FC" />
            {b.title ? (
              <Text style={insightStyles.glassTitle}>{b.title}</Text>
            ) : null}
          </View>
          <Text style={insightStyles.glassBody}>{b.body}</Text>
        </View>

        {/* Card C — Root Insight */}
        <View style={insightStyles.glassCard}>
          <View style={insightStyles.glassHeader}>
            <MaterialIcons name="school" size={18} color="#C084FC" />
            {c.title ? (
              <Text style={insightStyles.glassTitle}>{c.title}</Text>
            ) : null}
          </View>
          <Text style={insightStyles.glassBody}>{c.body}</Text>
        </View>

        {/* Wisdom Tasks */}
        {hasTasks ? (
          <View style={insightStyles.tasksCard}>
            <View style={insightStyles.glassHeader}>
              <MaterialIcons name="task-alt" size={18} color="#FACC15" />
              <Text style={insightStyles.glassTitle}>YOUR WISDOM TASKS</Text>
            </View>
            {card?.task_1 ? (
              <View style={insightStyles.taskRow}>
                <Text style={insightStyles.taskBolt}>⚡</Text>
                <Text style={insightStyles.taskText}>{card.task_1}</Text>
              </View>
            ) : null}
            {card?.task_2 ? (
              <View style={insightStyles.taskRow}>
                <Text style={insightStyles.taskBolt}>⚡</Text>
                <Text style={insightStyles.taskText}>{card.task_2}</Text>
              </View>
            ) : null}
            <Text style={insightStyles.taskHint}>
              Complete these tasks from your character page to earn EXP!
            </Text>
          </View>
        ) : null}

        {/* Bottom spacer so Done button has air */}
        <View style={{ height: 16 }} />
      </ScrollView>

      <View style={insightStyles.doneBar}>
        <Pressable
          onPress={handleDone}
          style={({ pressed }) => [
            insightStyles.doneButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={insightStyles.doneLabel}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  scoreCol: {
    alignItems: 'center',
  },
  scoreRingWrap: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  scoreMax: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
  },
  scoreLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  scoreLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  emotionCol: {
    alignItems: 'center',
  },
  emotionCaption: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
  },
  emotionValue: {
    color: '#C084FC',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 2,
  },
  cardWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  flipHint: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  glassCard: {
    width: '100%',
    padding: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  glassHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  glassTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    flexShrink: 1,
  },
  glassBody: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  tasksCard: {
    width: '100%',
    padding: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(168,85,247,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.15)',
    marginBottom: 16,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  taskBolt: {
    color: '#FACC15',
    fontSize: 12,
    marginTop: 2,
  },
  taskText: {
    flex: 1,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  taskHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 12,
  },
  doneBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  doneButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#A855F7',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  doneLabel: {
    color: '#FFFFFF',
    fontSize: 16,
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#1A1040',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.3)',
  },
  emoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#A855F7',
    marginBottom: 12,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  cancelButton: {
    paddingVertical: 8,
  },
  cancelLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});

// ---- Main component ----

export default function RecordModal() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [phase, setPhase] = useState<Phase>(PHASE.CHOOSE);
  const [recordingDurationSec, setRecordingDurationSec] = useState(0);
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const [description, setDescription] = useState('');
  const [typedText, setTypedText] = useState('');
  const [publishedCard, setPublishedCard] = useState<PublishedCardData | null>(null);
  const [publishedScore, setPublishedScore] = useState<number>(0);
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
    publishedScore,
    setPublishedScore,
    publishedEmotion,
    setPublishedEmotion,
    lastPublishMessage,
    setLastPublishMessage,
    goTo,
    close,
    showMicDenied,
  };

  return (
    <View style={rootStyles.root}>
      {phase === PHASE.CHOOSE ? <PhaseChoose {...phaseProps} /> : null}
      {phase === PHASE.RECORDING ? <PhaseRecording {...phaseProps} /> : null}
      {phase === PHASE.PUBLISH ? <PhasePublish {...phaseProps} /> : null}
      {phase === PHASE.TYPE_INPUT ? <PhaseTypeInput {...phaseProps} /> : null}
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
    backgroundColor: '#0A0820',
  },
});
