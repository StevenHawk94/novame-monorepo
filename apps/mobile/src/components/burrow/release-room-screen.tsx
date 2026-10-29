import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View, type LayoutRectangle } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROOM_TITLE_STYLE } from '@/lib/room-header-typography';
import { randomUUID } from 'expo-crypto';
import LottieView from 'lottie-react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, ReduceMotion, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { RELEASE_ROOM_MONSTERS, releaseDialogue, releaseVictoryCopy, type ReleaseDialogue, type ReleaseMonsterId } from '@novame/domain';
import { useBurrow, refreshBurrow } from '@/lib/burrow-store';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { cachedReleaseRoom, fetchReleaseRoom, releaseRoomScope, releaseStatusCurrent, queueReleaseRoom, ReleaseRoomError, type ReleaseAttempt, type ReleaseRoomStatus } from '@/lib/release-room-api';
import { releaseLastTamed, releaseRoomLayout, RELEASE_MONSTER_BODY_FRACTION, RELEASE_DIALOGUE_TAIL_HEIGHT } from '@/lib/release-room-layout';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { releaseCoinReward, setNextCoinRewardOrigin } from '@/lib/coin-reward-store';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';
import { haptics } from '@/lib/haptics';
import { registerOverlay } from '@/lib/overlay-presence';
import { MonsterArtwork } from './monster-artwork';
import { playMonsterImpact, resetMonsterImpact } from '@/lib/monster-impact';
import { BurrowBackButton } from './burrow-back-button';
import { BURROW_MOTION } from '@/lib/burrow-motion';
import {UserAvatar} from '@/components/ui/user-avatar';
import { burrowLocalDay } from '@/lib/burrow-local-day';
import { SwipeAttackLayer } from '@/components/tame-enemy/swipe-attack-layer';
import { ReleaseConfetti } from './release-confetti';
import { Image } from './burrow-image';
import { TAME_HEART_SOURCE as HEART, TAME_HEART_SPEED as HEART_SPEED, TAME_HEART_FALLBACK_SOURCE } from '@/lib/tame-heart-animation';

const BACKGROUND=require('../../../assets/burrow-webp/monster-bg.webp');
const SWIPE=require('../../../assets/monsters/swipe-icon.webp');
const PARTY=require('../../../assets/monsters/pop-up.webp');
const ATTACKS=20;
const STATS_REFRESH_MS=5000;
// Keep stage proportions separate from the page-specific artwork sizing.
const STAGE_BODY_FRACTION=RELEASE_MONSTER_BODY_FRACTION;
type Phase='select'|'prep'|'battle'|'finalWords'|'exploding'|'result';
const scaleForHits=(hits:number)=>hits>=20?.55:hits>=14?.7:hits>=7?.85:1;

function Hp({remaining}:{remaining:number}){
 const ratio=Math.max(0,Math.min(20,remaining))/20;
 return <View accessibilityRole="progressbar" accessibilityLabel="Monster energy" accessibilityValue={{min:0,max:20,now:remaining}} style={s.hp}>
  <Svg width="54%" height={22} viewBox="0 0 250 24" preserveAspectRatio="none">
   <Path d="M6 1H244V4H248V8H250V16H248V20H244V23H6V20H2V16H0V8H2V4H6Z" fill="#AFAFAF"/>
   <Path d="M7 3H243V6H247V9H249V15H247V18H243V21H7V18H3V15H1V9H3V6H7Z" fill="#FFFFFF"/>
   <Rect x={8} y={7} width={234} height={10} fill="#B7B7B7"/>
   <Rect x={8} y={7} width={234*ratio} height={10} fill="#D8E83A"/>
   {ratio>0&&ratio<1&&<Rect x={8+234*ratio} y={7} width={Math.min(4,234*(1-ratio))} height={10} fill="#929292"/>}
  </Svg>
 </View>;
}
function Action({label,onPress,disabled=false,gold=false}:{label:string;onPress:()=>void;disabled?:boolean;gold?:boolean}){
 return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
  style={({pressed})=>[s.action,gold&&s.gold,disabled&&{opacity:.55},pressed&&{opacity:.8}]}><Text style={[s.actionText,gold&&{color:'#4C3018'}]}>{label}</Text></Pressable>;
}
function PersonStats({name,avatar,userId,isDefaultAvatar,unpaired=false,count,last,height,timeZone}:{name:string;avatar?:string|null;userId?:string;isDefaultAvatar?:boolean|null;unpaired?:boolean;count:number|null;last:string|null;height:number;timeZone:string}){
 const {fontScale}=useWindowDimensions();
 const compact=height/Math.min(Math.max(fontScale,1),1.3)<190;
 return <View style={[s.person,{height}]}>
  {unpaired?<View style={[s.avatar,s.avatarFallback,{width:compact?42:65,height:compact?42:65,backgroundColor:'#4D2818'}]}><Text maxFontSizeMultiplier={1.3} style={[s.initial,{color:'#FFF8EE'}]}>?</Text></View>:<UserAvatar userId={userId} name={name} avatarUrl={avatar} isDefaultAvatar={isDefaultAvatar} size={compact?42:65}/>}
  <Text maxFontSizeMultiplier={1.3} style={[s.personName,{fontSize:compact?15:18}]} numberOfLines={1} adjustsFontSizeToFit>{name}</Text>
  <Text maxFontSizeMultiplier={1.3} style={[s.count,{fontSize:compact?29:38}]}>{count??'—'}</Text><Text maxFontSizeMultiplier={1.3} style={s.times}>times tamed</Text>
  <View style={s.divider}/><Text maxFontSizeMultiplier={1.3} style={s.lastLabel}>Last tamed</Text><Text maxFontSizeMultiplier={1.3} style={s.lastValue}>{releaseLastTamed(last,timeZone)}</Text>
 </View>;
}
export function ReleaseRoomScreen(){
 const {data}=useBurrow();
 return data?<ReleaseRoom key={releaseRoomScope(data)} data={data}/>:<View style={s.loading}><ActivityIndicator color="#FFF8EE"/></View>;
}
export function ReleaseRoom({data}:{data:MajorUpdateBootstrap}){
 const insets=useSafeAreaInsets(),{width,height,fontScale}=useWindowDimensions(),focused=useIsFocused();
 const params=useLocalSearchParams<{monsterId?:string;friendVisitId?:string;friendAdventureId?:string}>();
 const friendContext=params.friendVisitId??params.friendAdventureId;
 const scope=releaseRoomScope(data),layout=releaseRoomLayout(width,height,insets.top,insets.bottom,fontScale);
 const timezone=data.economicTimezone||data.profile.timezone_name||'UTC';
 const [wallNow,setWallNow]=useState(Date.now);
 const day=burrowLocalDay(wallNow,timezone);
 const [status,setStatus]=useState<ReleaseRoomStatus|null>(()=>cachedReleaseRoom(scope,timezone,data.hasPlus));
 const dailyStatus=status&&releaseStatusCurrent(status,timezone,wallNow)?status:null;
 const [phase,setPhase]=useState<Phase>('select'),[selected,setSelected]=useState<ReleaseMonsterId|null>(null);
 const [dialogue,setDialogue]=useState<ReleaseDialogue|null>(null),[hits,setHits]=useState(0);
 const [target,setTarget]=useState<LayoutRectangle|null>(null),[checking,setChecking]=useState(false);
 const [error,setError]=useState(''),[limit,setLimit]=useState(false),[heartDone,setHeartDone]=useState(false);
 const [heartLaidOut,setHeartLaidOut]=useState(false),[heartFailed,setHeartFailed]=useState(false);
 const [heartFormat,setHeartFormat]=useState<'lottie'|'json'>('lottie');
 const heartView=useRef<LottieView|null>(null),heartGeneration=useRef(0);
 const heartPaused=useRef(false),heartFinished=useRef(false);
 const heartToken=heartGeneration.current;
 const [completion,setCompletion]=useState<{tamedCount:number;rewardId:string}|null>(null);
 const [resultReady,setResultReady]=useState(false),[resultMeasured,setResultMeasured]=useState(false);
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 const epoch=useRef(sessionEpoch()).current,alive=useRef(false),focusRef=useRef(focused),foregroundRef=useRef(foreground);
 const request=useRef(0),lock=useRef(false),hitsRef=useRef(0),attempt=useRef<ReleaseAttempt|null>(null),rewardShown=useRef(false),visitOpened=useRef(false);
 const statusRead=useRef<AbortController|null>(null),knownStatus=useRef(status);
 const overlayOwner=useRef({}).current;
 focusRef.current=focused;foregroundRef.current=foreground;knownStatus.current=status;
 const current=()=>alive.current&&focusRef.current&&epoch===sessionEpoch();
 const phaseRef=useRef(phase);phaseRef.current=phase;
 const scale=useSharedValue(1),shake=useSharedValue(0),white=useSharedValue(0),victory=useSharedValue(0);
 const animated=useAnimatedStyle(()=>({transform:[{translateX:shake.value},{scale:scale.value}]}));
 const victoryStyle=useAnimatedStyle(()=>({opacity:victory.value,transform:[{translateY:18*(1-victory.value)},{scale:.9+.1*victory.value}]}));
 const victoryEntered=useCallback(()=>{
  if(alive.current&&focusRef.current&&foregroundRef.current&&epoch===sessionEpoch()&&phaseRef.current==='result')setResultReady(true);
 },[epoch]);
 usePageBackGesture(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;runOnUI(resetMonsterImpact)(shake,white);
  if(attempt.current&&!rewardShown.current)releaseCoinReward(`release-ui:${attempt.current.idempotencyKey}`);
 };},[]);
 useLayoutEffect(()=>{
  if(['battle','finalWords','exploding','result'].includes(phase))return registerOverlay(overlayOwner);
 },[phase,overlayOwner]);
 useEffect(()=>{
  const sub=AppState.addEventListener('change',state=>{
   const active=state==='active';foregroundRef.current=active;
   if(!active)runOnUI(resetMonsterImpact)(shake,white);
   setForeground(active);
  });
  return()=>sub.remove();
 },[shake,white]);
 useEffect(()=>{
  if(!focused||!foreground)return;setWallNow(Date.now());
  let timer:ReturnType<typeof setTimeout>;const tick=()=>{setWallNow(Date.now());timer=setTimeout(tick,30000);};
  timer=setTimeout(tick,30000);return()=>clearTimeout(timer);
 },[focused,foreground]);
 useEffect(()=>{if(!focused||!foreground)request.current++;},[focused,foreground]);
 useEffect(()=>{if(!focused||!foreground)runOnUI(resetMonsterImpact)(shake,white);},[focused,foreground,shake,white]);
 useEffect(()=>{
  // Revalidate on entry/resume. Only the visible statistics page polls; a
  // refresh must never replace the dialogue or interrupt a monetary operation.
  if(!focused||!foreground||!['select','prep'].includes(phase))return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|null=null;
  const valid=()=>!stopped&&current()&&foregroundRef.current;
  const schedule=()=>{if(valid()&&phase==='prep')timer=setTimeout(()=>void read(),STATS_REFRESH_MS);};
  async function read(){
   if(!valid())return;
   if(lock.current){schedule();return;}
   const token=++request.current;
   controller=new AbortController();const own=controller;statusRead.current=own;
   try{
    const value=await fetchReleaseRoom(data,own.signal);
    if(valid()&&!own.signal.aborted&&token===request.current){setStatus(value);setError('');}
   }catch{
    // A transient poll failure keeps the last confirmed counts on screen.
    if(valid()&&!own.signal.aborted&&token===request.current&&(!knownStatus.current||!releaseStatusCurrent(knownStatus.current,timezone,Date.now())))setError('Could not refresh your progress. Tap Retry to reconnect.');
   }finally{
    own.abort();if(statusRead.current===own)statusRead.current=null;
    schedule();
   }
  }
  void read();
  return()=>{stopped=true;if(timer!==undefined)clearTimeout(timer);controller?.abort();if(statusRead.current===controller)statusRead.current=null;};
 },[scope,phase,focused,foreground,day,data.hasPlus]);
 useEffect(()=>{
  if(visitOpened.current||!status||!friendContext)return;
  const match=RELEASE_ROOM_MONSTERS.find(m=>m.id===params.monsterId);if(!match)return;
  visitOpened.current=true;setSelected(match.id);setPhase('prep');
 },[status,friendContext,params.monsterId]);
 function resetHeart(format:'lottie'|'json'='lottie'){
  heartGeneration.current++;heartPaused.current=false;heartFinished.current=false;
  setHeartFormat(format);setHeartLaidOut(false);setHeartFailed(false);setHeartDone(false);
 }
 function heartFailure(token:number){
  if(token!==heartGeneration.current||!alive.current||epoch!==sessionEpoch()||phaseRef.current!=='exploding'||heartFinished.current)return;
  // A failed hidden/preloaded player must never be treated as a completed heart.
  if(heartFormat==='lottie')resetHeart('json');
  else{heartGeneration.current++;setHeartFailed(true);}
 }
 // Keep speed at 1 from the FIRST native commit. iOS setSpeed(0 -> 1)
 // can invoke an internal play() without the React Native finish callback.
 // Native autoplay waits for async/cached composition readiness and attaches
 // that callback itself; neither JS layout timing nor loaded events start it.
 useEffect(()=>{
  if(phase!=='exploding'||heartDone||heartFailed)return;
  if(!focused||!foreground){heartView.current?.pause();heartPaused.current=true;return;}
  if(heartFinished.current){setHeartDone(true);return;}
  if(heartPaused.current&&heartView.current){heartView.current.resume();heartPaused.current=false;}
  // No elapsed-time watchdog: slow delivery is not an animation failure,
  // and a JS clock must never overrule a genuine native completion.
 },[phase,heartDone,heartLaidOut,heartFailed,heartFormat,focused,foreground]);
 useEffect(()=>{if(phase==='exploding'&&heartDone&&completion)setPhase('result');},[phase,heartDone,completion]);
 useEffect(()=>{
  if(phase!=='result'){victory.value=0;return;}
  if(!resultMeasured||!focused||!foreground)return;
  victory.value=withTiming(1,{duration:BURROW_MOTION.popup*(1-victory.value),easing:Easing.out(Easing.cubic),reduceMotion:ReduceMotion.System},finished=>{
   if(finished)runOnJS(victoryEntered)();
  });
  return()=>cancelAnimation(victory);
 },[phase,resultMeasured,focused,foreground,victory,victoryEntered]);
 useEffect(()=>{
  if(phase!=='result'||!resultReady||!completion||rewardShown.current||!focused||!foreground)return;
  rewardShown.current=true;releaseCoinReward(completion.rewardId);void haptics.success();
 },[phase,resultReady,completion,focused,foreground]);

 const monster=RELEASE_ROOM_MONSTERS.find(m=>m.id===selected);
 const stats=status?.monsters.find(m=>m.id===selected);
 const effectivePlus=status&&(!Number.isFinite(Date.parse(data.serverNow))||Date.parse(status.serverNow)>=Date.parse(data.serverNow))?status.hasPlus:data.hasPlus;
 const exhausted=!!dailyStatus&&dailyStatus.tamesToday>=(effectivePlus?2:1);
 const noticeError=(failure:unknown)=>{
  if(failure instanceof ReleaseRoomError&&failure.status)setStatus(failure.status);
  if(failure instanceof ReleaseRoomError&&failure.code==='daily_limit_reached'){setLimit(true);setPhase('prep');return;}
  setError(failure instanceof ReleaseRoomError&&['pair_changed','session_changed'].includes(failure.code)
   ?'Your connection changed. Reopen Release Room.':"Could not save your progress. Please retry.");
 };
 async function refresh(){
  if(lock.current)return;statusRead.current?.abort();lock.current=true;setChecking(true);const token=++request.current;
  try{const value=await fetchReleaseRoom(data);if(current()&&token===request.current){setStatus(value);setError('');}}
  catch(failure){if(current()&&token===request.current)noticeError(failure);}
  finally{lock.current=false;if(alive.current)setChecking(false);}
 }
 function start(){
  if(!selected||lock.current||!dailyStatus||!current()||!foregroundRef.current)return;
  if(exhausted){setLimit(true);return;}
  statusRead.current?.abort();request.current++;setError('');
   const count=dailyStatus.monsters.find(m=>m.id===selected)?.tamedCount??0;
   setDialogue(releaseDialogue(selected,count));setHits(0);hitsRef.current=0;
   setTarget(null);resetHeart();setCompletion(null);setResultReady(false);setResultMeasured(false);rewardShown.current=false;attempt.current=null;
   scale.value=1;runOnUI(resetMonsterImpact)(shake,white);setPhase('battle');void haptics.medium();
 }
 const landSwipe=()=>{
  if(!current()||!foregroundRef.current||phaseRef.current!=='battle'||hitsRef.current>=ATTACKS)return;
  const next=++hitsRef.current;setHits(next);
  runOnUI(playMonsterImpact)(shake,white);
  scale.value=withSpring(scaleForHits(next),{damping:13,stiffness:210,mass:.65});
  if(next===20){setPhase('finalWords');void haptics.heavy();}else void haptics.light();
 };
 function choose(index:number){
  if(!selected||!dialogue||!dailyStatus||phase!=='finalWords'||lock.current||attempt.current)return;
  runOnUI(resetMonsterImpact)(shake,white);
  const value:ReleaseAttempt={actorId:data.profile.id,partnerId:data.partner?.id??null,pairVersion:data.pairVersion??null,
   monsterId:selected,dialogueId:dialogue.id,choice:index,idempotencyKey:randomUUID()};
  try{
   setNextCoinRewardOrigin({x:width/2,y:height*.45});
   // This returns only after the shared outbox has persisted the exact intent.
   // Heart / victory / Done do not depend on its network receipt.
   const queued=queueReleaseRoom(value,dailyStatus);
   attempt.current=value;setError('');setStatus(queued.status);
   setCompletion({rewardId:queued.rewardId,tamedCount:queued.tamedCount});phaseRef.current='exploding';setPhase('exploding');setHeartDone(false);
   void queued.confirmed.then(result=>{
    if(epoch!==sessionEpoch())return;void refreshBurrow({silent:true});
    if(current())setStatus(cachedReleaseRoom(scope,timezone,data.hasPlus)??result.status);
   }).catch(failure=>{
    if(!current()||queued.pending())return; // Ambiguous errors retry silently with the same key.
    setStatus(cachedReleaseRoom(scope,timezone,data.hasPlus));
    if(attempt.current?.idempotencyKey===value.idempotencyKey&&phaseRef.current==='exploding'){
     setCompletion(null);noticeError(failure);
    }
    void refreshBurrow({silent:true});
   });
  }catch{setError('Your completion couldn’t be saved on this device. Please try your reply again.');}
 }
 function back(){
  runOnUI(resetMonsterImpact)(shake,white);
  if(phase==='select'||friendContext){router.back();return;}
  setPhase('select');setSelected(null);setError('');setLimit(false);
 }
 const isBattle=phase==='battle',isFight=['battle','finalWords','exploding','result'].includes(phase);
 const finalBase=layout.finalSize/.55;
 const areaHeight=isBattle?layout.arenaHeight:layout.finalArenaHeight;
 const size=isBattle?layout.battleSize:finalBase;
 const artWidth=size*1.06; // Common canvas allowance for the widest hit pose.
 const nameBanner=(text:string)=><View style={s.nameBanner}><Text style={s.name} numberOfLines={1} adjustsFontSizeToFit>{text}</Text></View>;
 const showQuota=!isFight&&(limit||exhausted);
 const quota=<View style={s.limitContent}>
   <View accessibilityRole="summary" style={s.limitCard}>
    <Text style={s.limitIcon}>{effectivePlus?'❤️':'👑'}</Text><Text style={s.limitTitle}>{effectivePlus?'You’ve done enough for today.\nRest is part of taming.':'You’ve tamed your monster for today.'}</Text>
    {!effectivePlus&&<><Text style={s.limitCopy}>Join Plus to tame more.</Text><Action label="Try Plus" onPress={()=>{setLimit(false);router.push('/(main)/(modals)/subscription-paywall');}}/></>}
   </View>
  </View>;
 return <View style={[s.root,{paddingTop:insets.top,paddingBottom:isFight?0:insets.bottom}]}>
  <Image source={BACKGROUND} pointerEvents="none" contentFit="fill" style={{position:'absolute',top:0,left:0,width,height:width*1870/841}}/>
  {!isFight&&<BurrowBackButton light onPress={back} style={[s.back,{top:insets.top+5}]}/>}
  {(phase==='select'||showQuota)&&<>
   <View style={s.heading}><Text style={[s.title,ROOM_TITLE_STYLE]}>Release Room</Text><Text style={s.subtitle}>Release negative energy by taming a monster.</Text></View>
   {showQuota?quota:!dailyStatus?<View style={s.loading}><ActivityIndicator color="#FFF8EE"/><Text style={s.subtitle}>Preparing your progress…</Text></View>:<ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.grid,{paddingHorizontal:layout.padding}]}>
    {RELEASE_ROOM_MONSTERS.map(m=><Pressable accessibilityRole="button" accessibilityLabel={`View ${m.name}`} key={m.id} onPress={()=>{setSelected(m.id);setPhase('prep');setError('');}}
     style={[s.card,{width:(width-2*layout.padding-14)/2,height:layout.gridHeight}]}>
     <View style={[s.gridArt,{height:layout.gridHeight*.62}]}><MonsterArtwork id={m.id} surface="selection" width={(width-2*layout.padding-14)/2-16} height={layout.gridHeight*.62}/></View>
     <Text style={s.cardName} numberOfLines={1} adjustsFontSizeToFit>{m.name}</Text>
    </Pressable>)}
   </ScrollView>}
  </>}
  {phase==='prep'&&!showQuota&&monster&&<ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.prep,{paddingHorizontal:layout.padding,paddingTop:layout.prepTop,gap:layout.prepGap,minHeight:layout.usable}]}>
   {nameBanner(monster.name)}<Text style={s.intro}>{monster.intro}</Text>
   <View style={{height:layout.prepArt,justifyContent:'center'}}><MonsterArtwork id={monster.id} surface="preparation" width={layout.prepArt*1.1} height={layout.prepArt*STAGE_BODY_FRACTION}/></View>
   <Text style={s.smallWins}>Small Wins, Together</Text>
   <View style={s.people}>
    <PersonStats name={data.profile.display_name?.trim()||'You'} userId={data.profile.id} avatar={data.profile.avatar_url} isDefaultAvatar={data.profile.is_default_avatar} count={stats?.tamedCount??0} last={stats?.lastTamedAt??null} height={layout.statsHeight} timeZone={timezone}/>
    <PersonStats name={data.partner?.display_name?.trim()||(data.partner?'Partner':'Not paired yet')} userId={data.partner?.id} avatar={data.partner?.avatar_url} isDefaultAvatar={data.partner?.is_default_avatar} unpaired={!data.partner} count={data.partner?stats?.partnerTamedCount??null:0} last={stats?.partnerLastTamedAt??null} height={layout.statsHeight} timeZone={timezone}/>
   </View>
   <Text style={s.hint}>Tame the monster to release {monster.name.toLowerCase()}.</Text>
   <View style={s.start}><Action label="Start" gold disabled={!dailyStatus} onPress={start}/></View>
  </ScrollView>}
  {isFight&&monster&&<>
   <View style={{height:areaHeight}}>
    {isBattle?<View style={[s.battleName,{position:'absolute',top:Math.max(0,layout.monsterTop-58),left:0,right:0}]}>{nameBanner(monster.name)}</View>:<View accessibilityLabel="Monster dialogue" style={[s.bubble,{position:'absolute',top:layout.finalBubbleTop,left:Math.max(24,width*.15),right:Math.max(24,width*.15),height:layout.bubbleHeight}]}>
     <Text style={s.bubbleText} adjustsFontSizeToFit minimumFontScale={.8} numberOfLines={3}>{dialogue?.monster}</Text><View style={s.bubbleTail}/>
    </View>}
    <Animated.View onLayout={event=>setTarget(event.nativeEvent.layout)} style={[{position:'absolute',left:(width-artWidth)/2,top:isBattle?layout.monsterTop:layout.finalMonsterTop-(size-layout.finalSize)/2,width:artWidth,height:size},animated]}>
     <View style={{top:size*(1-STAGE_BODY_FRACTION)/2}}><MonsterArtwork id={monster.id} surface="battle" width={artWidth} height={size*STAGE_BODY_FRACTION} flash={white}/></View>
    </Animated.View>
    {isBattle&&<View style={[s.hpPosition,{top:layout.hpTop}]}><Hp remaining={ATTACKS-hits}/></View>}
    {phase==='exploding'&&!heartDone&&!heartFailed&&<View pointerEvents="none" testID="monster-heart-anchor" style={layout.heartFrame}><LottieView key={heartToken} ref={heartView} source={heartFormat==='lottie'?HEART:TAME_HEART_FALLBACK_SOURCE} autoPlay loop={false}
     renderMode="AUTOMATIC" hardwareAccelerationAndroid cacheComposition speed={HEART_SPEED} resizeMode="contain" style={StyleSheet.absoluteFill}
     onLayout={event=>{if(event.nativeEvent.layout.width>0&&event.nativeEvent.layout.height>0&&heartToken===heartGeneration.current&&alive.current&&epoch===sessionEpoch())setHeartLaidOut(true);}}
     onAnimationFinish={cancelled=>{
      if(cancelled||heartToken!==heartGeneration.current||phaseRef.current!=='exploding'||!alive.current||epoch!==sessionEpoch())return;
      heartFinished.current=true;
      // An already-completed native event can reach JS after backgrounding.
      // Retain it, but reveal Victory only when this screen is visible again.
      if(current()&&foregroundRef.current)setHeartDone(true);
     }} onAnimationFailure={()=>heartFailure(heartToken)}/></View>}
    <SwipeAttackLayer enabled={isBattle&&focused&&foreground} target={target} onHit={landSwipe}/>
   </View>
   {isBattle?<View style={[s.panel,s.instructions,{height:layout.instructionHeight+insets.bottom,paddingBottom:16+insets.bottom}]}>
    <Image source={SWIPE} contentFit="contain" style={{width:layout.instructionIcon,height:layout.instructionIcon}}/>
    <Text style={[s.rule,{fontSize:layout.instructionFont,lineHeight:layout.instructionFont*1.35}]}>Swipe to attack the monster{`\n`}with your finger</Text>
   </View>:<View style={[s.panel,s.options,{height:layout.panelHeight+insets.bottom,paddingBottom:12+insets.bottom,paddingHorizontal:10,gap:layout.optionGap}]}>
    <Text style={s.optionsHeading}>Your monster is ready to listen</Text>
    {dialogue?.replies.map((reply,index)=><Pressable accessibilityRole="button" accessibilityLabel={`Reply ${index+1}: ${reply}`} disabled={phase!=='finalWords'} key={index} onPress={()=>choose(index)}
     style={({pressed})=>[s.reply,{minHeight:layout.buttonHeight},pressed&&{opacity:.8}]}><Text maxFontSizeMultiplier={1.3} style={[s.replyText,{fontSize:layout.optionFont}]}>{reply}</Text></Pressable>)}
   </View>}
  </>}
  {!!error&&phase!=='exploding'&&phase!=='result'&&<View style={s.errorBox}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable accessibilityLabel="Retry progress" onPress={()=>void refresh()}><Text style={s.retry}>Retry</Text></Pressable></View>}
  {phase==='exploding'&&!completion&&!!error&&<View style={s.errorBox}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Action label="Back to Release Room" onPress={back}/></View>}
  {phase==='exploding'&&heartFailed&&<View style={s.errorBox}><Text accessibilityRole="alert" style={s.error}>Couldn’t play the heart animation. Please try again.</Text><Action label="Replay heart animation" onPress={()=>resetHeart()}/></View>}
  {phase==='result'&&completion&&selected&&<>
   <View style={s.scrim}><Animated.View accessibilityLabel="Victory dialog" accessibilityViewIsModal onLayout={()=>setResultMeasured(true)} style={[s.victory,{maxHeight:height-insets.top-insets.bottom-32},victoryStyle]}>
    <ScrollView bounces={false} contentContainerStyle={s.victoryBody}><Image source={PARTY} style={{width:60,height:60}} contentFit="contain"/><Text style={s.victoryTitle}>Victory</Text>
     <Text style={s.victoryCopy}>{releaseVictoryCopy(selected,completion.tamedCount)}</Text>
    </ScrollView><Action label={friendContext?'Back to my friend':'Done'} disabled={!resultReady} onPress={()=>{if(friendContext)router.back();else{setPhase('select');setSelected(null);setError('');}}}/>
   </Animated.View><ReleaseConfetti active={focused&&foreground}/></View>
  </>}
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:'#BE502D',overflow:'hidden'},loading:{flex:1,backgroundColor:'#BE502D',justifyContent:'center'},
 back:{position:'absolute',left:16,zIndex:4},
 heading:{paddingTop:48,paddingHorizontal:18,paddingBottom:24,alignItems:'center',gap:10},title:{fontSize:29,fontWeight:'800',color:'#FFF8EC'},subtitle:{fontSize:14,lineHeight:20,color:'#FFF8EC',textAlign:'center'},
 grid:{flexDirection:'row',flexWrap:'wrap',gap:14,paddingBottom:16},gridArt:{alignItems:'center',justifyContent:'center',marginBottom:4},card:{borderRadius:12,backgroundColor:'#FFFCF6',borderWidth:2,borderColor:'#DCB491',alignItems:'center',justifyContent:'center',padding:6,shadowColor:'#704226',shadowOpacity:.23,shadowOffset:{width:0,height:3},shadowRadius:0},cardName:{fontSize:16,fontWeight:'800',color:'#17110C',marginTop:2},
 prep:{alignItems:'center',paddingTop:18,paddingBottom:20,gap:12},nameBanner:{backgroundColor:'#4D331A',borderRadius:8,minHeight:42,paddingHorizontal:16,paddingVertical:8,minWidth:'58%',maxWidth:'82%',alignItems:'center',justifyContent:'center'},name:{color:'#FFF8EA',fontSize:20,fontWeight:'800'},intro:{fontSize:15,lineHeight:21,color:'#FFF7E7',textAlign:'center',maxWidth:'90%'},smallWins:{fontSize:22,fontWeight:'800',color:'#FFF9EC',marginTop:4},
 people:{width:'100%',flexDirection:'row',gap:12},person:{flex:1,backgroundColor:'#FBEAD7',borderRadius:23,alignItems:'center',paddingHorizontal:9,paddingVertical:10,justifyContent:'space-between'},avatar:{borderRadius:50},avatarFallback:{backgroundColor:'#DEC4A5',alignItems:'center',justifyContent:'center'},initial:{fontSize:27,fontWeight:'700',color:'#4D331A'},personName:{fontWeight:'800',color:'#17110C'},count:{fontWeight:'900',color:'#17110C'},times:{fontSize:12,fontWeight:'700',color:'#17110C'},divider:{height:1,backgroundColor:'#C9A68A',width:'92%',marginVertical:4},lastLabel:{fontSize:12,color:'#8D7864'},lastValue:{fontSize:12,fontWeight:'600',color:'#392C1C',textAlign:'center'},hint:{color:'#FFF8E8',fontSize:14,lineHeight:20,textAlign:'center',fontWeight:'600'},start:{width:'90%',marginTop:4},
 action:{minHeight:50,borderRadius:13,paddingHorizontal:18,paddingVertical:12,alignItems:'center',justifyContent:'center',backgroundColor:'#673019'},gold:{backgroundColor:'#FFC64C'},actionText:{fontSize:20,color:'#FFFFFF',fontWeight:'800',textAlign:'center'},
 battleName:{height:48,alignItems:'center',justifyContent:'center'},hpPosition:{position:'absolute',left:0,right:0},hp:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},
 panel:{backgroundColor:'#FFF4E3',borderTopLeftRadius:25,borderTopRightRadius:25},instructions:{alignItems:'center',justifyContent:'space-evenly',padding:16},rule:{color:'#111111',textAlign:'center',fontWeight:'800'},
 bubble:{backgroundColor:'#FFFFFF',borderRadius:12,padding:12,alignItems:'center',justifyContent:'center'},bubbleText:{fontSize:16,lineHeight:21,fontWeight:'800',textAlign:'center',color:'#111111'},bubbleTail:{position:'absolute',bottom:-RELEASE_DIALOGUE_TAIL_HEIGHT,width:0,height:0,borderLeftWidth:10,borderRightWidth:10,borderTopWidth:12,borderLeftColor:'transparent',borderRightColor:'transparent',borderTopColor:'#FFFFFF'},
 options:{paddingTop:12,paddingBottom:12},optionsHeading:{height:36,lineHeight:26,textAlign:'center',color:'#4D331A',fontSize:15,fontWeight:'800'},reply:{backgroundColor:'#50351C',borderRadius:12,paddingHorizontal:12,paddingVertical:10,alignItems:'center',justifyContent:'center'},replyText:{color:'#FFFFFF',fontWeight:'700',textAlign:'center',lineHeight:20},
 scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.58)',alignItems:'center',justifyContent:'center',padding:20,zIndex:10},victory:{width:'100%',maxWidth:430,backgroundColor:'#FFF8EE',borderRadius:24,padding:22,shadowColor:'#673019',shadowOpacity:.4,shadowOffset:{width:0,height:4},shadowRadius:0},victoryBody:{alignItems:'center',gap:20,paddingVertical:10,paddingBottom:32},party:{fontSize:52},victoryTitle:{fontSize:36,fontWeight:'900',color:'#111111'},victoryCopy:{fontSize:17,lineHeight:25,color:'#17110C',textAlign:'center'},
 errorBox:{position:'absolute',left:12,right:12,bottom:12,backgroundColor:'#FFF8EE',padding:12,borderRadius:12,zIndex:5},error:{color:'#783A29',fontSize:13,lineHeight:18,textAlign:'center'},retry:{color:'#673019',textAlign:'center',fontSize:15,fontWeight:'800',paddingTop:7},
 limitContent:{flex:1,alignItems:'center',justifyContent:'center',padding:20},limitCard:{width:'100%',maxWidth:420,borderRadius:16,backgroundColor:'#FFF5E4',paddingHorizontal:28,paddingVertical:42,gap:26},limitIcon:{textAlign:'center',fontSize:46},limitTitle:{fontSize:23,lineHeight:29,fontWeight:'800',textAlign:'center',color:'#4D331A'},limitCopy:{fontSize:16,color:'#704126',textAlign:'center'},close:{position:'absolute',top:8,right:10,width:30,height:30,alignItems:'center',justifyContent:'center'},closeText:{color:'#673019',fontSize:26},
});
