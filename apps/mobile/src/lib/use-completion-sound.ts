import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { createCompletionSoundPlayer } from './completion-sound-player';

const COMPLETION_SOUND = require('../../assets/music/reflection-finished.mp3');

/** Preload while this screen is focused; release on navigation and never resume in the background. */
export function useCompletionSound() {
  const sound = useRef<ReturnType<typeof createCompletionSoundPlayer> | null>(null);
  const lastEvent = useRef<string | undefined>(undefined);
  useFocusEffect(useCallback(() => {
    const release = () => {
      sound.current?.dispose();
      sound.current = null;
    };
    const prepare = () => {
      if (sound.current || AppState.currentState !== 'active') return;
      // Configure before completion, not when the chime should already be heard.
      // Otherwise iOS sound depends on whether Focus happened to set this first.
      void setAudioModeAsync({
        shouldPlayInBackground: false,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
      }).catch((error) => console.warn('[completion-sound] audio mode unavailable:', error));
      let player: ReturnType<typeof createAudioPlayer> | undefined;
      try {
        player = createAudioPlayer(COMPLETION_SOUND, { updateInterval: 1000, keepAudioSessionActive: false });
        sound.current = createCompletionSoundPlayer(player, () => AppState.currentState === 'active');
      } catch (error) {
        try { player?.remove(); } catch { /* Already released. */ }
        console.warn('[completion-sound] audio unavailable:', error);
      }
    };
    prepare();
    const appState = AppState.addEventListener('change', (state) => {
      // Release rather than merely pause: expo-audio can auto-resume previously
      // playing native players on foreground. A completed chime must not resume.
      if (state === 'active') prepare(); else release();
    });
    return () => { appState.remove(); release(); };
  }, []));
  const play = useCallback((eventId?: string) => {
    if (eventId && lastEvent.current === eventId) return;
    if (sound.current?.play() && eventId) lastEvent.current = eventId;
  }, []);
  const stop = useCallback(() => sound.current?.stop(), []);
  return { play, stop };
}
