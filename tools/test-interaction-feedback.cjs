const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {load,hooks,clock}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
function hapticHarness(){
 const calls=[],preferences={haptics:true,sound:true};
 const api=load('apps/mobile/src/lib/haptics.ts',{
  'expo-haptics':{ImpactFeedbackStyle:{Soft:'soft',Light:'light',Medium:'medium',Heavy:'heavy'},NotificationFeedbackType:{Success:'success',Warning:'warning',Error:'error'},
   impactAsync:async style=>{calls.push(style);},notificationAsync:async style=>{calls.push(style);},selectionAsync:async()=>{calls.push('selection');}},
  './interaction-preferences':{getInteractionPreferences:()=>preferences},
 });return {...api,calls,preferences};
}
test('one valid button activation emits Soft without stacking legacy navigation/selection haptics; async outcomes stay independent',async()=>{
 const x=hapticHarness(),event={nativeEvent:{target:1,timestamp:50}};let actions=0;
 const value=x.withSoftPress(()=>{actions++;void x.haptics.pageOpen();void x.haptics.light();void x.haptics.medium();void x.haptics.heavy();void x.haptics.selection();return 42;},event);
 assert.equal(value,42);assert.equal(actions,1);assert.deepEqual(x.calls,['soft']);
 x.withSoftPress(()=>{actions++;void x.haptics.pageClose();},event);assert.equal(actions,2);assert.deepEqual(x.calls,['soft'],'same native event cannot double-vibrate nested controls');
 x.withSoftPress(()=>x.withSoftPress(()=>actions++));assert.deepEqual(x.calls,['soft','soft']);
 await x.haptics.light();await x.haptics.success();await x.haptics.touchPulse();assert.deepEqual(x.calls,['soft','soft','light','success','medium']);
 await x.haptics.pageClose();assert.equal(x.calls.at(-1),'soft','native/back exits not wrapped in Pressable also use Soft');
});
test('disabled haptics, thrown native calls and thrown actions cannot block or replace the button action',()=>{
 const x=hapticHarness();x.preferences.haptics=false;let n=0;x.withSoftPress(()=>n++);assert.equal(n,1);assert.equal(x.calls.length,0);
 x.preferences.haptics=true;assert.throws(()=>x.withSoftPress(()=>{throw Error('action');}),/action/);
 x.withSoftPress(()=>n++);assert.equal(n,2);assert.deepEqual(x.calls,['soft','soft']);
});
test('shared controls forward refs, layout, styles, events and async return values; disabled/no-action surfaces stay silent',()=>{
 const x=hapticHarness(),react={forwardRef:fn=>(props)=>fn(props,props.ref)},native={Pressable:'NativePressable',TouchableOpacity:'NativeOpacity',Switch:'NativeSwitch'};
 const ui=load('apps/mobile/src/components/ui/feedback-pressable.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'@/lib/haptics':x});
 for(const name of ['Pressable','TouchableOpacity']){
  const event={nativeEvent:{}},ref={},style=()=>({opacity:.9}),result=Promise.resolve('saved');let passed;
  const tree=ui[name]({ref,style,testID:'control',onPress:e=>{passed=e;void x.haptics.pageOpen();return result;},children:'Label'});
  assert.equal(tree.type,native[name]);assert.equal(tree.props.ref,ref);assert.equal(tree.props.style,style);assert.equal(tree.props.testID,'control');
  assert.equal(tree.props.onPress(event),result);assert.equal(passed,event);
  const before=x.calls.length;ui[name]({disabled:true,onPress:()=>assert.fail('disabled')}).props.onPress?.(event);assert.equal(x.calls.length,before);
  assert.equal(ui[name]({}).props.onPress,undefined);
 }
 assert.deepEqual(x.calls,['soft','soft']);
 let held=0;ui.Pressable({onPressIn:()=>held++}).props.onPressIn({nativeEvent:{}});assert.equal(held,1);assert.equal(x.calls.at(-1),'soft');
 let value;const toggle=ui.Switch({value:false,onValueChange:v=>{value=v;}});toggle.props.onValueChange(true);assert.equal(value,true);assert.equal(x.calls.at(-1),'soft');
});
test('app activation imports cannot bypass shared feedback; Home hit targets, tabs and dialog actions use it',()=>{
 const exceptions=new Set(['apps/mobile/src/components/ui/feedback-pressable.tsx']);const bypass=[];
 function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(/\.[tj]sx?$/.test(file)&&!exceptions.has(file)){
  const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  for(const n of ast.statements)if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='react-native')for(const s of n.importClause?.namedBindings?.elements??[])
   if(!s.isTypeOnly&&['Alert','Pressable','TouchableOpacity','TouchableHighlight','TouchableNativeFeedback','Button','Switch'].includes((s.propertyName??s.name).text))bypass.push(file+':'+s.name.text);
 }}}scan('apps/mobile/src');scan('apps/mobile/app');assert.deepEqual(bypass,[]);
 for(const file of ['burrow/home-art-scene','burrow/room-scene-art','burrow/coin-wallet-face','main/bottom-tab-bar','ui/app-dialog'])
  assert.match(fs.readFileSync(`apps/mobile/src/components/${file}.tsx`,'utf8'),/from ['"]@\/components\/ui\/feedback-pressable['"]/);
});
test('native alert keeps destructive/cancel semantics and only its selected button produces Soft',()=>{
 const x=hapticHarness(),shown=[],options={cancelable:true},ui=load('apps/mobile/src/components/ui/feedback-pressable.tsx',{
  react:{forwardRef:fn=>fn},'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/haptics':x,
  'react-native':{Alert:{alert:(...args)=>shown.push(args)}},
 });let deleted=0;ui.Alert.alert('Delete?','Keep this private',[{text:'Keep',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>deleted++}],options);
 assert.equal(x.calls.length,0);assert.equal(shown[0][3],options);assert.equal(shown[0][2][1].style,'destructive');shown[0][2][0].onPress();assert.equal(deleted,0);shown[0][2][1].onPress();assert.equal(deleted,1);
 ui.Alert.alert('Done');assert.equal(shown[1][2][0].text,'OK');shown[1][2][0].onPress();assert.deepEqual(x.calls,['soft','soft','soft']);
});
function flightHarness(){const time=clock(0),calls=[],sounds=[],stops=[];let active=true;
 const {createCoinFlightFeedback}=load('apps/mobile/src/lib/coin-flight-feedback.ts',{},time.globals);
 const fx=createCoinFlightFeedback({now:()=>time.globals.Date.now(),isActive:()=>active,pulse:()=>calls.push(time.globals.Date.now()),
  play:()=>sounds.push(time.globals.Date.now()),stopSound:()=>stops.push(time.globals.Date.now())});
 return {time,calls,sounds,stops,fx,setActive:v=>{active=v;}};
}
test('coin flight requests exactly 20 Light pulses spread from first flight frame to last landing, never during balance hold',()=>{
 const x=flightHarness();x.fx.start('1:1',1200);assert.deepEqual(x.sounds,[0]);assert.deepEqual(x.calls,[0]);
 x.time.advance(1199);assert.equal(x.calls.length,19);x.time.advance(1);assert.equal(x.calls.length,20);assert.equal(x.calls.at(-1),1200);
 for(let i=0;i<20;i++)assert.ok(Math.abs(x.calls[i]-i*1200/19)<1e-6);
 x.time.advance(1800);assert.equal(x.calls.length,20);assert.equal(x.sounds.length,1);assert.equal(x.time.timers.size,0);
});
test('receipt/merged reward cannot restart feedback; a genuinely new flight starts a fresh bounded train',()=>{
 const x=flightHarness();x.fx.start('1:1',1200);x.time.advance(400);x.fx.start('1:1',1200);assert.equal(x.sounds.length,1);
 x.time.advance(800);assert.equal(x.calls.length,20);x.fx.start('1:2',1200);assert.equal(x.sounds.length,2);x.time.advance(1200);assert.equal(x.calls.length,40);
 x.fx.stop();assert.equal(x.time.timers.size,0);
});
test('background/unmount/identity/preference stops discard pending pulses and sound; interrupted flight never silently restarts',()=>{
 const x=flightHarness();x.fx.start('1:1',1200);x.time.advance(200);const n=x.calls.length;x.fx.stop();x.time.advance(3000);assert.equal(x.calls.length,n);
 x.fx.start('1:1',1200);assert.equal(x.sounds.length,1);x.setActive(false);x.fx.start('1:2',1200);assert.equal(x.sounds.length,1);
 x.setActive(true);x.fx.start('2:1',1200);x.setActive(false);x.time.advance(3000);assert.equal(x.calls.length,n+1);assert.equal(x.time.timers.size,0);
});
test('feedback failure never affects coins or starts a late sound',()=>{
 const time=clock(0),{createCoinFlightFeedback}=load('apps/mobile/src/lib/coin-flight-feedback.ts',{},time.globals);
 const x=createCoinFlightFeedback({now:()=>time.globals.Date.now(),isActive:()=>true,pulse:()=>{throw Error('no hardware');},play:()=>{throw Error('audio unavailable');},stopSound(){}});
 assert.doesNotThrow(()=>x.start('x',1200));assert.doesNotThrow(()=>time.advance(3000));assert.doesNotThrow(()=>x.stop());assert.equal(time.timers.size,0);
});
test('late JS timers skip missed Light slots instead of replaying a haptic burst or extending into the hold',()=>{
 const time=clock(0),calls=[];let skew=0;
 const {createCoinFlightFeedback}=load('apps/mobile/src/lib/coin-flight-feedback.ts',{},time.globals);
 const fx=createCoinFlightFeedback({now:()=>time.globals.Date.now()+skew,isActive:()=>true,pulse:()=>calls.push(time.globals.Date.now()+skew),play(){},stopSound(){}});
 fx.start('stall',1200);skew=500;time.advance(64);assert.equal(calls.length,1,'do not catch up eight missed slots');
 time.advance(510);assert.ok(calls.length<20);skew=5000;const n=calls.length;time.advance(5000);assert.equal(calls.length,n);assert.equal(time.timers.size,0);fx.stop();
});

function soundHookHarness({loaded=true}={}){
 const h=hooks(),time=clock(0),preferences={sound:true,haptics:true},players=[],modes=[],pulses=[],apps=new Set(),prefs=new Set(),identities=new Set();
 const app={currentState:'active',addEventListener(_name,fn){apps.add(fn);return{remove:()=>apps.delete(fn)};}};
 const controller=load('apps/mobile/src/lib/completion-sound-player.ts',{},time.globals),focus=load('apps/mobile/src/lib/burrow-audio-focus.ts');
 const api=load('apps/mobile/src/lib/use-coin-flight-feedback.ts',{
  react:h.react,'react-native':{AppState:app},'./coin-flight-feedback':load('apps/mobile/src/lib/coin-flight-feedback.ts',{},time.globals),
  './completion-sound-player':controller,'./foreground-audio-mode':load('apps/mobile/src/lib/foreground-audio-mode.ts'),
  './burrow-audio-focus':focus,
  './interaction-preferences':{getInteractionPreferences:()=>preferences,subscribeInteractionPreferences:fn=>{prefs.add(fn);return()=>prefs.delete(fn);}},
  './session-lifecycle':{subscribeSessionIdentity:fn=>{identities.add(fn);return()=>identities.delete(fn);}},
  './coin-reward-store':{coinRewardClock:()=>time.globals.Date.now()},'./haptics':{haptics:{light:()=>{if(preferences.haptics)pulses.push(time.globals.Date.now());}}},
  './ui-idle':{afterUiSettles:fn=>{const id=time.globals.setTimeout(fn,80);return()=>time.globals.clearTimeout(id);}},
  '../../assets/sound-effect/coin-collect.mp3':'coin-collect.mp3',
  'expo-audio':{setAudioModeAsync:async mode=>modes.push(mode),createAudioPlayer(source,options){
   const p={source,options,loaded,currentTime:0,plays:[],pauses:0,removes:0,releases:0,listener:null,
    get currentStatus(){return{isLoaded:this.loaded};},play(){this.plays.push(time.globals.Date.now());},pause(){this.pauses++;},remove(){this.removes++;},release(){this.releases++;},
    addListener(_name,fn){this.listener=fn;return{remove:()=>{this.listener=null;}};},seekTo:async()=>{},
   };players.push(p);return p;
  }},
 },time.globals);
 const fx=h.render(()=>api.useCoinFlightFeedback());
 return{h,time,preferences,players,modes,pulses,fx,focus,render:()=>h.render(()=>api.useCoinFlightFeedback()),
  app(state){app.currentState=state;for(const fn of apps)fn(state);},pref(key,value){preferences[key]=value;for(const fn of prefs)fn();},identity(){for(const fn of identities)fn();},
  get listeners(){return apps.size+prefs.size+identities.size;}};
}
test('real coin hook silently preloads bundled clip, plays at flight start and uses Light twenty times, not the balance hold',()=>{
 const x=soundHookHarness();assert.equal(x.players.length,0);x.time.advance(80);assert.equal(x.players.length,1);const p=x.players[0];
 assert.equal(p.source,'coin-collect.mp3');assert.equal(p.options.keepAudioSessionActive,false);assert.equal(p.plays.length,0);assert.equal(x.modes[0].playsInSilentMode,false);
 x.fx.start('1:1',1200);assert.deepEqual(p.plays,[80]);x.time.advance(1200);assert.equal(x.pulses.length,20);assert.equal(x.pulses[0],80);assert.equal(x.pulses.at(-1),1280);
 assert.equal(x.render(),x.fx,'rerenders and receipts retain the exact effect owner');x.time.advance(1800);assert.equal(x.pulses.length,20);assert.equal(p.plays.length,1);
 x.h.unmount();assert.equal(p.removes,1);assert.equal(p.releases,1);assert.equal(x.listeners,0);assert.equal(x.time.timers.size,0);
});
test('coin audio yields to nested Surprise recording/playback focus and never changes its audio mode or replays a missed sound',()=>{
 const x=soundHookHarness();const releaseA=x.focus.acquirePrivateAudioFocus(),releaseB=x.focus.acquirePrivateAudioFocus();x.time.advance(80);
 assert.equal(x.players.length,0);assert.equal(x.modes.length,0);x.fx.start('private',1200);releaseA();x.time.advance(80);assert.equal(x.players.length,0);
 releaseB();x.time.advance(80);assert.equal(x.players.length,1);assert.equal(x.players[0].plays.length,0);assert.equal(x.modes.length,1);
 x.fx.start('normal',1200);assert.equal(x.players[0].plays.length,1);const interrupt=x.focus.acquirePrivateAudioFocus();assert.equal(x.players[0].removes,1);assert.equal(x.modes.length,1);
 interrupt();x.time.advance(80);assert.equal(x.players.at(-1).plays.length,0);x.h.unmount();
});
test('sound not loaded at flight start is skipped, never queued for a late load event',()=>{
 const x=soundHookHarness({loaded:false});x.time.advance(80);x.fx.start('1:1',1200);x.players[0].loaded=true;x.players[0].listener({isLoaded:true});
 assert.equal(x.players[0].plays.length,0);x.time.advance(1200);assert.equal(x.pulses.length,20);x.h.unmount();
});
test('real hook cleans background, identity and preference changes without replaying completed or interrupted flights',()=>{
 const x=soundHookHarness();x.time.advance(80);x.fx.start('1:1',1200);x.time.advance(200);const n=x.pulses.length;
 x.app('background');assert.equal(x.players[0].removes,1);x.time.advance(2000);assert.equal(x.pulses.length,n);
 x.app('active');x.time.advance(80);assert.equal(x.players.length,2);assert.equal(x.players[1].plays.length,0);
 x.fx.start('1:1',1200);assert.equal(x.players[1].plays.length,0);x.fx.start('1:2',1200);assert.equal(x.players[1].plays.length,1);
 x.pref('haptics',false);const before=x.pulses.length;x.time.advance(1200);assert.equal(x.pulses.length,before);
 x.pref('sound',false);assert.equal(x.players[1].removes,1);x.pref('sound',true);assert.equal(x.players.at(-1).plays.length,0);
 x.identity();assert.equal(x.players.at(-1).removes,1);x.time.advance(80);assert.equal(x.players.at(-1).plays.length,0);x.h.unmount();assert.equal(x.time.timers.size,0);
});
test('real wallet controller starts feedback only with a new particle flight; portals/receipts/merged rewards do not duplicate it',()=>{
 const h=hooks(),{motionHarness,model}=require('./motion-test-utils.cjs'),m=motionHarness(h),events=[];
 const fx={start:(id,duration)=>events.push(['start',id,duration]),stop:()=>events.push(['stop'])};
 const {useCoinWalletController}=load('apps/mobile/src/components/burrow/coin-reward-banner.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:{OS:'ios'},StyleSheet:{create:x=>x},AccessibilityInfo:{isReduceMotionEnabled:async()=>false,addEventListener:()=>({remove(){}}),announceForAccessibility(){}}},
  'react-native-reanimated':m.reanimated,'react-native-safe-area-context':{},'react-native-screens':{},'expo-router':{},'./coin-ui':{},'./coin-wallet-face':{},
  '@/lib/use-coin-flight-feedback':{useCoinFlightFeedback:()=>fx},'@/lib/burrow-motion':model,'@/lib/coin-reward-store':{coinRewardClock:()=>m.time.globals.Date.now()},
 },m.time.globals);
 let batch={id:1,earned:10,from:100,revision:1,celebration:1,flight:{id:1,startedAt:m.time.globals.Date.now()}};
 const render=()=>h.render(()=>useCoinWalletController(batch,110,()=>{}));render();assert.deepEqual(events,[['start','1:1',1200]]);
 batch={...batch,revision:2};render();batch={...batch,revision:3,celebration:2};render();assert.equal(events.length,1);
 batch={...batch,flight:{id:2,startedAt:m.time.globals.Date.now()+1500}};render();assert.deepEqual(events,[['start','1:1',1200],['stop'],['start','1:2',1200]]);
 h.unmount();assert.deepEqual(events.at(-1),['stop']);
});
