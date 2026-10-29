import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AccessibilityInfo,AppState,Platform,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {FullWindowOverlay} from 'react-native-screens';
import {router} from 'expo-router';
import Animated,{cancelAnimation,Easing,runOnJS,useAnimatedStyle,useDerivedValue,useSharedValue,withDelay,withTiming,type SharedValue} from 'react-native-reanimated';
import {CoinIcon} from './coin-ui';
import {CoinWalletFace} from './coin-wallet-face';
import {CoinWalletContext,useWalletMotion,type WalletMotion} from './coin-wallet-context';
import {coinRewardClock,finishCoinRewardBatch,setCoinRewardForeground,getCoinRewardSnapshot,useCoinRewards,type CoinRewardBatch,type CoinRewardPoint} from '@/lib/coin-reward-store';
import {claimCoinWalletPortal,useCoinWalletRegistry} from '@/lib/coin-wallet-registry';
import {coinWalletMetrics,coinWalletWidth,homeWalletFontSize} from '@/lib/coin-wallet-layout';
import {BURROW_MOTION,coinArrivalTiming,coinPresentationTiming,formatAnimatedCoins} from '@/lib/burrow-motion';
import {useAppViewport} from '@/lib/app-viewport';
import {useCoinFlightFeedback} from '@/lib/use-coin-flight-feedback';
import {coinOperations} from '@/lib/coin-command-outbox';

export const RewardParticle=memo(function RewardParticle({index,width,origin,target,elapsed}:{
 index:number;width:number;origin:CoinRewardPoint;target:SharedValue<CoinRewardPoint>;elapsed:SharedValue<number>;
}){
 const source=useRef(origin).current;
 const style=useAnimatedStyle(()=>{
  const raw=Math.max(0,Math.min(1,(elapsed.value-index*BURROW_MOTION.coinStagger)/BURROW_MOTION.coinFlight));
  const t=raw<.5?2*raw*raw:1-(-2*raw+2)**2/2;
  const destination=target.value;
  return {opacity:raw===0||raw===1?0:1,transform:[
   {translateX:source.x+(destination.x-source.x)*t-12.5},
   {translateY:source.y+(destination.y-source.y)*t-Math.sin(t*Math.PI)*65-12.5},
   {rotate:`${Math.sin(t*Math.PI)*(index-3)*18}deg`},{scale:.85-t*.25},
  ]};
 });
 return <Animated.View style={[s.particle,style]}><CoinIcon size={25}/></Animated.View>;
});

/** One UI-thread balance controller. Receipts retarget it, never remount the
 * counter or restart flights. Render placement and monetary truth are separate. */
export function useCoinWalletController(batch:CoinRewardBatch|null,balance:number|null,onFinish:(id:number,revision:number)=>void):WalletMotion{
 const feedback=useCoinFlightFeedback();
 const count=useSharedValue(balance??0),pulse=useSharedValue(1),elapsed=useSharedValue(0);
 const [reduced,setReduced]=useState(false),active=useRef(0),started=useRef(0),run=useRef(0),celebrated=useRef(0);
 const latest=useRef({batch,onFinish});latest.current={batch,onFinish};
 useEffect(()=>{
  let alive=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive)setReduced(value);}).catch(()=>{});
  const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
  return()=>{alive=false;sub.remove();};
 },[]);
 useEffect(()=>()=>{run.current++;cancelAnimation(count);cancelAnimation(pulse);cancelAnimation(elapsed);},[count,pulse,elapsed]);
 useEffect(()=>{
  const token=++run.current;
  if(balance===null)return;
  if(!batch){active.current=0;celebrated.current=0;cancelAnimation(count);cancelAnimation(pulse);pulse.value=1;count.value=balance;return;}
  if(active.current!==batch.id){active.current=batch.id;celebrated.current=0;}
  started.current=batch.flight.startedAt;
  if(batch.celebration>celebrated.current){AccessibilityInfo.announceForAccessibility(`You earned ${batch.earned} coins. Balance ${formatAnimatedCoins(balance)}.`);}
  celebrated.current=batch.celebration;
  const age=coinRewardClock()-started.current;
  const arrival=coinArrivalTiming(age),presentation=coinPresentationTiming(age,reduced);
  const finish=()=>{const now=latest.current;if(token===run.current&&now.batch?.id===batch.id)now.onFinish(now.batch.id,now.batch.revision);};
  // Never reset count to a captured batch.from. Retarget from the running
  // native value, including when other rewards or receipts arrive mid-flight.
  count.value=withDelay(reduced?0:arrival.countDelay,withTiming(balance,{duration:reduced?0:Math.max(BURROW_MOTION.coinCorrection,arrival.countDuration),easing:Easing.linear}));
  // Only a new flight restores opacity. A late receipt cannot flash a fading
  // wallet back to full opacity or postpone the original dismissal deadline.
  if(active.current===batch.id&&age<coinArrivalTiming(0).flightEnd)pulse.value=1;
  pulse.value=withDelay(presentation.fadeDelay,withTiming(0,{duration:presentation.fadeDuration},done=>{if(done)runOnJS(finish)();}));
 },[batch?.id,batch?.celebration,balance,reduced,count,pulse]);
 useEffect(()=>{
  if(!batch)return;elapsed.value=0;
  if(!reduced){
   const duration=coinArrivalTiming(0).flightEnd;
   elapsed.value=withTiming(duration,{duration,easing:Easing.linear});
   feedback.start(`${batch.id}:${batch.flight.id}`,duration);
  }
  return()=>{cancelAnimation(elapsed);feedback.stop();};
 },[batch?.id,batch?.flight.id,reduced,elapsed,feedback]);
 return useMemo(()=>({count,pulse,elapsed,batch,balance,reduced}),[count,pulse,elapsed,batch,balance,reduced]);
}

export function CoinWalletProvider({children}:{children:ReactNode}){
 const {batch,displayBalance}=useCoinRewards();
 const model=useCoinWalletController(batch,displayBalance,finishCoinRewardBatch);
 useEffect(()=>{if(displayBalance!==null)coinOperations.resume();},[displayBalance!==null]);
 useEffect(()=>{
  const change=(state:string)=>{const active=state==='active';setCoinRewardForeground(active);
   if(!active){cancelAnimation(model.count);cancelAnimation(model.elapsed);cancelAnimation(model.pulse);model.count.value=getCoinRewardSnapshot().displayBalance??0;}
  };
  change(AppState.currentState);const sub=AppState.addEventListener('change',change);return()=>sub.remove();
 },[model.count,model.elapsed,model.pulse]);
 return <CoinWalletContext.Provider value={model}>{children}</CoinWalletContext.Provider>;
}
export function CoinRewardBanner(){return <CoinRewardSurface/>;}
/** Isolated rendering/QA uses the production controller and surface. */
export function CoinRewardBannerPresentation({batch,balance,onFinish}:{batch:CoinRewardBatch|null;balance:number|null;onFinish:(id:number,revision:number)=>void}){
 const model=useCoinWalletController(batch,balance,onFinish);
 return <CoinWalletContext.Provider value={model}><CoinRewardSurface/></CoinWalletContext.Provider>;
}
/** Promote the registered wallet into a native modal. Root yields while this
 * outlet owns it. The actual wallet and balance always use the same renderer. */
export function CoinWalletPortal(){
 const owner=useRef({}).current;
 useLayoutEffect(()=>claimCoinWalletPortal(owner),[owner]);
 return <CoinRewardSurface portal={owner}/>;
}
export function CoinRewardSurface({portal}:{portal?:object}){
 const model=useWalletMotion(),registry=useCoinWalletRegistry();
 const {width,height}=useWindowDimensions(),insets=useSafeAreaInsets();
 const canvas=useAppViewport(),frameWidth=canvas.width,frameLeft=(width-frameWidth)/2,frameTop=(height-canvas.height)/2;
 const slot=registry.slot,fontSize=slot?.fontSize??homeWalletFontSize(frameWidth,canvas.height),m=coinWalletMetrics(fontSize);
 const right=slot?width-slot.anchor.x-slot.anchor.width:frameLeft+18;
 const top=slot?.anchor.y??frameTop+insets.top+16;
 const fallbackOrigin=useMemo(()=>({x:width/2,y:frameTop+canvas.height*.46}),[width,height,frameTop,canvas.height]);
 const count=model?.count;
 const showAdd=slot?.showAdd??true;
 const target=useDerivedValue(()=>({x:width-right-coinWalletWidth(count?.value??0,fontSize,showAdd)+m.padding+m.iconSize/2,y:top+m.height/2}));
 const persistentWallet=!!slot,fade=model?.pulse;
 const temporaryWalletStyle=useAnimatedStyle(()=>({opacity:persistentWallet?1:fade?.value??1}));
 if(!model||model.balance===null||registry.portal!==(portal??null)||(!slot&&!model.batch)||(!portal&&slot&&!model.batch))return null;
 // Anchors and reward origins are measured in native-window coordinates.
 // Android/root and modal outlets live inside the canvas; translate the whole
 // overlay once, not just its wallet, so particle paths share those coordinates.
 const inCanvas=Platform.OS!=='ios'||!!portal;
 const content=<View pointerEvents="box-none" style={[s.overlay,inCanvas&&{left:-frameLeft,top:-frameTop,right:undefined,bottom:undefined,width,height}]}>
  {model.batch&&!model.reduced&&<View key={`${model.batch.id}:${model.batch.flight.id}`} pointerEvents="none" style={StyleSheet.absoluteFill}>
   {Array.from({length:BURROW_MOTION.coinParticles},(_,index)=><RewardParticle key={index} index={index} width={width}
    origin={model.batch!.flight.origin??fallbackOrigin} target={target} elapsed={model.elapsed}/>)}</View>}
  {(!!portal||!slot)&&<Animated.View style={[{position:'absolute',right,top:top-m.touchInset,height:m.touchHeight},temporaryWalletStyle]}>
   <CoinWalletFace count={model.count} balance={model.balance} fontSize={fontSize} showAdd={showAdd} disabled={!!portal||slot?.disabled}
    onPress={slot?.onPress??(()=>router.push('/(main)/coin-shop'))}/>
  </Animated.View>}
 </View>;
 return Platform.OS==='ios'&&!portal?<FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{content}</FullWindowOverlay>:content;
}
const s=StyleSheet.create({overlay:{...StyleSheet.absoluteFillObject,zIndex:10000,elevation:10000},
 particle:{position:'absolute',left:0,top:0}});
