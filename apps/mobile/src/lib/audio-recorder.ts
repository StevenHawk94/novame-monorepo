/**
 * Audio recorder wrapper — command-style facade over expo-audio's
 * SharedObject-based AudioRecorder.
 *
 * Why this wrapper exists
 * -----------------------
 * `useAudioRecorder` is a React hook that owns the recorder lifecycle.
 * `record.tsx` calls it once at component top to obtain an `AudioRecorder`
 * instance. From there, our state machine (choose -> recording -> publish ->
 * publishing -> analyzing -> insight) needs imperative `start / pause /
 * resume / stop / cancel` operations driven by user taps — not state-derived
 * effects.
 *
 * This module is that imperative layer. Each function takes the recorder
 * instance and performs one phase transition. We do NOT poll
 * `useAudioRecorderState` because:
 *   1. We already drive timer UI with our own `setInterval` (matches old
 *      RecordOverlay.js behaviour 1:1, plus we control the tick rate).
 *   2. The recorder's own `currentTime` property is read on demand at stop
 *      time as a sanity check against our self-counted duration.
 *
 * SDK 54 expo-audio facts (verified from .d.ts):
 *   - AudioRecorder methods: prepareToRecordAsync / record / pause / stop
 *     -- No `resume` method exists. After `pause()`, calling `record()`
 *        again is the documented resume path.
 *   - `recorder.uri: string | null` is the file path (instance property,
 *     readable after stop).
 *   - `recorder.currentTime: number` is recording elapsed seconds.
 *   - Permission API is at module top: requestRecordingPermissionsAsync /
 *     getRecordingPermissionsAsync (NOT on AudioModule).
 *
 * Known issue: GitHub expo/expo#39646 — on Android SDK 54, stop() may
 * return a URI pointing to a 0-byte file with the real recording at a
 * different path. We surface this via `getRecordingResult.sizeBytes === 0`
 * so callers can detect and report. iOS not affected.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { setAudioModeAsync, type AudioRecorder } from 'expo-audio';

/**
 * Result of a successful stop. Caller should check `sizeBytes > 0`
 * before treating as a valid recording (Android SDK 54 zero-byte issue).
 */
export type RecordingResult = {
  uri: string;
  sizeBytes: number;
  /** Recorder's own reported elapsed seconds at stop time. */
  recorderDurationSec: number;
};

/**
 * Configure audio session for recording. Call once before first
 * `prepareAndStart` in a session. iOS-specific flags are no-ops on Android.
 */
export async function configureAudioSession(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true, // iOS: allow capture even with ringer silent
    allowsRecording: true, // iOS: switch session category to record
  });
}

/**
 * Prepare the recorder, then start recording.
 *
 * Must be called after permission is granted (caller's responsibility —
 * see `permissions.ts` for the permission flow).
 *
 * Throws if prepare fails (file system / hardware error). Caller should
 * catch and surface a phase reset.
 */
export async function prepareAndStart(recorder: AudioRecorder): Promise<void> {
  await recorder.prepareToRecordAsync();
  recorder.record();
}

/**
 * Pause recording. After pause, call `resumeRecording` to continue
 * appending to the same file.
 */
export function pauseRecording(recorder: AudioRecorder): void {
  recorder.pause();
}

/**
 * Resume a paused recording. expo-audio has no explicit `resume` —
 * calling `record()` again continues the existing recording session.
 *
 * Documented behaviour at SDK 54; if a future runtime test reveals
 * this opens a new file, we'll switch to a chunk-merge approach.
 */
export function resumeRecording(recorder: AudioRecorder): void {
  recorder.record();
}

/**
 * Stop recording. Returns the file URI plus a size sanity check.
 *
 * On Android SDK 54 there's a known bug (expo/expo#39646) where the
 * returned URI may point to a 0-byte file. Callers MUST inspect
 * `sizeBytes` before treating the file as valid audio.
 *
 * Throws if stop itself fails or if `recorder.uri` is null after stop
 * (which would indicate a deeper recorder lifecycle problem).
 */
export async function stopRecording(
  recorder: AudioRecorder,
): Promise<RecordingResult> {
  const recorderDurationSec = recorder.currentTime;
  await recorder.stop();

  const uri = recorder.uri;
  if (!uri) {
    throw new Error(
      '[audio-recorder] stop() succeeded but recorder.uri is null',
    );
  }

  let sizeBytes = 0;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === 'number') {
      sizeBytes = info.size;
    }
  } catch (err) {
    // Don't fail stop just because size probe failed; caller can still
    // choose to attempt upload and let the server validate.
    console.warn('[audio-recorder] getInfoAsync failed:', err);
  }

  return { uri, sizeBytes, recorderDurationSec };
}

/**
 * Cancel an in-progress or paused recording. Stops the recorder and
 * deletes the file on disk. Errors are swallowed because cancel is a
 * cleanup path — we don't want to throw during user-initiated abort.
 */
export async function cancelRecording(recorder: AudioRecorder): Promise<void> {
  // Capture the uri BEFORE stop() to avoid native-shared-object lifecycle
  // issues. Property access on recorder.uri is a sync JSI getter that
  // bypasses our try/catch around await stop() — once the native object
  // is released, the getter throws NativeSharedObjectNotFoundException.
  // Cancel is a cleanup path; never throw to the caller.
  let uri: string | undefined;
  try {
    uri = recorder.uri ?? undefined;
  } catch {
    // recorder.uri may throw if native object was already released
    // (cancel before any prepareAndStart, or race with another stop).
  }
  try {
    await recorder.stop();
  } catch {
    // Recorder may already be stopped or never started; ignore.
  }
  if (uri) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // File may not exist; ignore.
    }
  }
}

/**
 * Format seconds as `MM:SS` for timer display.
 * Mirrors `fmtTime` in old RecordOverlay.js.
 */
export function formatDuration(totalSeconds: number): string {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
