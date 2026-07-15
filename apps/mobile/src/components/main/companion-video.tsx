import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

/**
 * Home companion video. Plays the bundled default.mov (transparent HEVC/alpha)
 * on a loop, muted. Unlike VideoCharacter (which streams outfit/state clips from
 * R2), this is the single local companion clip for the Home scene -- lightweight,
 * offline, no asset-cache. Tapping opens the interaction sheet.
 *
 * The .mov carries an alpha channel so the companion sits directly on the scene
 * backdrop with no visible video box.
 */
const DEFAULT_SOURCE = require('../../../assets/videos/default.mov');

export function CompanionVideo({ onPress, onReady }: { onPress?: () => void; onReady?: () => void }) {
  const player = useVideoPlayer(DEFAULT_SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (!onReady) return;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') onReady();
    });
    return () => sub.remove();
  }, [player, onReady]);

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
