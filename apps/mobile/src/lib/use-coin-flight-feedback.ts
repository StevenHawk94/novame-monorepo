import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { createCoinFlightFeedback } from './coin-flight-feedback';
import { createCompletionSoundPlayer } from './completion-sound-player';
import { FOREGROUND_AUDIO_MODE } from './foreground-audio-mode';
import { getInteractionPreferences, subscribeInteractionPreferences } from './interaction-preferences';
import { subscribeSessionIdentity } from './session-lifecycle';
import { coinRewardClock } from './coin-reward-store';
import { afterUiSettles } from './ui-idle';
import { haptics } from './haptics';
import { privateAudioFocused, subscribePrivateAudioFocus } from './burrow-audio-focus';

const COIN_SOUND = require('../../assets/sound-effect/coin-collect.mp3');

/** Owned once by the wallet controller, never by a page or its portal. Preload
 * silently; if unavailable at flight start, skip audio instead of playing late. */
export function useCoinFlightFeedback() {
  const live = useRef(false);
  const sound = useRef<{player: AudioPlayer; effect: ReturnType<typeof createCompletionSoundPlayer>} | null>(null);
  const feedback = useRef<ReturnType<typeof createCoinFlightFeedback> | null>(null);
  if (!feedback.current) feedback.current = createCoinFlightFeedback({
    now: coinRewardClock,
    isActive: () => live.current && AppState.currentState === 'active',
    pulse: () => haptics.light(),
    play: () => {
      if (privateAudioFocused() || !getInteractionPreferences().sound || !sound.current?.player.currentStatus.isLoaded) return;
      sound.current.effect.play();
    },
    stopSound: () => sound.current?.effect.stop(),
  });
  useEffect(() => {
    live.current = true;
    const fx = feedback.current!;
    const release = () => {
      const previous = sound.current; sound.current = null;
      previous?.effect.dispose();
      try { previous?.player.release(); } catch { /* Released native shared object. */ }
    };
    const prepare = () => {
      if (!live.current || sound.current || privateAudioFocused() || !getInteractionPreferences().sound || AppState.currentState !== 'active') return;
      try { void setAudioModeAsync(FOREGROUND_AUDIO_MODE).catch(() => {}); } catch { /* Optional native audio. */ }
      let player: AudioPlayer | undefined;
      try {
        player = createAudioPlayer(COIN_SOUND, {updateInterval: 1000, keepAudioSessionActive: false});
        sound.current = {player, effect: createCompletionSoundPlayer(player, () => live.current && !privateAudioFocused() && AppState.currentState === 'active' && getInteractionPreferences().sound)};
      } catch { try { player?.remove(); player?.release(); } catch {} }
    };
    let cancelPrepare = afterUiSettles(prepare, {delayMs: 80});
    const app = AppState.addEventListener('change', state => {
      cancelPrepare();
      if (state === 'active') cancelPrepare = afterUiSettles(prepare, {delayMs: 80});
      else { fx.stop(); release(); }
    });
    const preferences = subscribeInteractionPreferences(() => {
      if (!getInteractionPreferences().haptics) fx.stopPulses();
      if (!getInteractionPreferences().sound) release(); else prepare();
    });
    const identity = subscribeSessionIdentity(() => {
      cancelPrepare(); fx.stop(); release();
      cancelPrepare = afterUiSettles(prepare, {delayMs: 80});
    });
    const focus = subscribePrivateAudioFocus(() => {
      cancelPrepare();
      if (privateAudioFocused()) release();
      else cancelPrepare = afterUiSettles(prepare, {delayMs: 80});
    });
    return () => { live.current = false; cancelPrepare(); app.remove(); preferences(); identity(); focus(); fx.stop(); release(); };
  }, []);
  return feedback.current;
}
