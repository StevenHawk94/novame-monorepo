/** Ambient music/chimes respect the silent switch and never play in background.
 * iOS expo-audio rejects playsInSilentMode:false with duckOthers, recording,
 * or background playback. Keep both quiet playback owners on one legal policy;
 * Surprise recording/private-message playback configures its own audio focus.
 */
export const FOREGROUND_AUDIO_MODE = {
  allowsRecording: false,
  shouldPlayInBackground: false,
  playsInSilentMode: false,
  interruptionMode: 'mixWithOthers',
} as const;
