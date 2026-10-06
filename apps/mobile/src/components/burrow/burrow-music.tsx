import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Alert, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBurrowAudioController } from '@/lib/burrow-audio-controller';
import { useBurrowSnapshot, runBurrowAction, burrowErrorMessage, scheduleBurrowRefresh, selectBurrowMusicLocally, confirmBurrowMusicLocally } from '@/lib/burrow-store';
import { purchaseCatalogItem, selectRoomMusic, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { createLatestSelectionQueue } from '@/lib/latest-selection-queue';
import { storage } from '@/lib/storage';
import { kBurrowMusicMuted } from '@/shared/storage/keys';
import { haptics } from '@/lib/haptics';

const tracks: Record<string, number> = { calm: require('../../../assets/burrow/calm.wav'), dream: require('../../../assets/burrow/dream.wav') };
const listeners = new Set<() => void>();
let playback = { failed: false, selectionFailed: false, retry: 0, muted: storage.getString(kBurrowMusicMuted.name) === 'true' };
const publish = (patch: Partial<typeof playback>) => { playback = { ...playback, ...patch }; listeners.forEach(fn => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const usePlayback = () => useSyncExternalStore(subscribe, () => playback, () => playback);
function setMuted(muted: boolean) { publish({ muted }); try { storage.set(kBurrowMusicMuted.name, String(muted)); } catch {} }
let confirmedTrack: string | null | undefined;
const musicQueue = createLatestSelectionQueue<{ id: string | null; token: number }>(async choice => {
  const epoch = sessionEpoch();
  await selectRoomMusic(choice.id);
  if (epoch !== sessionEpoch()) return;
  confirmedTrack = choice.id; confirmBurrowMusicLocally(choice.token); scheduleBurrowRefresh();
}, choice => { confirmBurrowMusicLocally(choice.token, confirmedTrack ?? null); scheduleBurrowRefresh(); publish({ selectionFailed: true }); });
subscribeSessionIdentity(() => { musicQueue.reset(); confirmedTrack = undefined; publish({ selectionFailed: false, failed: false }); });

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
  const { retry, muted } = usePlayback();
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
    const update = () => { void audio.select(!signedOut && !muted && AppState.currentState === 'active' ? key : null); };
    update();
    const app = AppState.addEventListener('change', update);
    const identity = subscribeSessionIdentity(() => { signedOut = true; audio.stop(); });
    return () => { app.remove(); identity(); audio.stop(); };
  }, [key, data?.profile.id, retry, muted]);
  return null;
}

export function BurrowMusicPicker({ data, onClose }: { data: MajorUpdateBootstrap; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { data: latest, busy, error } = useBurrowSnapshot();
  const room = latest?.profile.id === data.profile.id ? latest : data;
  const { failed, selectionFailed, muted } = usePlayback();
  const music = room.catalog.filter(item => item.item_type === 'music');
  const current = music.find(item => item.stable_id === room.musicTrackId);
  const choose = (id: string | null) => {
    void haptics.light();
    if (id) setMuted(false);
    if (!musicQueue.isPending()) confirmedTrack = room.musicTrackId;
    publish({ selectionFailed: false });
    const token = selectBurrowMusicLocally(id);
    void musicQueue.select({ id, token });
  };
  return <Modal animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
    <View style={s.root}>
      <StatusBar hidden={false} barStyle="light-content" backgroundColor="#2B1A13" translucent />
      <LinearGradient colors={['#332016','#22130E','#2B1A13']} locations={[0,.56,1]} style={StyleSheet.absoluteFillObject} />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFillObject} viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Path d="M0 0H156C123 21 113 50 62 47C34 46 12 51 0 57Z" fill="#4B3024" opacity=".55" />
        <Path d="M293 0H390V143C364 104 331 95 311 58C301 38 296 15 293 0Z" fill="#422A21" opacity=".45" />
        <Path d="M0 785C17 811 45 822 72 844H0Z" fill="#42291F" opacity=".55" />
        <Path d="M390 778C366 802 348 824 321 844H390Z" fill="#3A241B" opacity=".45" />
      </Svg>
      <ScrollView contentContainerStyle={[s.content,{paddingTop:insets.top+16,paddingBottom:insets.bottom+28}]} showsVerticalScrollIndicator={false}>
        <View style={s.nav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close music" onPress={onClose} hitSlop={10} style={s.navButton}>
            <Feather name="chevron-left" size={34} color="#F4E8DF" />
          </Pressable>
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
        <Text style={s.nowPlayingCaption}>{current ? muted ? 'Paused in your room' : 'Playing in your room' : 'Quiet in your room'}</Text>
        <View style={s.separator}/>
        {error && <Text accessibilityRole="alert" style={s.error}>{burrowErrorMessage(error)}</Text>}
        {failed && <Pressable accessibilityRole="button" onPress={() => publish({ retry: playback.retry + 1 })}><Text style={s.error}>Audio is unavailable. Tap to retry.</Text></Pressable>}
        {selectionFailed && <Text accessibilityRole="alert" style={s.error}>Couldn’t change the music. Tap a track to retry.</Text>}
        <View style={s.trackList}>
          {music.map((item,index) => {
            const owned = room.inventory.some(row => row.owner_id === room.profile.id && row.item_id === item.stable_id);
            const bundled = typeof item.asset.bundleKey === 'string' && typeof tracks[item.asset.bundleKey] === 'number';
            const selected = room.musicTrackId === item.stable_id;
            return <Pressable key={item.stable_id} accessibilityRole="button" accessibilityLabel={`${item.title}${owned?'':`, ${item.price} carrots`}`}
              accessibilityState={{selected,disabled:busy||!bundled}} disabled={busy||!bundled}
              style={({pressed})=>[s.track,(pressed||busy||!bundled)&&s.trackPressed]} onPress={() => {
                if (owned) choose(item.stable_id);
                else Alert.alert('Add this tune?', `${item.title} · ${item.price} carrots`, [{ text: 'Cancel', style: 'cancel' },
                  { text: 'Buy', onPress: () => { void runBurrowAction(`buy:${item.stable_id}:${room.profile.id}`, id => purchaseCatalogItem(item.stable_id, room.profile.id, id)); } }]);
              }}>
              <MaterialCommunityIcons name={index===0?'headphones':index===1?'weather-sunset':'heart'} size={32}
                color={index===0?'#AEC6B0':index===1?'#F4BD6D':'#D6755C'} style={s.trackIcon} />
              <View style={s.trackCopy}><Text style={s.trackTitle} numberOfLines={1}>{item.title}</Text>
                {!bundled||!owned?<Text style={s.trackMeta}>{!bundled?'Available with an app update':`${item.price} carrots`}</Text>:null}</View>
              <Feather name={selected?'check-circle':'play-circle'} size={28} color={selected?'#A9BEA7':'#E9CEBD'} />
            </Pressable>;
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="No music" accessibilityState={{selected:!room.musicTrackId,disabled:busy}}
            disabled={busy} style={({pressed})=>[s.track,pressed&&s.trackPressed]} onPress={()=>choose(null)}>
            <MaterialCommunityIcons name="music-off" size={32} color="#D6BBAA" style={s.trackIcon}/>
            <Text style={[s.trackTitle,{flex:1}]}>No music</Text>
            <Feather name={!room.musicTrackId?'check-circle':'play-circle'} size={28} color={!room.musicTrackId?'#A9BEA7':'#E9CEBD'} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  </Modal>;
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
  error:{color:'#F4B5A6',fontSize:13,lineHeight:20,marginBottom:12},
});
