import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useFocusEffect } from 'expo-router';

import { buildAssetUrl, dirForFilename, getCachedAssetUri } from '@/lib/asset-cache';
import { bumpToFront } from '@/lib/download-queue';
import type { CharacterState } from '@/lib/constants';

/**
 * Animated character video view (stage 3.6).
 *
 * Replacement for the old Capacitor VideoCharacter.js (196 lines of
 * webview-specific keepalive hacks). The expo-video player handles
 * AppState pause/resume natively, so we drop the visibility/focus/
 * pageshow/touchstart/interval-stuck-detection complexity.
 *
 * Filename pattern matches the R2 manifest: char{N}-outfit{M}-{state}.mp4.
 *
 * Source resolution:
 *   1. Prefer asset-cache local file:// URI (fast load + offline).
 *   2. Fall back to R2 CDN URL (slow first load, but works without
 *      the asset-cache prefetch having reached this clip yet).
 *
 * The player is created once with useVideoPlayer; subsequent
 * outfit/state changes call player.replace() to swap the source
 * without unmounting/remounting the VideoView (no flash, no remount
 * cost).
 *
 * Stage 3.10+ may add a fade-in transition when the source changes
 * (visual polish). Stage 3.6 keeps it minimal.
 */

const R2_BASE_URL = 'https://media.novameapp.com';

type VideoCharacterProps = {
  /** Character ID, currently always 'char-1'. */
  characterId: string;
  /** Outfit number, 1 to 6. */
  outfit: number;
  /** Animation state derived from WP + mode. */
  state: CharacterState;
  /** Optional tap handler — used by Home for skin / character interaction. */
  onPress?: () => void;
};

/**
 * Builds the filename for the requested character clip.
 *
 * Example: characterId='char-1', outfit=2, state='study'
 *          → 'char1-outfit2-study.mp4'
 */
function buildFilename(characterId: string, outfit: number, state: CharacterState): string {
  const charNum = characterId.replace('char-', '');
  return `char${charNum}-outfit${outfit}-${state}.mp4`;
}

/**
 * Resolves the best available source for the given clip:
 *   - local file:// URI from asset-cache if cached
 *   - R2 CDN URL otherwise
 */
function resolveSource(filename: string): string {
  const local = getCachedAssetUri(filename);
  return local ?? buildAssetUrl(R2_BASE_URL, dirForFilename(filename), filename);
}

export function VideoCharacter({
  characterId,
  outfit,
  state,
  onPress,
}: VideoCharacterProps) {
  // Compute the initial source once for useVideoPlayer's mount-time setup.
  const initialFilename = buildFilename(characterId, outfit, state);
  const [currentFilename, setCurrentFilename] = useState(initialFilename);
  // Keep the latest filename in a ref so the statusChange listener (whose
  // effect deps are [player]) reads the current value, not a stale closure.
  const currentFilenameRef = useRef(currentFilename);
  currentFilenameRef.current = currentFilename;
  // Guard so an 'error' status retries the source at most once per filename
  // (avoids an infinite reload loop / battery drain on a hard failure).
  const retriedFilenameRef = useRef<string | null>(null);

  // P1 action-triggered priority: when the video we need to show right
  // now isn't cached locally (resolveSource is falling back to the R2
  // CDN), bump it to the front of the download queue so it lands in
  // the local cache ASAP (next time it plays from file://, offline-
  // capable). Idempotent + does not touch the player; the CDN fallback
  // already shows the video immediately.
  useEffect(() => {
    if (getCachedAssetUri(currentFilename) === null) {
      bumpToFront(currentFilename);
    }
  }, [currentFilename]);

  const player = useVideoPlayer(resolveSource(initialFilename), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Stage 5.WR.2 (Bug 6 fix): safeguard layer 4 — expo-router focus.
  // When the user switches tabs and comes back to Home, neither
  // AppState change (layer 1) nor replaceAsync (layer 2) nor
  // playToEnd (layer 3) fires, because the app stays active and
  // the source/playback state didn't actually change — only the
  // tab visibility did. expo-router's useFocusEffect fires every
  // time this screen regains focus, so we use it as the catch-all
  // resume trigger. Cheap (a single .play() call), idempotent
  // (already-playing player ignores the call), and matches the
  // expo-video community pattern for tab-based navigation.
  useFocusEffect(
    useCallback(() => {
      try {
        if (!player.playing) {
          player.play();
        }
      } catch {
        // best-effort
      }
      // No cleanup needed — we don't pause on blur. Other safeguards
      // (AppState background) handle the genuine pause cases.
    }, [player]),
  );

  // Stage 6 keep-playing safeguard layer 1: AppState resume.
  // expo-video pauses videos when the app goes to background (iOS
  // system requirement + battery), but does NOT auto-resume on
  // return. Without this listener, switching to another app once
  // and coming back leaves the home video frozen on a frame, which
  // also triggers iOS 16+ Live Text overlay ("Copy All") on detected
  // frame text. Re-playing as soon as we return to active state
  // restores motion + suppresses Live Text.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        try {
          player.play();
        } catch {
          // best-effort
        }
      }
    });
    return () => sub.remove();
  }, [player]);

  // Stage 6 keep-playing safeguard layer 2: replaceAsync race fix.
  // After publish-wisdom, character outfit/state may change which
  // triggers replaceAsync below. expo-video v3 replaceAsync resolves
  // before the new source reaches 'readyToPlay' status in some cases,
  // so the immediate player.play() call after replaceAsync silently
  // no-ops (player still in 'loading' or 'idle'). This listener
  // catches the moment the new source becomes playable and starts it
  // if not already playing — bug-free across all replace scenarios.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && !player.playing) {
        try {
          player.play();
        } catch {
          // best-effort
        }
        return;
      }
      // Error fallback: if the source fails to load (P1 clip not yet
      // downloaded AND the CDN fetch failed), retry the source ONCE for
      // the current filename. resolveSource re-evaluates cache vs CDN, so
      // a clip that finished downloading in the meantime now resolves to
      // the local file://. Bump it to the front of the queue too. Capped
      // at one retry per filename to avoid an infinite error->retry loop.
      if (status === 'error') {
        const fn = currentFilenameRef.current;
        if (retriedFilenameRef.current !== fn) {
          retriedFilenameRef.current = fn;
          bumpToFront(fn);
          try {
            player.replace(resolveSource(fn));
            player.play();
          } catch {
            // best-effort; leave the player as-is if replace throws
          }
        }
      }
    });
    return () => sub.remove();
  }, [player]);

  // Stage 6 keep-playing safeguard layer 3: loop fallback.
  // player.loop = true is set at construction, but some iOS versions
  // and replaced sources occasionally fire playToEnd without auto-
  // restart. Force-replay on end is a defensive safety net.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      try {
        player.play();
      } catch {
        // best-effort
      }
    });
    return () => sub.remove();
  }, [player]);

  // Swap source when outfit/state changes without remounting the VideoView.
  // We use replaceAsync (expo-video v3+) so the asset load doesn't block
  // the main thread — replace() does sync IO that visibly freezes the
  // UI for ~10s after publish-wisdom on iOS even when the file is in
  // the bundle/cache. replaceAsync resolves once the new source is
  // ready and we play() then.
  useEffect(() => {
    const next = buildFilename(characterId, outfit, state);
    if (next === currentFilename) return;
    setCurrentFilename(next);

    let cancelled = false;
    void (async () => {
      try {
        const replaceFn = (player as unknown as {
          replaceAsync?: (src: ReturnType<typeof resolveSource>) => Promise<void>;
        }).replaceAsync;
        if (typeof replaceFn === 'function') {
          await replaceFn.call(player, resolveSource(next));
        } else {
          // Fallback for older expo-video that doesn't expose replaceAsync.
          player.replace(resolveSource(next));
        }
        if (!cancelled) player.play();
      } catch (e) {
        // If the swap fails we keep the current source playing rather
        // than tearing down the player.
        console.warn('[video-character] replaceAsync failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [characterId, outfit, state, currentFilename, player]);

  const videoView = (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="cover"
      nativeControls={false}
    />
  );

  // Wrap in Pressable only when onPress provided — saves a render layer otherwise.
  if (onPress) {
    return (
      <Pressable style={styles.root} onPress={onPress}>
        {videoView}
      </Pressable>
    );
  }
  return <View style={styles.root}>{videoView}</View>;
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
    // Overscan: scale the video up slightly so the outermost 1-2px (where
    // cover-scaling samples the frame boundary and shimmers) get clipped by
    // root's overflow:'hidden'. Standard fix for edge flicker on a small
    // source video being upscaled. 1.05 = ~2.5% cropped off each edge.
    transform: [{ scale: 1.05 }],
  },
});
