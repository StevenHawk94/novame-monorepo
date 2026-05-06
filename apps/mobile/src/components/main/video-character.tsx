import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { getCachedAssetUri } from '@/lib/asset-cache';
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
  return local ?? `${R2_BASE_URL}/${filename}`;
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

  const player = useVideoPlayer(resolveSource(initialFilename), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

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
  },
});
