const fs=require('node:fs');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const ids=['the_swallower','overthinking','procrastination','the_fog','the_spiral','the_hollow','the_comparer','the_wall'];
const domain=load('packages/domain/src/release-room.ts',Object.fromEntries(ids.map(id=>[`./release-room-dialogues/${id}.json`,require(`../packages/domain/src/release-room-dialogues/${id}.json`)])));
const layout=load('apps/mobile/src/lib/release-room-layout.ts',{}, {Intl,Date});
const localDay=load('apps/mobile/src/lib/burrow-local-day.ts',{}, {Intl,Date});
const avatar=load('apps/mobile/src/lib/avatar.ts',Object.fromEntries(Array.from({length:10},(_,i)=>[`../../assets/profile/default-${i+1}.webp`,i+1000])));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
class ReleaseRoomError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
const status=(extra={})=>({hasPlus:false,dailyLimit:1,tamesToday:0,localDate:'2026-10-14',serverNow:'2026-10-14T12:00:00Z',partnerId:B,pairVersion:'a'.repeat(32),
 monsters:ids.map(id=>({id,tamedCount:0,lastTamedAt:null,partnerTamedCount:0,partnerLastTamedAt:null})),...extra});
const jsx=(type,props,key)=>({type,props,key});
function nodes(tree){
 if(Array.isArray(tree))return tree.flatMap(nodes);
 if(!tree||typeof tree!=='object')return [];
 if(typeof tree.type==='function')return nodes(tree.type(tree.props));
 return [tree,...nodes(tree.props?.children)];
}
function screenHarness(options={}){
 const h=hooks(),time=clock(Date.parse('2026-10-14T12:00:00Z')),post=deferred(),calls=[],rewards=[],paths=[],backPolicies=[];
 let focused=true,foreground='active',epoch=1,fetchCount=0,listener;
 const animations=[],impacts=[],heartCommands=[];let loadedHeart=null;
 const nativeHeart={play:(...args)=>heartCommands.push(['play',...args]),pause:()=>heartCommands.push(['pause']),resume:()=>heartCommands.push(['resume'])};
 const data={profile:{id:A,display_name:'Alex',avatar_url:null,timezone_name:'UTC'},partner:options.solo?null:{id:B,display_name:'Morgan',avatar_url:null},pairVersion:options.solo?undefined:'a'.repeat(32),hasPlus:false};
 let snapshot=options.status??status(options.solo?{partnerId:null,pairVersion:null}:{});
 const react=h.react;
 const heart=load('apps/mobile/src/lib/tame-heart-animation.ts',{'../../assets/animations/exploding heart (1).lottie':321,'../../assets/animations/exploding-heart.json':require('../apps/mobile/assets/animations/exploding-heart.json')});
 const impactMotion={cancelAnimation(){},ReduceMotion:{Never:'never'},withTiming:x=>x,withSequence:(...xs)=>xs.at(-1)};
 const module=load('apps/mobile/src/components/burrow/release-room-screen.tsx',{
  './burrow-back-button':{BurrowBackButton:'Pressable'},
  react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native':{...Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','View'].map(x=>[x,x])),Alert:{alert(){}},StyleSheet:{create:x=>x,absoluteFill:{position:'absolute',inset:0},absoluteFillObject:{position:'absolute',inset:0}},
   AppState:{get currentState(){return foreground;},addEventListener:(_name,fn)=>{listener=fn;return{remove(){listener=null;}};}},useWindowDimensions:()=>({width:options.width??375,height:options.height??667,fontScale:options.fontScale??1})},
  'expo-router':{router:{back:()=>paths.push('back'),push:path=>paths.push(path)},useLocalSearchParams:()=>options.params??{},useFocusEffect:fn=>react.useEffect(fn,[fn])},
  '@react-navigation/native':{useIsFocused:()=>focused,usePreventRemove:value=>backPolicies.push(value)},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:options.top??20,bottom:options.bottom??0})},'expo-crypto':{randomUUID:()=> 'fixed-key'},
  'lottie-react-native':{__esModule:true,default:'Lottie'},'react-native-svg':{__esModule:true,default:'Svg',Path:'Path',Rect:'Rect'},
  'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},useSharedValue:initial=>react.useRef({value:initial}).current,useAnimatedStyle:fn=>fn(),
   Easing:{out:x=>x,cubic:x=>x},ReduceMotion:{System:'system'},runOnJS:fn=>fn,runOnUI:fn=>(...args)=>{impacts.push(fn.name);return fn(...args);},
   cancelAnimation(){},withSpring:x=>x,withTiming:(x,config,callback)=>{if(callback){if(options.manualMotion)animations.push({callback,config});else callback(true);}return x;},withSequence:(...xs)=>xs.at(-1)},
  '@novame/domain':domain,'@/lib/burrow-store':{useBurrow:()=>({data}),refreshBurrow:async()=>calls.push('refresh')},
  '@/lib/release-room-api':{ReleaseRoomError,releaseStatusCurrent:(value,tz,now)=>value.localDate===localDay.burrowLocalDay(now,tz),releaseRoomScope:()=>data.profile.id+':'+(data.partner?.id??'')+':'+(data.pairVersion??''),cachedReleaseRoom:()=>options.cached??null,
   fetchReleaseRoom:async(_data,signal)=>{fetchCount++;return options.read?options.read(fetchCount,snapshot,signal):snapshot;},
   queueReleaseRoom:(attempt,baseline)=>{
    if(options.storageFail)throw Error('intent_not_saved');
    calls.push(attempt);let pending=true;
    const count=(baseline.monsters.find(m=>m.id===attempt.monsterId)?.tamedCount??0)+1;
    const optimistic={...baseline,tamesToday:baseline.tamesToday+1,monsters:baseline.monsters.map(m=>m.id===attempt.monsterId?{...m,tamedCount:count}:m)};
    const confirmed=(options.submit?options.submit(attempt,snapshot):post.promise).then(result=>{pending=false;snapshot=result.receipt.status;return result.receipt;},error=>{if(error instanceof ReleaseRoomError)pending=false;throw error;});
    snapshot=optimistic;
    return{rewardId:'release-ui:'+attempt.idempotencyKey,tamedCount:count,status:optimistic,confirmed,pending:()=>pending};
   }},
  '@/lib/release-room-layout':layout,'@/lib/session-lifecycle':{sessionEpoch:()=>epoch},
  '@/lib/burrow-motion':load('apps/mobile/src/lib/burrow-motion.ts'),
  '@/lib/tame-heart-animation':heart,
  '@/lib/coin-reward-store':{releaseCoinReward:id=>rewards.push(id),setNextCoinRewardOrigin(){}},
  '@/lib/use-page-back-gesture':{usePageBackGesture(){}},'@/lib/haptics':{haptics:{medium(){},light(){},heavy(){},success(){}}},
  '@/lib/overlay-presence':{registerOverlay:()=>()=>{}},
  '@/lib/monster-images':{MONSTER_ART:Object.fromEntries(ids.map((id,i)=>[id,{normal:i+1,hit:i+20}]))},
  '@/components/tame-enemy/swipe-attack-layer':{SwipeAttackLayer:'Swipe'},'./release-confetti':{ReleaseConfetti:'Confetti'},'@/lib/avatar':avatar,'@/lib/burrow-local-day':localDay,
  './monster-artwork':{MonsterArtwork:'MonsterArtwork'},
  '@/lib/monster-impact':load('apps/mobile/src/lib/monster-impact.ts',{'react-native-reanimated':impactMotion}),
  '@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},'./burrow-image':{Image:'Image'},
  '../../../assets/burrow-webp/monster-bg.webp':100,'../../../assets/monsters/swipe-icon.webp':101,'../../../assets/monsters/pop-up.webp':102,'../../../assets/animations/exploding-heart.json':{fr:30,ip:0,op:90},
 },time.globals);
 const render=()=>{
  let tree=h.render(()=>module.ReleaseRoom({data}));
  for(let pass=0;pass<3;pass++){
   const animation=nodes(tree).find(n=>n.type==='Lottie');if(!animation)break;
   animation.props.ref.current=nativeHeart;
   if(!options.manualHeart){
    // Layout is reliable even when Fabric drops a cached-source loaded event.
    if(loadedHeart?.source===animation.props.source&&loadedHeart?.key===animation.key)break;
    loadedHeart={source:animation.props.source,key:animation.key};animation.props.onLayout({nativeEvent:{layout:{width:300,height:300}}});tree=h.render(()=>module.ReleaseRoom({data}));
   }else break;
  }
  if(!options.manualLayout)for(let pass=0;pass<3;pass++){const dialog=nodes(tree).find(n=>n.props?.accessibilityLabel==='Victory dialog');if(!dialog)break;dialog.props.onLayout();tree=h.render(()=>module.ReleaseRoom({data}));}
  const animation=nodes(tree).find(n=>n.type==='Lottie');if(animation){animation.props.ref.current=nativeHeart;
   if(!options.manualHeart){const finish=animation.props.onAnimationFinish;animation.props.onAnimationFinish=cancelled=>{if(!cancelled)time.advance(3003);finish(cancelled);};}}
  return tree;
 };
 const find=fn=>nodes(render()).find(fn);
 const press=label=>{const node=find(n=>n.props?.accessibilityLabel===label);if(!node)throw Error('Missing button: '+label);node.props.onPress();render();};
 render();
 const complete=()=>post.resolve({rewardId:'release-ui:fixed-key',receipt:{tamedCount:1,victoryIndex:0,status:{...snapshot,tamesToday:1}}});
 return {h,time,render,all:()=>nodes(render()),find,press,calls,rewards,paths,post,complete,data,backPolicies,animations,impacts,heartCommands,finishPopup:()=>{animations.at(-1)?.callback(true);render();},fetchCount:()=>fetchCount,
  setStatus:value=>{snapshot=value;},blur:()=>{focused=false;render();},focus:()=>{focused=true;render();},
  background:()=>{foreground='background';listener?.(foreground);render();},foreground:()=>{foreground='active';listener?.(foreground);render();},signOut:()=>epoch++};
}
module.exports={domain,layout,screenHarness,status,nodes,A,B,ReleaseRoomError,flush};
