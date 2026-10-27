const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, clock, flush, deferred } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const tracks = load('apps/mobile/src/lib/burrow-music-tracks.ts', {
  '../../assets/music/Lo-fi.MP3': 1, '../../assets/music/Lullaby.MP3': 2, '../../assets/music/Jazz.MP3': 3,
});
function harness(options = {}) {
  const pickerHooks=hooks(), gateHooks=hooks(), time=clock(); let activeHooks=pickerHooks;
  const choices=[], players=[], modes=[], routes=[], localStorage=new Map(), appListeners=new Set(), identities=[];
  let sound=true,haptics=true;const preferenceListeners=new Set();
  const app={ currentState:'active', addEventListener(_name,fn){appListeners.add(fn);return{remove:()=>appListeners.delete(fn)};} };
  const room = { profile:{id:'me'}, hasPlus:false, musicTrackId:null, catalog:[
    {stable_id:'placeholder_music_calm',item_type:'music',title:'Quiet Burrow',asset:{bundleKey:'calm'},price:0},
    {stable_id:'placeholder_music_dream',item_type:'music',title:'Little Daydream',asset:{bundleKey:'dream'},price:80},
    {stable_id:'placeholder_music_02',item_type:'music',title:'Lantern Waltz',asset:{renderer:'native'},price:300},
    {stable_id:'music_quiet_cave_01',item_type:'music',title:'Quiet Cave',asset:{renderer:'none'},price:0},
  ], inventory:[{owner_id:'me',item_id:'placeholder_music_02'}] };
  let token=0, closed=0;
  const api=load('apps/mobile/src/components/burrow/burrow-music.tsx', {
    '@/lib/foreground-audio-mode':options.policy?{FOREGROUND_AUDIO_MODE:options.policy}:load('apps/mobile/src/lib/foreground-audio-mode.ts'),
    '@/lib/interaction-preferences':{getInteractionPreferences:()=>({sound,haptics}),subscribeInteractionPreferences:fn=>{preferenceListeners.add(fn);return()=>preferenceListeners.delete(fn);}},
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    '@/lib/latest-selection-queue':load('apps/mobile/src/lib/latest-selection-queue.ts'),
    '@/lib/storage':{storage:{getString:key=>localStorage.get(key),set:(key,value)=>localStorage.set(key,value)}},
    '@/shared/storage/keys':{kBurrowMusicMuted:{name:'music-muted'}},
    react:{useEffect:(...args)=>activeHooks.react.useEffect(...args),useSyncExternalStore:(_sub,snapshot)=>snapshot()},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:app,Modal:'Modal',Pressable:'Pressable',ScrollView:'ScrollView',StatusBar:'StatusBar',
      StyleSheet:{create:value=>value,absoluteFillObject:{}},Text:'Text',View:'View'},
    'expo-router':{router:{push:route=>routes.push(route)}},
    'expo-audio':{async setAudioModeAsync(mode){
      modes.push(mode);
      // Mirror ExpoAudio iOS AudioUtils.validateAudioMode. A permissive mock
      // previously hid the invalid silent-mode + duckOthers configuration.
      if(!mode.playsInSilentMode&&(mode.interruptionMode==='duckOthers'||mode.allowsRecording||mode.shouldPlayInBackground))
        throw Error('InvalidAudioModeException');
      await options.prepare?.(mode);
    },createAudioPlayer(source){
      const player={source,playing:false,isLoaded:true,play(){this.playing=true;},pause(){this.playing=false;},
        // Model iOS: remove unregisters ONLY, not an immediate stop.
        remove(){this.unregistered=true;},release(){this.released=true;this.playing=false;},
        addListener(){return{remove(){if(options.listenerFailure)throw Error('listener already released');}};}};
      players.push(player);return player;
    }},
    'expo-linear-gradient':{LinearGradient:'LinearGradient'},
    '@expo/vector-icons':{Feather:'Feather',MaterialCommunityIcons:'MaterialCommunityIcons'},
    'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:50,bottom:30})},
    '@/lib/burrow-audio-controller':load('apps/mobile/src/lib/burrow-audio-controller.ts'),
    '@/lib/burrow-audio-cleanup':load('apps/mobile/src/lib/burrow-audio-cleanup.ts'),
    '@/lib/burrow-store':{useBurrowSnapshot:()=>({data:room,busy:true,error:null}),
      selectBurrowMusicLocally:id=>{room.musicTrackId=id;return++token;},
      confirmBurrowMusicLocally:(_token,rollback)=>{if(rollback!==undefined)room.musicTrackId=rollback;},
      scheduleBurrowRefresh(){},burrowErrorMessage:value=>value},
    '@/lib/app-major-update-api':{selectRoomMusic:async id=>{choices.push(id);if(options.writeFailure)throw Error('offline');}},
    '@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
    '@/lib/session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity:fn=>{identities.push(fn);return()=>{};}},
    '@/lib/haptics':{haptics:{light:async()=>{}}},'@/lib/burrow-music-tracks':tracks,
  },time.globals);
  const render=()=>{activeHooks=pickerHooks;return pickerHooks.render(()=>api.BurrowMusicPicker({data:room,onClose(){closed++;}}));};
  const gate=()=>{activeHooks=gateHooks;return gateHooks.render(()=>api.BurrowMusicGate());};
  const tap=label=>{const node=nodes(render()).find(node=>node.props?.accessibilityLabel===label);
    assert.ok(node,label);assert.ok(!node.props.disabled,label);node.props.onPress();};
  const appState=state=>{app.currentState=state;appListeners.forEach(fn=>fn());};
  return{render,gate,tap,appState,room,choices,players,modes,routes,localStorage,api,identities,
    sound(value){sound=value;preferenceListeners.forEach(fn=>fn());},preferenceListeners,
    haptics(value){haptics=value;preferenceListeners.forEach(fn=>fn());},
    unmount:()=>gateHooks.unmount(),closed:()=>closed};
}
test('all three bundled songs initialize with an iOS-valid foreground mode, without bypassing silent switch or recording focus',async()=>{
  const h=harness();h.room.hasPlus=true;
  for(const id of ['placeholder_music_calm','placeholder_music_dream','placeholder_music_02']){
    h.room.musicTrackId=id;h.gate();await flush();
    assert.equal(h.players.filter(p=>p.playing).length,1);
    assert.ok(!nodes(h.render()).some(n=>n.props?.children==='Audio is unavailable. Tap to retry.'));
  }
  assert.deepEqual(h.players.map(p=>p.source),[1,2,3]);
  for(const mode of h.modes){
    assert.equal(mode.playsInSilentMode,false);assert.equal(mode.shouldPlayInBackground,false);
    assert.equal(mode.allowsRecording,false);assert.equal(mode.interruptionMode,'mixWithOthers');
  }
  h.unmount();assert.ok(h.players.every(p=>!p.playing));
});
test('old iOS-incompatible mode reproduces failure before creating a player; retry after legal mode setup clears the error',async()=>{
  const policy={playsInSilentMode:false,shouldPlayInBackground:false,allowsRecording:false,interruptionMode:'duckOthers'};
  const h=harness({policy});h.room.musicTrackId='placeholder_music_calm';h.gate();await flush();
  assert.equal(h.players.length,0,'the MP3 is never reached when mode initialization rejects');
  let error=nodes(h.render()).find(n=>n.props?.children==='Audio is unavailable. Tap to retry.');assert.ok(error);
  policy.interruptionMode='mixWithOthers';
  nodes(h.render()).find(n=>n.type==='Pressable'&&nodes(n).some(x=>x.props?.children==='Audio is unavailable. Tap to retry.')).props.onPress();
  h.gate();await flush();assert.equal(h.players.filter(p=>p.playing).length,1);
  assert.ok(!nodes(h.render()).some(n=>n.props?.children==='Audio is unavailable. Tap to retry.'));h.unmount();
});
test('global sound preference stops ambient music immediately and cannot resume it in background',async()=>{
 const h=harness();h.room.musicTrackId='placeholder_music_calm';h.gate();await flush();assert.equal(h.players[0].playing,true);
 h.sound(false);assert.ok(h.players.every(p=>!p.playing));
 h.appState('background');h.sound(true);await flush();assert.ok(h.players.every(p=>!p.playing));
 h.appState('active');await flush();assert.equal(h.players.filter(p=>p.playing).length,1);
 h.unmount();assert.equal(h.preferenceListeners.size,0);assert.ok(h.players.every(p=>!p.playing));
});

test('haptic toggles never stop, recreate or restart the playing music, including repeated notifications',async()=>{
 const h=harness();h.room.musicTrackId='placeholder_music_calm';h.gate();await flush();
 const player=h.players[0];assert.equal(player.playing,true);
 for(const enabled of [false,true,false]){
  h.haptics(enabled);assert.equal(player.playing,true,'haptic update must not synchronously pause music');
  h.gate();await flush();assert.equal(h.players.length,1);assert.equal(h.modes.length,1);
  assert.equal(player.playing,true);assert.equal(player.unregistered,undefined);
 }
 h.sound(false);assert.equal(player.playing,false);
 h.haptics(true);await flush();assert.equal(h.players.length,1,'haptics must not turn sound back on');
 h.sound(true);await flush();assert.equal(h.players.length,2);assert.equal(h.players[1].playing,true);
 h.haptics(false);assert.equal(h.players[1].playing,true);h.unmount();
});

test('haptic changes during asynchronous audio preparation neither cancel nor duplicate the selected track',async()=>{
 const mode=deferred(),h=harness({prepare:()=>mode.promise});h.room.musicTrackId='placeholder_music_calm';h.gate();
 h.haptics(false);h.haptics(true);assert.equal(h.modes.length,1);
 mode.resolve();await flush();assert.equal(h.players.length,1);assert.equal(h.players[0].playing,true);h.unmount();
});

test('Lofi needs no ownership; only the other songs have Plus badges and never buy with coins',async()=>{
  const h=harness();let tree=h.render();
  assert.equal(tree.type,'View');assert.equal(nodes(tree).some(node=>node.type==='Modal'),false);
  assert.equal(nodes(tree).filter(node=>node.props?.children==='PLUS').length,2);
  assert.ok(!nodes(tree).some(node=>node.props?.children==='Quiet Cave'));
  assert.ok(!nodes(tree).some(node=>String(node.props?.accessibilityLabel??'').includes('carrots')));
  h.tap('Jazz, Plus Only');assert.equal(h.closed(),0,'Plus is pushed over the retained Music page');assert.equal(h.routes[0],'/(main)/(modals)/subscription-paywall');
  assert.equal(h.choices.length,0,'legacy inventory must not bypass Plus');
  h.tap('Lofi');await flush();assert.deepEqual(h.choices,['placeholder_music_calm']);
  assert.ok(nodes(h.render()).some(node=>node.props?.children==='Playing in your room'));
  h.tap('Mute music');assert.ok(nodes(h.render()).some(node=>node.props?.children==='Paused in your room'));
  h.room.hasPlus=true;h.tap('Jazz, Plus Only');await flush();assert.equal(h.choices.at(-1),'placeholder_music_02');
  h.tap('No music');await flush();assert.equal(h.choices.at(-1),null);assert.equal(h.localStorage.get('music-muted'),'true');
});

test('switch and None pause before remove, even when a native status listener cannot unsubscribe',async()=>{
  const h=harness({listenerFailure:true});h.gate();h.tap('Lofi');h.gate();await flush();
  assert.equal(h.players.filter(p=>p.playing).length,1);
  h.room.hasPlus=true;h.tap('Lullaby, Plus Only');h.gate();await flush();
  assert.equal(h.players[0].playing,false);assert.equal(h.players[0].released,true);
  assert.equal(h.players.filter(p=>p.playing).length,1);
  h.tap('No music');assert.equal(h.players.filter(p=>p.playing).length,0,'stop is synchronous, before React effects or API');
  h.gate();await flush();h.unmount();assert.ok(h.players.every(p=>p.volume===0&&p.released));
});

test('None remains silent after offline selection failure and stale server selection',async()=>{
  const h=harness({writeFailure:true});h.room.musicTrackId='placeholder_music_calm';h.gate();await flush();
  assert.equal(h.players[0].playing,true);h.tap('No music');
  h.appState('background');h.appState('active');await flush();
  assert.equal(h.players.filter(p=>p.playing).length,0,'old AppState closure must obey the live mute before React rerenders');
  h.gate();await flush();
  assert.equal(h.room.musicTrackId,null);assert.equal(h.players.filter(p=>p.playing).length,0);
  h.room.musicTrackId='placeholder_music_calm';h.gate();await flush();
  h.appState('background');h.appState('active');await flush();
  assert.equal(h.players.filter(p=>p.playing).length,0);h.unmount();
});

test('delayed mode setup cannot restart audio after None or background; focus suspends instantly',async()=>{
  const mode=deferred();const h=harness({prepare:()=>mode.promise});
  h.room.musicTrackId='placeholder_music_calm';h.gate();h.tap('No music');mode.resolve();await flush();
  assert.equal(h.players.length,0);h.gate();h.tap('Lofi');h.gate();await flush();
  const release=h.api.acquireBurrowAudioFocus();h.appState('active');await flush();
  assert.equal(h.players.filter(p=>p.playing).length,0,'old AppState closure must honor acquired focus immediately');
  h.gate();release();h.gate();await flush();assert.equal(h.players.filter(p=>p.playing).length,1);
  h.appState('background');assert.equal(h.players.filter(p=>p.playing).length,0);
  h.appState('active');await flush();assert.equal(h.players.filter(p=>p.playing).length,1);
  h.identities.forEach(fn=>fn());assert.equal(h.players.filter(p=>p.playing).length,0);h.unmount();
});

test('Plus loss stops a selected premium song, even with legacy ownership',async()=>{
  const h=harness();h.room.hasPlus=true;h.room.musicTrackId='placeholder_music_02';h.gate();await flush();
  assert.equal(h.players[0].playing,true);h.room.hasPlus=false;h.gate();await flush();
  assert.equal(h.players[0].playing,false);h.unmount();
});

test('each native cleanup operation is attempted even if the others throw',()=>{
  const {releaseBurrowAudio}=load('apps/mobile/src/lib/burrow-audio-cleanup.ts');const calls=[];
  const player={pause(){calls.push('pause');throw Error('gone');},set volume(value){assert.equal(value,0);calls.push('mute');throw Error('gone');},
    remove(){calls.push('remove');throw Error('gone');},release(){calls.push('release');throw Error('gone');}};
  assert.doesNotThrow(()=>releaseBurrowAudio(player,()=>{calls.push('unsubscribe');throw Error('gone');}));
  assert.deepEqual(calls,['pause','mute','unsubscribe','remove','release']);
});

test('cached catalogs normalize free/Plus music without changing IDs, mutating cache or exposing old songs',()=>{
  const catalog=[
    {stable_id:'placeholder_music_dream',item_type:'music',title:'old',price:777,asset:{bundleKey:'dream'}},
    {stable_id:'placeholder_music_02',item_type:'music',title:'old',price:300,asset:{}},
    {stable_id:'placeholder_music_calm',item_type:'music',title:'old',price:0,asset:{bundleKey:'calm'}},
    {stable_id:'music_quiet_cave_01',item_type:'music',title:'silent',price:0,asset:{}},
  ];
  const result=tracks.burrowMusicCatalog(catalog);
  assert.deepEqual(Array.from(result,item=>item.title),['Lofi','Lullaby','Jazz']);
  assert.deepEqual(Array.from(result,item=>item.price),[0,0,0]);
  assert.deepEqual(Array.from(result,item=>item.plus_only),[false,true,true]);
  assert.equal(tracks.burrowMusicTrack(catalog[0]).source,2);
  assert.equal(tracks.burrowMusicTrack(catalog[3]),undefined);assert.equal(catalog[0].price,777);
});
