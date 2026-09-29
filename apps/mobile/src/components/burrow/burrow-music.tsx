import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { createBurrowAudioController } from '@/lib/burrow-audio-controller';
import { useBurrowSnapshot, runBurrowAction, burrowErrorMessage } from '@/lib/burrow-store';
import { purchaseCatalogItem, selectRoomMusic, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { subscribeSessionIdentity } from '@/lib/session-lifecycle';

const tracks: Record<string, number> = { calm: require('../../../assets/burrow/calm.wav'), dream: require('../../../assets/burrow/dream.wav') };
const listeners = new Set<() => void>();
let playback = { failed: false, retry: 0 };
const publish = (patch: Partial<typeof playback>) => { playback = { ...playback, ...patch }; listeners.forEach(fn => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const usePlayback = () => useSyncExternalStore(subscribe, () => playback, () => playback);

function bundledPlayer(key: string) {
  const native = createAudioPlayer(tracks[key], { updateInterval: 1000, keepAudioSessionActive: false });
  let disposed = false;
  const timeout = setTimeout(() => { if (!disposed && !native.isLoaded) { publish({ failed: true }); release(); } }, 15_000);
  const status = native.addListener('playbackStatusUpdate', value => {
    if (value.isLoaded) clearTimeout(timeout);
    if (value.playbackState === 'error' && !disposed) { publish({ failed: true }); release(); }
  });
  function release() { if (disposed) return; disposed = true; clearTimeout(timeout); status.remove(); native.remove(); }
  return {
    get loop() { return native.loop; }, set loop(value: boolean) { native.loop = value; },
    get volume() { return native.volume; }, set volume(value: number) { native.volume = value; },
    play: () => native.play(), remove: release,
  };
}

/** One instance in MainLayout, not one per room or screen. Never background audio. */
export function BurrowMusicGate() {
  const enabled = useMajorUpdateEnabled();
  const { data, error } = useBurrowSnapshot();
  const { retry } = usePlayback();
  const track = data?.catalog.find(item => item.stable_id === data.musicTrackId && item.item_type === 'music');
  const owned = data?.inventory.some(item => item.owner_id === data.profile.id && item.item_id === track?.stable_id);
  const key = enabled && owned && !['not_paired','feature_disabled'].includes(error ?? '') && typeof track?.asset.bundleKey === 'string' && typeof tracks[track.asset.bundleKey] === 'number' ? track.asset.bundleKey : null;
  useEffect(() => {
    const audio = createBurrowAudioController(
      () => setAudioModeAsync({ shouldPlayInBackground: false, playsInSilentMode: true, interruptionMode: 'duckOthers' }),
      bundledPlayer,
      failed => publish({ failed }),
    );
    let signedOut = false;
    const update = () => { void audio.select(!signedOut && AppState.currentState === 'active' ? key : null); };
    update();
    const app = AppState.addEventListener('change', update);
    const identity = subscribeSessionIdentity(() => { signedOut = true; audio.stop(); });
    return () => { app.remove(); identity(); audio.stop(); };
  }, [key, data?.profile.id, retry]);
  return null;
}

export function BurrowMusicPicker({ data, onClose }: { data: MajorUpdateBootstrap; onClose: () => void }) {
  const { busy, error } = useBurrowSnapshot();
  const { failed } = usePlayback();
  const choose = (id: string | null) => { void runBurrowAction(`music:${id}`, () => selectRoomMusic(id)); };
  return <Modal transparent animationType="slide" onRequestClose={onClose}><View style={s.scrim}><View style={s.sheet}>
    <Text style={s.title}>A little background music</Text>
    <Text style={s.copy}>Temporary tunes for now. Your selection follows you through the app, loops while it is open, and stops in the background.</Text>
    {error && <Text accessibilityRole="alert" style={s.copy}>{burrowErrorMessage(error)}</Text>}
    {failed && <Pressable accessibilityRole="button" onPress={() => publish({ retry: playback.retry + 1 })}><Text style={s.copy}>Audio is unavailable. Tap to retry.</Text></Pressable>}
    <ScrollView contentContainerStyle={{ gap: 12 }}>
      <Pressable accessibilityRole="button" disabled={busy} style={s.track} onPress={() => choose(null)}><Text style={s.copy}>None {!data.musicTrackId ? '✓' : ''}</Text></Pressable>
      {data.catalog.filter(item => item.item_type === 'music').map(item => {
        const owned = data.inventory.some(row => row.owner_id === data.profile.id && row.item_id === item.stable_id);
        const bundled = typeof item.asset.bundleKey === 'string' && typeof tracks[item.asset.bundleKey] === 'number';
        return <Pressable key={item.stable_id} accessibilityRole="button" disabled={busy || !bundled}
          style={[s.track, (busy || !bundled) && { opacity: .5 }]} onPress={() => {
            if (owned) choose(item.stable_id);
            else Alert.alert('Add this tune?', `${item.title} · ${item.price} carrots`, [{ text: 'Cancel', style: 'cancel' },
              { text: 'Buy', onPress: () => { void runBurrowAction(`buy:${item.stable_id}:${data.profile.id}`, id => purchaseCatalogItem(item.stable_id, data.profile.id, id)); } }]);
          }}><Text style={s.copy}>🎵 {item.title} {data.musicTrackId === item.stable_id ? '✓' : ''}</Text><Text style={s.copy}>{!bundled ? 'Available with an app update' : owned ? 'Owned · tap to play' : `${item.price} carrots · buy here`}</Text></Pressable>;
      })}
    </ScrollView>
    <Pressable accessibilityRole="button" style={s.track} onPress={onClose}><Text style={s.copy}>Done</Text></Pressable>
  </View></View></Modal>;
}
const s = StyleSheet.create({ scrim: { flex: 1, backgroundColor: '#21130CCC', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '85%', borderRadius: 28, padding: 24, gap: 18, backgroundColor: '#FFF4E1' },
  title: { color: '#553521', fontSize: 23, fontWeight: '800' }, copy: { color: '#79563E', fontSize: 16, lineHeight: 24 },
  track: { padding: 16, borderRadius: 18, backgroundColor: '#F4DEBB' },
});
