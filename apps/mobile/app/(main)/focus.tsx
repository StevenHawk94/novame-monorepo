import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { FOCUS_SCENES, type FocusScene } from '@novame/domain';
import { useTheme } from '../../src/theme/use-theme';
import { haptics } from '../../src/lib/haptics';
import { getCachedSubscriptionTier } from '../../src/lib/subscription';
import { submitFocus } from '../../src/lib/focus-api';

// Test-phase bundled audio: the first track of the free scenes. Remote R2
// tracks replace these later; a scene with no local track yet just shows a
// "coming soon" note. Only work1 is provided for now; the map is where new
// bundled tracks are wired in.
const LOCAL_TRACKS: Record<string, number> = {
  work: require('../../assets/audio/focus/work1.mp3'),
};

type Phase = 'select' | 'play';

/**
 * Focus (C10). Pick a scene, play a mindfulness track, and it completes when
 * playback reaches the end (>= duration - 2s). No seek bar -- only pause/resume
 * (PRD). Audio keeps playing when the screen locks or backgrounds
 * (shouldPlayInBackground + the UIBackgroundModes audio entitlement). Completing
 * credits +30 xp once a day; quitting before the end credits nothing.
 */
export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;

  const [phase, setPhase] = useState<Phase>('select');
  const [scene, setScene] = useState<FocusScene | null>(null);
  const [isPaid] = useState(() => getCachedSubscriptionTier() !== 'free');
  const [completed, setCompleted] = useState(false);
  const creditedRef = useRef(false);

  // One player for the whole screen; source swapped when a scene starts.
  const source = scene && LOCAL_TRACKS[scene.id] ? LOCAL_TRACKS[scene.id] : null;
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  // Configure background + silent-mode playback once.
  useEffect(() => {
    void setAudioModeAsync({
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    });
  }, []);

  // Completion: playback reached the end. Credit once.
  useEffect(() => {
    if (phase !== 'play' || creditedRef.current) return;
    const dur = status.duration;
    const reachedEnd = status.didJustFinish || (dur > 0 && status.currentTime >= dur - 2);
    if (reachedEnd) {
      creditedRef.current = true;
      setCompleted(true);
      void haptics.medium();
      if (scene) void submitFocus({ sceneId: scene.id, trackIndex: 1 });
    }
  }, [status.currentTime, status.duration, status.didJustFinish, phase, scene]);

  const startScene = useCallback(
    (s: FocusScene) => {
      if (!s.free && !isPaid) return; // locked
      if (!LOCAL_TRACKS[s.id]) return; // no track yet
      void haptics.medium();
      creditedRef.current = false;
      setCompleted(false);
      setScene(s);
      setPhase('play');
    },
    [isPaid],
  );

  // Play once the source is loaded after entering play phase.
  useEffect(() => {
    if (phase === 'play' && status.isLoaded && !status.playing && !completed) {
      player.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status.isLoaded]);

  const exit = useCallback(() => {
    player.pause();
    setPhase('select');
    setScene(null);
  }, [player]);

  // ---- SELECT ----
  if (phase === 'select') {
    return (
      <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
        </Pressable>
        <Text style={[styles.h1, { color: c.textPrimary }]}>Take a moment</Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>
          A short guided pause for wherever you are.
        </Text>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {FOCUS_SCENES.map((s) => {
            const locked = !s.free && !isPaid;
            const noTrack = !LOCAL_TRACKS[s.id];
            return (
              <Pressable
                key={s.id}
                onPress={() => startScene(s)}
                style={[styles.sceneCard, { backgroundColor: c.bgCard, borderColor: c.border, opacity: locked ? 0.55 : 1 }]}
              >
                <View style={styles.sceneText}>
                  <Text style={[styles.sceneTitle, { color: c.textPrimary }]}>{s.title}</Text>
                  <Text style={[styles.sceneSub, { color: c.textSecondary }]}>{s.subtitle}</Text>
                </View>
                {locked ? (
                  <MaterialIcons name="lock" size={20} color={c.textMuted} />
                ) : noTrack ? (
                  <Text style={[styles.soon, { color: c.textMuted }]}>Soon</Text>
                ) : (
                  <MaterialIcons name="play-circle-outline" size={26} color={c.brand.primary} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // ---- PLAY ----
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  return (
    <View style={[styles.root, styles.playRoot, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={exit} style={styles.back} hitSlop={12}>
        <MaterialIcons name="close" size={24} color={c.textSecondary} />
      </Pressable>

      <View style={styles.playCenter}>
        <Text style={[styles.playTitle, { color: c.textPrimary }]}>{scene?.title}</Text>
        <Text style={[styles.playSub, { color: c.textSecondary }]}>{scene?.subtitle}</Text>

        {completed ? (
          <View style={styles.doneBlock}>
            <MaterialIcons name="check-circle" size={64} color={c.brand.primary} />
            <Text style={[styles.doneText, { color: c.textPrimary }]}>Done. Carry that with you.</Text>
            <Pressable onPress={() => router.back()} style={[styles.doneBtn, { backgroundColor: c.brand.primary }]}>
              <Text style={styles.doneBtnText}>Finish</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Breathing circle placeholder */}
            <View style={[styles.orb, { backgroundColor: c.bgCard, borderColor: c.brand.primary }]}>
              <MaterialIcons name={status.playing ? 'graphic-eq' : 'spa'} size={56} color={c.brand.primary} />
            </View>

            {/* Progress (display only, no seek) */}
            <View style={[styles.progTrack, { backgroundColor: c.progressTrack }]}>
              <View style={[styles.progFill, { width: `${progress * 100}%`, backgroundColor: c.brand.primary }]} />
            </View>

            <Pressable
              onPress={() => (status.playing ? player.pause() : player.play())}
              style={[styles.playBtn, { backgroundColor: c.brand.primary }]}
            >
              <MaterialIcons name={status.playing ? 'pause' : 'play-arrow'} size={32} color="#FFFFFF" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  h1: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', marginTop: 4 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 16 },

  list: { gap: 12, paddingBottom: 32 },
  sceneCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 16 },
  sceneText: { flex: 1 },
  sceneTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sceneSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 3 },
  soon: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  playRoot: {},
  playCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  playTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  playSub: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 8 },
  orb: { width: 180, height: 180, borderRadius: 90, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  progTrack: { width: '80%', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 12 },
  progFill: { height: '100%', borderRadius: 3 },
  playBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginTop: 8 },

  doneBlock: { alignItems: 'center', gap: 16, marginTop: 20 },
  doneText: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  doneBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 16, marginTop: 8 },
  doneBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
