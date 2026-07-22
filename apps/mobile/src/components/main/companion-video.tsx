import { useCallback, useEffect, useRef } from 'react';
import { AppState, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

/**
 * Home companion video. Plays the bundled default.mov (transparent HEVC/alpha)
 * on a loop, muted. Unlike VideoCharacter (which streams outfit/state clips from
 * R2), this is the single local companion clip for the Home scene -- lightweight,
 * offline, no asset-cache. Tapping opens the interaction sheet.
 *
 * THE VIDEO MUST NEVER SIT PAUSED (product requirement). Three things can stop
 * a muted looping player, and none of them resume it by themselves:
 *   1. app background -> foreground (expo-video pauses on background)
 *   2. iOS audio-session interruptions -- calls, Siri, other apps, and our own
 *      Focus audio activating the session; a muted player still participates
 *      unless it mixes with others
 *   3. anything else (native hiccup, modal presentation edge cases)
 * Defenses, layered:
 *   - audioMixingMode 'mixWithOthers': a muted pet clip has no business
 *     claiming the audio session, so interruptions stop targeting it
 *   - AppState listener: replay on every return to 'active'
 *   - playingChange watchdog: any unexpected stop -> play() again shortly
 *   - screen focus: navigating back to Home always resumes
 *
 * The .mov carries an alpha channel so the companion sits directly on the
 * scene backdrop with no visible video box.
 */
const DEFAULT_SOURCE = require('../../../assets/videos/default.mov');
const WATCHDOG_DELAY_MS = 300;

export function CompanionVideo({ onPress, onReady }: { onPress?: () => void; onReady?: () => void }) {
  const player = useVideoPlayer(DEFAULT_SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // play() throws on a released player (fast unmount); never let that crash.
  const safePlay = useCallback(() => {
    try {
      player.play();
    } catch {
      // released — component is gone, nothing to resume
    }
  }, [player]);

  useEffect(() => {
    if (!onReady) return;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') onReady();
    });
    return () => sub.remove();
  }, [player, onReady]);

  // Watchdog: the player reported a stop we didn't ask for -> resume. The
  // small delay lets legitimate teardown (unmount) win the race; safePlay
  // swallows the released-player case.
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) return;
      if (watchdog.current) clearTimeout(watchdog.current);
      watchdog.current = setTimeout(() => {
        watchdog.current = null;
        if (AppState.currentState === 'active') safePlay();
      }, WATCHDOG_DELAY_MS);
    });
    return () => {
      sub.remove();
      if (watchdog.current) {
        clearTimeout(watchdog.current);
        watchdog.current = null;
      }
    };
  }, [player, safePlay]);

  // Foreground return: expo-video pauses on background and stays paused.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') safePlay();
    });
    return () => sub.remove();
  }, [safePlay]);

  // Back-navigation to Home: whatever happened elsewhere, the pet moves.
  useFocusEffect(
    useCallback(() => {
      safePlay();
    }, [safePlay]),
  );

  return (
    <Pressable onPress={onPress} hitSlop={20}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        pointerEvents="none"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  video: { width: 240, height: 240, backgroundColor: 'transparent' },
});
