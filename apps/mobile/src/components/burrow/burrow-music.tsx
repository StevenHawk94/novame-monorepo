import { BurrowBackButton } from './burrow-back-button';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { FOREGROUND_AUDIO_MODE } from '@/lib/foreground-audio-mode';
import { getInteractionPreferences, subscribeInteractionPreferences } from '@/lib/interaction-preferences';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBurrowAudioController } from '@/lib/burrow-audio-controller';
import { releaseBurrowAudio } from '@/lib/burrow-audio-cleanup';
import { useBurrowSnapshot, burrowErrorMessage, scheduleBurrowRefresh, selectBurrowMusicLocally, confirmBurrowMusicLocally } from '@/lib/burrow-store';
import { selectRoomMusic, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { createLatestSelectionQueue } from '@/lib/latest-selection-queue';
import { storage } from '@/lib/storage';
import { kBurrowMusicMuted } from '@/shared/storage/keys';
import { haptics } from '@/lib/haptics';
import { BURROW_MUSIC_TRACKS, burrowMusicTrack, burrowMusicCatalog } from '@/lib/burrow-music-tracks';

const tracks: Record<string, number> = Object.fromEntries(BURROW_MUSIC_TRACKS.map(track => [track.key, track.source]));
const listeners = new Set<() => void>();
let playback = { failed: false, selectionFailed: false, retry: 0, muted: storage.getString(kBurrowMusicMuted.name) === 'true', suspended: false };
const publish = (patch: Partial<typeof playback>) => { playback = { ...playback, ...patch }; listeners.forEach(fn => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const usePlayback = () => useSyncExternalStore(subscribe, () => playback, () => playback);
function setMuted(muted: boolean) {
  if (muted) ambientAudio.stop();
  publish({ muted }); try { storage.set(kBurrowMusicMuted.name, String(muted)); } catch {}
}
const audioFocusOwners = new Set<object>();
/** Recordings and private messages must not mix with Home's ambient soundtrack. */
export function acquireBurrowAudioFocus() {
  const owner={}; audioFocusOwners.add(owner); ambientAudio.stop(); publish({suspended:true});
  return () => { audioFocusOwners.delete(owner); publish({suspended:audioFocusOwners.size>0}); };
}
let confirmedTrack: string | null | undefined;
const musicQueue = createLatestSelectionQueue<{ id: string | null; token: number }>(async choice => {
  const epoch = sessionEpoch();
  await selectRoomMusic(choice.id);
  if (epoch !== sessionEpoch()) return;
  confirmedTrack = choice.id; confirmBurrowMusicLocally(choice.token); scheduleBurrowRefresh();
}, choice => { confirmBurrowMusicLocally(choice.token, choice.id === null ? null : confirmedTrack ?? null); scheduleBurrowRefresh(); publish({ selectionFailed: true }); });
subscribeSessionIdentity(() => { ambientAudio.stop(); musicQueue.reset(); confirmedTrack = undefined; publish({ selectionFailed: false, failed: false }); });

function bundledPlayer(key: string) {
  const native = createAudioPlayer(tracks[key], { updateInterval: 1000, keepAudioSessionActive: false });
  let disposed = false;
  const timeout = setTimeout(() => { if (!disposed && !native.isLoaded) { publish({ failed: true }); release(); } }, 15_000);
  const status = native.addListener('playbackStatusUpdate', value => {
    if (value.isLoaded) clearTimeout(timeout);
    if (value.playbackState === 'error' && !disposed) { publish({ failed: true }); release(); }
  });
  function release() {
    if (disposed) return; disposed = true; clearTimeout(timeout);
    releaseBurrowAudio(native, () => status.remove());
  }
  return {
    get loop() { return native.loop; }, set loop(value: boolean) { native.loop = value; },
    get volume() { return native.volume; }, set volume(value: number) { native.volume = value; },
    play: () => native.play(), pause: () => native.pause(), remove: release,
  };
}

// Shared owner across effect rerenders: an async setup cannot resurrect a stale
// player after a rapid song change, None, backgrounding or a focus hand-off.
const ambientAudio = createBurrowAudioController(
  () => setAudioModeAsync(FOREGROUND_AUDIO_MODE),
  bundledPlayer, failed => publish({ failed }),
);

/** One instance in MainLayout, not one per room or screen. Never background audio. */
export function BurrowMusicGate() {
  const enabled = useMajorUpdateEnabled();
  const { data, error } = useBurrowSnapshot();
  const { retry, muted, suspended } = usePlayback();
  const track = data?.catalog.find(item => item.stable_id === data.musicTrackId && item.item_type === 'music');
  const recording = burrowMusicTrack(track);
  const key = enabled && recording && (!recording.plusOnly || data?.hasPlus)
    && !['not_paired','feature_disabled'].includes(error ?? '') ? recording.key : null;
  useEffect(() => {
    const audio = ambientAudio;
    let signedOut = false;
    // An AppState callback can arrive before React processes mute/focus updates.
    // Read the live flags, never restart from the previous render's closure.
    const update = () => { void audio.select(!signedOut && getInteractionPreferences().sound && !playback.muted && !playback.suspended && AppState.currentState === 'active' ? key : null); };
    update();
    const app = AppState.addEventListener('change', update);
    // Haptics shares the preference store, not the audio lifecycle. Re-selecting
    // even the same track stops/recreates its native player and interrupts music.
    let soundEnabled = getInteractionPreferences().sound;
    const preferences = subscribeInteractionPreferences(() => {
      const next = getInteractionPreferences().sound;
      if (next === soundEnabled) return;
      soundEnabled = next;
      update();
    });
    const identity = subscribeSessionIdentity(() => { signedOut = true; audio.stop(); });
    return () => { app.remove(); identity(); preferences(); audio.stop(); };
  }, [key, data?.profile.id, retry, muted, suspended]);
  return null;
}

export function BurrowMusicPicker({ data, onClose }: { data: MajorUpdateBootstrap; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { data: latest, error } = useBurrowSnapshot();
  const room = latest?.profile.id === data.profile.id ? latest : data;
  const { failed, selectionFailed, muted } = usePlayback();
  const music = burrowMusicCatalog(room.catalog);
  const current = music.find(item => item.stable_id === room.musicTrackId);
  const choose = (id: string | null) => {
    void haptics.light();
    // None must stay quiet even if offline persistence fails or a snapshot
    // still contains the previous server selection. Persist the local mute.
    setMuted(id === null);
    if (!musicQueue.isPending()) confirmedTrack = room.musicTrackId;
    publish({ selectionFailed: false });
    const token = selectBurrowMusicLocally(id);
    void musicQueue.select({ id, token });
  };
  return <View style={s.root}>
      <LinearGradient colors={['#332016','#22130E','#2B1A13']} locations={[0,.56,1]} style={StyleSheet.absoluteFillObject} />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFillObject} viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Path d="M0 0H156C123 21 113 50 62 47C34 46 12 51 0 57Z" fill="#4B3024" opacity="0.55" />
        <Path d="M293 0H390V143C364 104 331 95 311 58C301 38 296 15 293 0Z" fill="#422A21" opacity="0.45" />
        <Path d="M0 785C17 811 45 822 72 844H0Z" fill="#42291F" opacity="0.55" />
        <Path d="M390 778C366 802 348 824 321 844H390Z" fill="#3A241B" opacity="0.45" />
      </Svg>
      <ScrollView contentContainerStyle={[s.content,{paddingTop:insets.top+16,paddingBottom:insets.bottom+28}]} showsVerticalScrollIndicator={false}>
        <View style={s.nav}>
          <BurrowBackButton light accessibilityLabel="Close music" onPress={onClose}/>
          <Pressable accessibilityRole="button" accessibilityLabel={muted?'Unmute music':'Mute music'} accessibilityState={{selected:muted}}
            onPress={()=>{void haptics.light();setMuted(!muted);}} hitSlop={10} style={s.navButton}>
            <Feather name={muted?'volume-x':'volume-2'} size={28} color="#F4E8DF" />
          </Pressable>
        </View>
        <Text style={s.title}>Music</Text>
        <Text style={s.subtitle}>Choose what plays in your room.</Text>
        <Text style={s.sectionLabel}>NOW PLAYING</Text>
        <View style={s.nowPlaying}>
          <MaterialCommunityIcons name={current?'music-circle':'music-off'} size={32} color="#D6BBAA" style={s.trackIcon} />
          <Text style={s.nowPlayingTitle} numberOfLines={1}>{current?.title??'No music'}</Text>
          <MaterialCommunityIcons name="equalizer" size={31} color="#A9BEA7" />
        </View>
        <Text style={s.nowPlayingCaption}>{current ? current.plus_only && !room.hasPlus ? 'Plus required' : muted ? 'Paused in your room' : 'Playing in your room' : 'Quiet in your room'}</Text>
        <View style={s.separator}/>
        {error && <Text accessibilityRole="alert" style={s.error}>{burrowErrorMessage(error)}</Text>}
        {failed && <Pressable accessibilityRole="button" onPress={() => publish({ retry: playback.retry + 1 })}><Text style={s.error}>Audio is unavailable. Tap to retry.</Text></Pressable>}
        {selectionFailed && <Text accessibilityRole="alert" style={s.error}>Couldn’t change the music. Tap a track to retry.</Text>}
        <View style={s.trackList}>
          {music.map((item,index) => {
            const bundled = typeof item.asset.bundleKey === 'string' && typeof tracks[item.asset.bundleKey] === 'number';
            const locked = item.plus_only && !room.hasPlus;
            const selected = room.musicTrackId === item.stable_id;
            return <Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={`${item.title}${item.plus_only?', Plus Only':''}`}
              accessibilityState={{selected,disabled:!bundled}} disabled={!bundled}
              style={({pressed})=>[s.track,(pressed||!bundled)&&s.trackPressed]} onPress={() => {
                // Keep this native page underneath Plus. Popping then pushing
                // in the same frame races the back transition and loses Music.
                if (locked) { router.push('/(main)/(modals)/subscription-paywall'); }
                else choose(item.stable_id);
              }}>
              <MaterialCommunityIcons name={index===0?'headphones':index===1?'weather-sunset':'heart'} size={32}
                color={index===0?'#AEC6B0':index===1?'#F4BD6D':'#D6755C'} style={s.trackIcon} />
              <View style={s.trackCopy}><Text style={s.trackTitle} numberOfLines={1}>{item.title}</Text>
                {!bundled?<Text style={s.trackMeta}>Available with an app update</Text>:null}</View>
              {item.plus_only && <Text style={s.plusBadge}>PLUS</Text>}
              <Feather name={locked?'lock':selected?'check-circle':'play-circle'} size={28} color={selected?'#A9BEA7':'#E9CEBD'} />
            </Pressable>;
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="No music" accessibilityState={{selected:!current}}
            style={({pressed})=>[s.track,pressed&&s.trackPressed]} onPress={()=>choose(null)}>
            <MaterialCommunityIcons name="music-off" size={32} color="#D6BBAA" style={s.trackIcon}/>
            <Text style={[s.trackTitle,{flex:1}]}>No music</Text>
            <Feather name={!current?'check-circle':'play-circle'} size={28} color={!current?'#A9BEA7':'#E9CEBD'} />
          </Pressable>
        </View>
      </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  root:{flex:1,backgroundColor:'#24150F'},
  content:{paddingHorizontal:18},
  nav:{height:50,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:16},
  navButton:{width:42,height:44,alignItems:'center',justifyContent:'center'},
  title:{color:'#FFF9F4',fontSize:40,fontWeight:'800',lineHeight:48},
  subtitle:{color:'#C8AFA1',fontSize:17,lineHeight:24,marginTop:7},
  sectionLabel:{color:'#CBAE9B',fontSize:13,fontWeight:'600',letterSpacing:1.5,marginTop:25,marginBottom:13},
  nowPlaying:{minHeight:64,flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'rgba(105,72,58,.35)',borderRadius:13,paddingHorizontal:18},
  trackIcon:{width:36,textAlign:'center'},
  nowPlayingTitle:{flex:1,color:'#FFF9F4',fontSize:17,fontWeight:'600'},
  nowPlayingCaption:{color:'#BCA18F',fontSize:14,marginTop:9,marginHorizontal:2},
  separator:{height:1,backgroundColor:'#795A4C',opacity:.7,marginTop:15,marginBottom:16},
  trackList:{gap:10},
  track:{minHeight:64,flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'rgba(105,72,58,.35)',borderRadius:13,paddingHorizontal:18},
  trackPressed:{opacity:.58},
  trackCopy:{flex:1,justifyContent:'center'},
  trackTitle:{color:'#FFF9F4',fontSize:17,fontWeight:'600'},
  trackMeta:{color:'#BCA18F',fontSize:12,marginTop:2},
  plusBadge:{color:'#FFD586',backgroundColor:'#634326',borderRadius:6,paddingHorizontal:7,paddingVertical:4,fontSize:10,fontWeight:'800'},
  error:{color:'#F4B5A6',fontSize:13,lineHeight:20,marginBottom:12},
});
