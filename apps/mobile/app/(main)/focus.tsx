import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { createOperationScope, withDeadline } from '@/lib/async-lifecycle';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { appAlert } from '@/components/ui/app-dialog';
import { MaterialIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { FOCUS_SCENES, type FocusScene } from '@novame/domain';
import { haptics } from '../../src/lib/haptics';
import { useCompletionSound } from '../../src/lib/use-completion-sound';
import { useSubscriptionTier } from '../../src/lib/use-subscription-tier';
import { submitFocus } from '../../src/lib/focus-api';
import { optimisticCloverAward } from '../../src/lib/cosmetics-api';
import { BACKGROUNDS, FOCUS_SCENE_ICONS } from '../../src/lib/icons';
import { CloverBurst } from '../../src/components/main/clover-burst';
import { OffsetCard } from '../../src/components/ui/offset-card';
import { SwipeDownToDismiss } from '../../src/components/ui/swipe-down-to-dismiss';
import { FeatureGuideModal } from '../../src/components/main/feature-guide-modal';
import {
  FOCUS_VOICE_BUNDLED, getFocusVoiceSource, onFocusVoiceListened, type FocusVoiceSource,
} from '../../src/lib/focus-voice';
import { XP_RULES } from '@novame/engine';
import { AndroidCompactText as Text } from '@/components/ui/android-compact-typography';

// Focus voice rotation (2026-08-08): track 1 per scene is bundled, later
// tracks stream/prefetch from R2 — see src/lib/focus-voice.ts.

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
 * Audio playback is foreground-only. Completing credits +30 clovers (twice a
 * day); quitting before the end credits nothing.
 */
export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { play: playCompletionSound, stop: stopCompletionSound } = useCompletionSound();

  const [phase, setPhase] = useState<Phase>('select');
  const [scene, setScene] = useState<FocusScene | null>(null);
  const isPaid = useSubscriptionTier() !== 'free';
  const [completed, setCompleted] = useState(false);
  const [reward, setReward] = useState(0);
  const creditedRef = useRef(false);
  const selectScrollOffsetRef = useRef(0);
  const playback = useRef(createOperationScope()).current;
  const focused = useRef(false);

  // One player for the whole screen; the source resolves async when a scene
  // starts (bundled track 1, prefetched cache file, or an R2 stream).
  const [audio, setAudio] = useState<{ source: FocusVoiceSource; index: number; sceneId: string } | null>(null);
  const player = useAudioPlayer(audio?.source ?? null);
  const status = useAudioPlayerStatus(player);
  const latestPlayer = useRef(player);
  latestPlayer.current = player;
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      playback.invalidate();
      // expo-audio may already have released the native player on unmount.
      try { latestPlayer.current.pause(); } catch { /* already disposed */ }
    };
  }, [playback]));

  // Keep playback available in silent mode, but stop it when the app backgrounds.
  useEffect(() => {
    void setAudioModeAsync({
      shouldPlayInBackground: false,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    }).catch(error => console.warn('[focus] audio mode failed:', error));
  }, []);

  // Completion fires only when the track has actually finished playing
  // (didJustFinish), not a couple seconds early -- the settle screen should
  // appear when the audio ends, not before it does. Credit once.
  useEffect(() => {
    if (!focused.current || phase !== 'play' || creditedRef.current || !audio || audio.sceneId !== scene?.id) return;
    if (status.didJustFinish) {
      creditedRef.current = true;
      playCompletionSound();
      setCompleted(true);
      setReward(XP_RULES.focus.award);
      void haptics.medium();
      if (scene) {
        const current = playback.begin();
        const epoch = sessionEpoch();
        const award = optimisticCloverAward(XP_RULES.focus.award);
        void withDeadline(submitFocus({ sceneId: scene.id, trackIndex: audio?.index ?? 1 }), 20000).then((result) => {
          if (epoch !== sessionEpoch()) return;
          if (result.ok) {
            const actual = result.xpAwarded ?? 0;
            if (current()) setReward(actual);
            award.commit(actual);
          } else {
            if (current()) setReward(0);
            award.rollback();
          }
        }).catch(() => {
          if (epoch !== sessionEpoch()) return;
          award.rollback();
          if (current()) setReward(0);
        });
      }
    }
  }, [status.didJustFinish, phase, scene, audio, playCompletionSound, playback]);

  const startScene = useCallback(
    (s: FocusScene) => {
      if (!focused.current || (!s.free && !isPaid)) return; // locked or closing
      const current = playback.begin();
      latestPlayer.current.pause();
      setAudio(null);
      stopCompletionSound();
      void haptics.medium();
      creditedRef.current = false;
      setCompleted(false);
      setReward(0);
      setScene(s);
      setPhase('play');
      void withDeadline(getFocusVoiceSource(s.id)).then((resolved) => {
        if (!current()) return;
        setAudio({ ...resolved, sceneId: s.id });
        // Listening has begun: discover new uploads + prefetch tomorrow's track.
        void onFocusVoiceListened(s.id, resolved.index);
      }).catch(() => {
        if (!current()) return;
        setPhase('select');
        setScene(null);
        appAlert('Could not start audio', 'Please try again.');
      });
    },
    [isPaid, stopCompletionSound, playback],
  );

  // Autoplay once the (async-resolved) source is loaded in play phase. `audio`
  // and `player` are real deps: the player instance is recreated when the
  // resolved source lands, and the old effect closure would call play() on the
  // stale one — the "have to tap play" bug.
  useEffect(() => {
    if (focused.current && phase === 'play' && audio && status.isLoaded && !status.playing && !completed) {
      player.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status.isLoaded, audio, player]);

  const exit = useCallback(() => {
    playback.invalidate();
    stopCompletionSound();
    player.pause();
    setPhase('select');
    setScene(null);
    setAudio(null);
  }, [player, stopCompletionSound, playback]);

  // ---- SELECT (design: "What are you preparing for?") ----
  if (phase === 'select') {
    return (
      <SwipeDownToDismiss
        onDismiss={() => router.back()}
        canStart={() => selectScrollOffsetRef.current <= 1}
      >
        <ImageBackground source={BACKGROUNDS.focus} style={styles.root} resizeMode="cover">
          <View style={[styles.inner, { paddingTop: insets.top + 10 }]}>
            <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.backDark} hitSlop={12}>
              <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.h1}>What are you preparing for?</Text>
            <Text style={styles.sub}>Get your mind clear, focused, and ready in just 3 minutes.</Text>

            <ScrollView
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              onScroll={(event) => { selectScrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >
              {FOCUS_SCENES.map((s) => {
                const locked = !s.free && !isPaid;
                // Every scene has a bundled track 1 now — no more 'Soon' gating.
                const noTrack = !FOCUS_VOICE_BUNDLED[s.id];
                return (
                  <OffsetCard
                    key={s.id}
                    color={TEAL_OFFSET}
                    offset={4}
                    radius={26}
                    onPress={() => startScene(s)}
                    disabled={locked || noTrack}
                    cardStyle={styles.sceneCard}
                  >
                    <View style={styles.sceneText}>
                      <View style={styles.sceneTitleRow}>
                        <Text style={styles.sceneTitle}>{s.title}</Text>
                        {locked && (
                          <View style={styles.plusBadge}>
                            <Text style={styles.plusBadgeText}>Plus</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.sceneSub}>{s.subtitle}</Text>
                    </View>
                    <Image source={FOCUS_SCENE_ICONS[s.id]} style={styles.sceneIcon} resizeMode="contain" />
                  </OffsetCard>
                );
              })}
              <Text style={styles.rewardNote}>
                You&apos;ll get a reward after completing a session, and a new session will be available the next day.
              </Text>
            </ScrollView>
          </View>
          <FeatureGuideModal guide="focus" />
        </ImageBackground>
      </SwipeDownToDismiss>
    );
  }

  // ---- PLAY (design: full sky, bottom-anchored info + round pause) ----
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  return (
    <SwipeDownToDismiss enabled={false} onDismiss={() => router.back()}>
      <ImageBackground source={BACKGROUNDS.focus} style={styles.root} resizeMode="cover">
        {/* 50% black scrim so white text/controls read over the art. */}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={[styles.inner, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => { void haptics.pageClose(); exit(); }} style={styles.backLight} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color={GREEN} />
          </Pressable>

          <View style={[styles.playBottom, { paddingBottom: insets.bottom + 24 }]}>
            {completed ? (
              <View style={styles.doneBlock}>
                {reward > 0 && <CloverBurst amount={reward} />}
                <MaterialIcons name="check-circle" size={64} color="#FFFFFF" />
                <Text style={styles.doneText}>Done. Carry that with you.</Text>
                <Pressable onPress={() => { void haptics.pageClose(); router.back(); }} style={styles.doneBtn}>
                  <Text style={styles.doneBtnText}>Finish</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.playTitle}>{scene?.title} #{audio?.index ?? 1}</Text>
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
    </SwipeDownToDismiss>
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

  list: { paddingBottom: 32, gap: 6 },
  rewardNote: {
    marginTop: 12, paddingHorizontal: 10, textAlign: 'center',
    fontSize: 12.5, lineHeight: 18, fontFamily: 'Inter_500Medium', color: GREEN,
  },
  sceneCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 20, gap: 12,
  },
  sceneText: { flex: 1 },
  sceneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sceneTitle: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: GREEN },
  // Locked = a quiet Plus tag beside the title, no dimming (design note).
  plusBadge: { backgroundColor: '#F0C24B', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  plusBadgeText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', color: '#5A3A1B' },
  sceneSub: { fontSize: 14, fontFamily: 'Inter_500Medium', color: GREEN, marginTop: 3, lineHeight: 19 },
  sceneIcon: { width: 58, height: 58 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },

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
