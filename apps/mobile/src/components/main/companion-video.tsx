import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';

import {
  fetchOutfitCatalog,
  getCachedOutfitCatalog,
  getEquippedOutfitKey,
  outfitAssetUrl,
  resolveEquippedOutfitVideo,
} from '../../lib/outfits';
import { DEFAULT_COMPANION_VIDEO } from './companion-video-source';

/**
 * Home companion animation. iOS uses transparent HEVC/alpha video; Android
 * uses animated WebP because Media3 does not composite VP9 alpha. Outfit clips
 * are cached locally on both platforms in their native format. Tapping opens
 * the interaction sheet.
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
 * Both formats carry an alpha channel so the companion sits directly on the
 * scene backdrop with no visible video box.
 */
const WATCHDOG_DELAY_MS = 300;

type Props = { onPress?: () => void; onReady?: () => void; onError?: () => void };

function AndroidCompanion({ onPress, onReady, onError }: Props) {
  const [source, setSource] = useState<number | { uri: string; isAnimated?: boolean }>(DEFAULT_COMPANION_VIDEO);

  const syncSource = useCallback(() => {
    const key = getEquippedOutfitKey();
    if (!key) {
      setSource(DEFAULT_COMPANION_VIDEO);
      return;
    }

    const useAnimatedSource = (resolved: Awaited<ReturnType<typeof resolveEquippedOutfitVideo>>) => {
      if (!resolved || getEquippedOutfitKey() !== resolved.key) return;
      // expo-image cannot always infer animation from a cache path without an
      // extension on Android. Mark the locally cached WebP explicitly.
      setSource({ uri: resolved.uri, isAnimated: true });
    };

    const cached = getCachedOutfitCatalog().find((outfit) => outfit.key === key);
    if (cached) {
      // Show the transparent worn preview immediately while the animated WebP
      // is being resolved from disk (or downloaded on first launch).
      setSource({ uri: outfitAssetUrl(cached.bunny, cached.assetVersion) });
      void resolveEquippedOutfitVideo().then(useAnimatedSource);
      return;
    }

    void fetchOutfitCatalog().then((catalog) => {
      const currentKey = getEquippedOutfitKey();
      const outfit = catalog.find((entry) => entry.key === currentKey);
      if (outfit) setSource({ uri: outfitAssetUrl(outfit.bunny, outfit.assetVersion) });
      return resolveEquippedOutfitVideo();
    }).then(useAnimatedSource);
  }, []);

  useFocusEffect(useCallback(() => {
    syncSource();
  }, [syncSource]));

  return (
    <Pressable
      style={styles.touchTarget}
      onPress={onPress}
      hitSlop={20}
      accessibilityRole="button"
      accessibilityLabel="Open companion"
    >
      <ExpoImage
        source={source}
        style={styles.video}
        contentFit="contain"
        autoplay
        onDisplay={onReady}
        onError={onError}
      />
    </Pressable>
  );
}

function AppleCompanionVideo({ onPress, onReady, onError }: Props) {
  const player = useVideoPlayer(DEFAULT_COMPANION_VIDEO, (p) => {
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
    if (!onError) return;
    if (player.status === 'error') onError();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onError();
    });
    return () => sub.remove();
  }, [player, onError]);

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

  // Outfit swap (2026-07-30): when an outfit is equipped in the Bunny Closet,
  // Home plays its platform-specific transparent video instead of the default. The clip is
  // downloaded to the local cache first (outfits.ts) so the loop never
  // stutters; until it's ready — or when nothing is equipped — the bundled
  // default keeps playing. replaceAsync swaps without remounting the player,
  // so the loop/mute/mixing settings carry over.
  const loadedOutfitKey = useRef<string | null>(null);
  const syncOutfitVideo = useCallback(() => {
    const want = getEquippedOutfitKey();
    if (want === loadedOutfitKey.current) return;
    if (!want) {
      loadedOutfitKey.current = null;
      void (async () => {
        try {
          await player.replaceAsync(DEFAULT_COMPANION_VIDEO);
          player.play();
        } catch { /* released */ }
      })();
      return;
    }
    void resolveEquippedOutfitVideo().then((resolved) => {
      // Stale-guard: the user may have changed outfits again mid-download.
      if (!resolved || getEquippedOutfitKey() !== resolved.key) return;
      if (loadedOutfitKey.current === resolved.key) return;
      loadedOutfitKey.current = resolved.key;
      void (async () => {
        try {
          await player.replaceAsync({ uri: resolved.uri });
          player.play();
        } catch { /* released */ }
      })();
    });
  }, [player]);

  // Back-navigation to Home: whatever happened elsewhere, the pet moves —
  // and if the closet just changed the outfit, pick the new clip up.
  useFocusEffect(
    useCallback(() => {
      safePlay();
      syncOutfitVideo();
    }, [safePlay, syncOutfitVideo]),
  );

  // Keep the established iOS render/touch hierarchy unchanged.
  return (
    <Pressable onPress={onPress} hitSlop={20}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        pointerEvents="none"
        onFirstFrameRender={onReady}
      />
    </Pressable>
  );
}

export function CompanionVideo(props: Props) {
  return Platform.OS === 'android'
    ? <AndroidCompanion {...props} />
    : <AppleCompanionVideo {...props} />;
}

const styles = StyleSheet.create({
  touchTarget: { width: 240, height: 240 },
  video: { width: 240, height: 240, backgroundColor: 'transparent' },
});
