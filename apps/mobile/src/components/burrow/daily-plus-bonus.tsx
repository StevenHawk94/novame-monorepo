import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import Animated,{cancelAnimation,Easing,runOnJS,useAnimatedStyle,useSharedValue,withTiming} from 'react-native-reanimated';
import {CoinIcon} from './coin-ui';
import {CoinWalletPortal} from './coin-reward-banner';
import {claimDailyPlusBonus} from '@/lib/app-major-update-api';
import {confirmDailyPlusBonusLocally,refreshBurrow} from '@/lib/burrow-store';
import {coinRewardIncluded,coinRewardDefinitelyRejected,setNextCoinRewardOrigin,useCoinRewards} from '@/lib/coin-reward-store';
import {coinOperations} from '@/lib/coin-command-outbox';
import {dailyPlusBonusAvailable,type DailyPlusBonusState,type HomeWalletAnchor} from '@/lib/daily-plus-bonus';
import {ownsModalSlot,releaseModalSlot,requestModalSlot,useActiveModalSlot} from '@/lib/modal-coordinator';
import {registerOverlay} from '@/lib/overlay-presence';
import {sessionEpoch,sessionUserId} from '@/lib/session-lifecycle';
import {BURROW_MOTION,coinArrivalTiming} from '@/lib/burrow-motion';
type Receipt=Awaited<ReturnType<typeof claimDailyPlusBonus>>;
type Props={bonus?:DailyPlusBonusState;localDate:string;balance:number;anchor:HomeWalletAnchor|null;enabled:boolean};
export function DailyPlusBonus({userId,...props}:Props&{userId:string}){
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 useCoinRewards();
 const pending=useSyncExternalStore(coinOperations.subscribe,()=>coinOperations.has(props.bonus?.key??''),()=>false);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>sub.remove();},[]);
 const bonus=props.bonus?{...props.bonus,claimed:props.bonus.claimed||pending||coinRewardIncluded(props.bonus.key)}:undefined;
 async function claim(day:string){
  const epoch=sessionEpoch(),receipt=await claimDailyPlusBonus(day,props.bonus?.amount??50);
  if(epoch!==sessionEpoch()||sessionUserId()!==userId)throw Error('session_changed');
  confirmDailyPlusBonusLocally(userId,receipt.dailyPlusBonus);return receipt;
 }
 return <DailyPlusBonusPresentation key={props.bonus?.key??props.localDate} {...props} bonus={bonus} enabled={props.enabled&&foreground} onClaim={claim} onRefresh={()=>void refreshBurrow({silent:true})}/>;
}
/** Only the popup lives here. Wallet, particles, counter and monetary intent
 * belong to the SAME app-wide mechanism used by every other reward. */
export function DailyPlusBonusPresentation({bonus,localDate,anchor,enabled,onClaim,onRefresh}:Props&{onClaim:(day:string)=>Promise<Receipt>;onRefresh:()=>void}){
 const [phase,setPhase]=useState<'ready'|'flying'|'closing'|'done'>('ready'),[error,setError]=useState<string|null>(null);
 const reveal=useSharedValue(0),origin=useRef<View>(null),point=useRef<{x:number;y:number}|null>(null);
 const alive=useRef(true),locked=useRef(false),owner=useRef({}).current;
 const {width,height}=useWindowDimensions();useActiveModalSlot();
 const available=dailyPlusBonusAvailable(bonus,localDate),slot=`daily-plus:${bonus?.key}`;
 const requested=enabled&&!!anchor&&phase!=='done'&&(available||phase==='flying'||phase==='closing');
 useEffect(()=>{if(requested)requestModalSlot('claim',slot);else releaseModalSlot('claim',slot);return()=>releaseModalSlot('claim',slot);},[requested,slot]);
 const visible=requested&&ownsModalSlot(slot);
 const popupVisible=visible&&phase==='ready';
 useLayoutEffect(()=>visible?registerOverlay(owner):undefined,[visible,owner]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!enabled&&phase==='flying')setPhase('done');},[enabled,phase]);
 useEffect(()=>{
  if(phase!=='flying')return;
  // The animation deadline never depends on a request or receipt. Background
  // and page changes consume the celebration instead of replaying it later.
  const timer=setTimeout(()=>{if(alive.current)setPhase('closing');},coinArrivalTiming(0).flightEnd+BURROW_MOTION.coinHold);
  return()=>clearTimeout(timer);
 },[phase]);
 useEffect(()=>{
  if(!visible){reveal.value=0;return;}
  const closing=phase==='closing';
  const finish=()=>{if(alive.current)setPhase('done');};
  reveal.value=withTiming(closing?0:1,{duration:closing?BURROW_MOTION.coinFade:BURROW_MOTION.popup,easing:Easing.out(Easing.cubic)},done=>{if(done&&closing)runOnJS(finish)();});
  return()=>cancelAnimation(reveal);
 },[visible,phase==='closing',reveal]);
 const scrim=useAnimatedStyle(()=>({opacity:reveal.value}));
 const panel=useAnimatedStyle(()=>({opacity:reveal.value,transform:[{translateY:20*(1-reveal.value)},{scale:.94+.06*reveal.value}]}));
 function claim(){
  if(!available||!bonus||locked.current)return;
  locked.current=true;setError(null);
  setNextCoinRewardOrigin(point.current??{x:width/2,y:height/2-80});
  // onClaim journals and projects the shared operation synchronously, before
  // its first await. The user immediately sees the normal coin flight.
  let request:Promise<Receipt>;
  try{request=onClaim(bonus.localDate);}catch{
   locked.current=false;setError('Your bonus could not be saved. Please try again.');return;
  }
  setPhase('flying');
  void request.catch(failure=>{
   if(!alive.current)return;
   if(!coinRewardDefinitelyRejected(failure)){onRefresh();return;}
   if(String(failure?.message)==='session_changed'){setPhase('done');return;}
   locked.current=false;setError('Your bonus is still available. Please try again.');setPhase('ready');onRefresh();
  });
 }
 // The app-wide wallet owns the flight. Dismiss this native popup immediately
 // and release its wallet portal; root continues the SAME batch/controller.
 return <Modal visible={popupVisible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={()=>{if(phase==='ready')setPhase('done');}}>
  <View style={s.scrim} accessibilityViewIsModal>
   <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject,{backgroundColor:'#00000099'},scrim]}/>
   <Animated.View style={[s.panel,{width:Math.min(width-48,400),maxHeight:height*.65},panel]}>
    <ScrollView bounces={false} contentContainerStyle={s.content}>
     <View ref={origin} collapsable={false} onLayout={()=>origin.current?.measureInWindow((x,y,w,h)=>{point.current={x:x+w/2,y:y+h/2};})}><CoinIcon size={62}/></View>
     <Text accessibilityRole="header" style={s.title}>Daily Plus Bonus</Text>
     <Text style={s.copy}>Here are {bonus?.amount??50} burrow coins for you</Text>
     {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
     <Pressable accessibilityRole="button" disabled={phase!=='ready'} onPress={claim} style={({pressed})=>[s.claim,pressed&&{opacity:.85}]}>
      <Text style={s.claimText}>{phase==='ready'?'Claim':'Claimed!'}</Text>
     </Pressable>
    </ScrollView>
   </Animated.View>
   {popupVisible&&<CoinWalletPortal/>}
  </View>
 </Modal>;
}
const s=StyleSheet.create({scrim:{flex:1,alignItems:'center',justifyContent:'center'},
 panel:{borderRadius:28,backgroundColor:'#FFF8EE',shadowColor:'#512A17',shadowOffset:{width:0,height:5},shadowOpacity:.25,shadowRadius:0,elevation:5,overflow:'hidden'},
 content:{padding:28,gap:16,alignItems:'center'},title:{fontSize:24,lineHeight:31,fontWeight:'800',color:'#17120F',textAlign:'center'},copy:{fontSize:18,lineHeight:26,color:'#17120F',textAlign:'center'},
 claim:{minHeight:52,width:'74%',padding:12,borderRadius:28,backgroundColor:'#673019',alignItems:'center',justifyContent:'center'},claimText:{fontSize:21,lineHeight:27,color:'#FFF',fontWeight:'800'},error:{color:'#A13B24',fontSize:14,lineHeight:20,textAlign:'center'}});
