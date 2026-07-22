import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { FOCUS_SCENES, type FocusScene } from '@novame/domain';
import { haptics } from '../../src/lib/haptics';
import { getCachedSubscriptionTier } from '../../src/lib/subscription';
import { submitFocus } from '../../src/lib/focus-api';
import { BACKGROUNDS, FOCUS_SCENE_ICONS } from '../../src/lib/icons';
import { CloverBurst } from '../../src/components/main/clover-burst';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { XP_RULES } from '@novame/engine';

// Test-phase bundled audio. Every free scene falls back to the one bundled
// track until its own recording lands (the R2 manifest replaces these);
// locked/paid scenes with no track show "Soon".
const WORK1 = require('../../assets/audio/focus/work1.mp3');
const LOCAL_TRACKS: Record<string, number> = {
  work: WORK1,
  learn: WORK1, // placeholder until learn1.mp3 lands
  connect: WORK1, // placeholder until connect1.mp3 lands
};

type Phase = 'select' | 'play';

// Design palette (focus mocks): sky backdrop, deep-green text, teal offset.
const GREEN = '#1E4D3B';
const TEAL_OFFSET = '#7BC5C0';

/** "02.55" style time per the play mock. */
function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}.${String(s % 60).padStart(2, '0')}`;
}

/**
 * Focus (C10, v2.0 design). Pick what you're preparing for, play the guided
 * track over the full-bleed sky art, and it completes when playback finishes.
 * Pause/resume only, no seeking (the progress bar is display-only — PRD).
 * Audio keeps playing when the screen locks or backgrounds. Completing
 * credits +30 clovers (twice a day); quitting before the end credits nothing.
 */
export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

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

  // Completion fires only when the track has actually finished playing
  // (didJustFinish), not a couple seconds early -- the settle screen should
  // appear when the audio ends, not before it does. Credit once.
  useEffect(() => {
    if (phase !== 'play' || creditedRef.current) return;
    if (status.didJustFinish) {
      creditedRef.current = true;
      setCompleted(true);
      void haptics.medium();
      if (scene) void submitFocus({ sceneId: scene.id, trackIndex: 1 });
    }
  }, [status.didJustFinish, phase, scene]);

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

  // ---- SELECT (design: "What are you preparing for?") ----
  if (phase === 'select') {
    return (
      <ImageBackground source={BACKGROUNDS.focus} style={styles.root} resizeMode="cover">
        <View style={[styles.inner, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => router.back()} style={styles.backDark} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.h1}>What are you preparing for?</Text>
          <Text style={styles.sub}>Get your mind clear, focused, and ready in just 3 minutes.</Text>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {FOCUS_SCENES.map((s) => {
              const locked = !s.free && !isPaid;
              const noTrack = !LOCAL_TRACKS[s.id];
              return (
                <OffsetCard
                  key={s.id}
                  color={TEAL_OFFSET}
                  radius={26}
                  onPress={() => startScene(s)}
                  disabled={locked || noTrack}
                  cardStyle={[styles.sceneCard, (locked || noTrack) && { opacity: 0.6 }]}
                >
                  <View style={styles.sceneText}>
                    <Text style={styles.sceneTitle}>{s.title}</Text>
                    <Text style={styles.sceneSub}>{s.subtitle}</Text>
                  </View>
                  {locked ? (
                    <MaterialIcons name="lock" size={26} color="#9BB8B4" />
                  ) : noTrack ? (
                    <Text style={styles.soon}>Soon</Text>
                  ) : (
                    <Image source={FOCUS_SCENE_ICONS[s.id]} style={styles.sceneIcon} resizeMode="contain" />
                  )}
                </OffsetCard>
              );
            })}
          </ScrollView>
        </View>
      </ImageBackground>
    );
  }

  // ---- PLAY (design: full sky, bottom-anchored info + round pause) ----
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  return (
    <ImageBackground source={BACKGROUNDS.focus} style={styles.root} resizeMode="cover">
      <View style={[styles.inner, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={exit} style={styles.backLight} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={GREEN} />
        </Pressable>

        <View style={[styles.playBottom, { paddingBottom: insets.bottom + 24 }]}>
          {completed ? (
            <View style={styles.doneBlock}>
              <CloverBurst amount={XP_RULES.focus.award} />
              <MaterialIcons name="check-circle" size={64} color="#FFFFFF" />
              <Text style={styles.doneText}>Done. Carry that with you.</Text>
              <Pressable onPress={() => router.back()} style={styles.doneBtn}>
                <Text style={styles.doneBtnText}>Finish</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.playTitle}>{scene?.title} #1</Text>
              <Text style={styles.playSub}>{scene?.subtitle}</Text>

              {/* Display-only progress with times, per the mock. */}
              <View style={styles.progRow}>
                <Text style={styles.progTime}>{fmtTime(status.currentTime)}</Text>
                <View style={styles.progTrack}>
                  <View style={[styles.progFill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.progDot, { left: `${progress * 100}%` }]} />
                </View>
                <Text style={styles.progTime}>{fmtTime(status.duration)}</Text>
              </View>

              <Pressable
                onPress={() => (status.playing ? player.pause() : player.play())}
                style={styles.playBtn}
                hitSlop={8}
              >
                <MaterialIcons name={status.playing ? 'pause' : 'play-arrow'} size={34} color={GREEN} />
              </Pressable>
            </>
          )}
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 20 },

  backDark: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#1B1B1B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  backLight: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },

  h1: { fontSize: 27, fontFamily: 'Inter_800ExtraBold', color: GREEN },
  sub: { fontSize: 15, fontFamily: 'Inter_500Medium', color: GREEN, marginTop: 8, marginBottom: 18, lineHeight: 21 },

  list: { paddingBottom: 32 },
  sceneCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 20, paddingHorizontal: 20, gap: 12,
  },
  sceneText: { flex: 1 },
  sceneTitle: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: GREEN },
  sceneSub: { fontSize: 14, fontFamily: 'Inter_500Medium', color: GREEN, marginTop: 4, lineHeight: 20 },
  sceneIcon: { width: 64, height: 64 },
  soon: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#9BB8B4' },

  playBottom: { flex: 1, justifyContent: 'flex-end' },
  playTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  playSub: { fontSize: 16, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.92)', marginTop: 6 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  progTime: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', width: 42 },
  progTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  progFill: { height: '100%', borderRadius: 2, backgroundColor: '#FFFFFF' },
  progDot: {
    position: 'absolute', top: -4, width: 12, height: 12, borderRadius: 6,
    marginLeft: -6, backgroundColor: '#F0885C',
  },
  playBtn: {
    alignSelf: 'center', marginTop: 22,
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1B3B38', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  doneBlock: { alignItems: 'center', gap: 16 },
  doneText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  doneBtn: {
    paddingHorizontal: 44, paddingVertical: 15, borderRadius: 18, backgroundColor: '#FFFFFF',
  },
  doneBtnText: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', color: GREEN },
});
