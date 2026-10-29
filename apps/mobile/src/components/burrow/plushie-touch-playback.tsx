import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AppState,Text,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {runOnJS,runOnUI,useReducedMotion,useSharedValue,type FrameInfo} from 'react-native-reanimated';
import type {TouchQuality} from '@novame/domain';
import {advanceTouchPlayback,createTouchPlayback,pauseTouchPlayback} from '@/lib/plushie-touch-motion';
import {createToyMotion,type ToyMotion} from '@/lib/squishy-toy-motion';
import {burrowArtForItem} from '@/lib/burrow-art-assets';
import type {TouchMessage} from '@/lib/plushie-touch-store';
import {haptics} from '@/lib/haptics';
import {touchCapabilities} from '@/lib/touch-note-runtime';
import {queueTouchHeartBursts} from '@/lib/touch-heart-motion';
import {PlushieTouchToy} from './plushie-touch-toy';
import {TouchFlyingHearts,TouchHeartMeter} from './plushie-touch-heart';
export function PlushieTouchPlayback({message,size,width=size,height=size+290,paused=false,initialQuality='full',adaptive=true,onFinish,onPause,onQuality,onSample}:{
 message:TouchMessage;size:number;width?:number;height?:number;paused?:boolean;initialQuality?:TouchQuality;adaptive?:boolean;
 onFinish:()=>void;onPause?:(reason?:string)=>void;onQuality?:(q:TouchQuality)=>void;onSample?:(sample:{ms:number[];quality:TouchQuality})=>void}){
 const reduced=useReducedMotion(),focused=useIsFocused(),mounted=useRef(true),active=useRef(!paused);
 const initial=reduced||initialQuality==='light'?'standard':initialQuality;
 const [quality,setQuality]=useState<TouchQuality>(initial),[count,setCount]=useState(0);
 const cursor=useSharedValue(createTouchPlayback(initial)),clock=useSharedValue(0),bursts=useSharedValue<number[]>([-1e6,-1e6,-1e6,-1e6,-1e6,-1e6]);
 const samples=useSharedValue<number[]>([]),lastSample=useSharedValue(0),enabled=useSharedValue(!paused);
 const art=useMemo(()=>burrowArtForItem(message.toy,'couple_dolls'),[message.toy]);
 const handlers=useRef({onFinish,onPause,onQuality,onSample});handlers.current={onFinish,onPause,onQuality,onSample};
 active.current=!paused&&focused;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current=false;};},[]);
 useLayoutEffect(()=>{runOnUI((p:boolean)=>{'worklet';enabled.value=!p;cursor.modify(s=>{pauseTouchPlayback(s,p);return s;},true);})(paused);},[paused,enabled,cursor]);
 const suspend=useCallback((reason?:string)=>{active.current=false;runOnUI(()=>{'worklet';enabled.value=false;cursor.modify(s=>{pauseTouchPlayback(s,true);return s;},true);})();handlers.current.onPause?.(reason);},[cursor,enabled]);
 useEffect(()=>{if(!focused)suspend();},[focused,suspend]);
 useEffect(()=>{const app=AppState.addEventListener('change',s=>{if(s!=='active')suspend();});return()=>app.remove();},[suspend]);
 useEffect(()=>{const warning=AppState.addEventListener('memoryWarning',()=>{
  if(!adaptive)return;
  if(quality==='standard'){suspend('Memory is low. Close other apps, then tap Continue.');return;}
  runOnUI(()=>{'worklet';cursor.modify(s=>({...s,quality:'standard'}));})();setQuality('standard');
 });return()=>warning.remove();},[adaptive,cursor,quality,suspend]);
 useEffect(()=>{
  if(!adaptive||paused||!focused)return;let live=true,busy=false;
  const timer=setInterval(()=>{if(busy||!active.current)return;busy=true;void touchCapabilities().then(c=>{
   if(!live||!active.current||!c||!Number.isFinite(c.availableBytes))return;
   if(quality==='full'&&(c.lowMemory||c.availableBytes<96*1024*1024)){
    runOnUI(()=>{'worklet';cursor.modify(s=>({...s,quality:'standard'}));})();setQuality('standard');handlers.current.onQuality?.('standard');
   }else if(quality==='standard'&&(c.lowMemory||c.availableBytes<24*1024*1024))suspend('Memory is low. Close other apps, then tap Continue.');
  }).finally(()=>{busy=false;});},3000);
  return()=>{live=false;clearInterval(timer);};
 },[adaptive,paused,focused,quality,cursor,suspend]);
 const notify=useCallback((n:number,q:TouchQuality,finished:boolean)=>{if(!mounted.current||(!active.current&&!finished))return;setCount(n);setQuality(q);handlers.current.onQuality?.(q);if(finished){active.current=false;handlers.current.onFinish();}},[]);
 const pulse=useCallback(()=>{if(mounted.current&&active.current)void haptics.touchPulse();},[]);
 const sample=useCallback((ms:number[],q:TouchQuality)=>{if(mounted.current)handlers.current.onSample?.({ms,quality:q});},[]);
 const clip=message.clip;
 const frame=useCallback((m:ToyMotion,f:FrameInfo)=>{
  'worklet';if(!enabled.value||cursor.value.done)return false;
  const c=cursor.value,started=c.at>=0,result=advanceTouchPlayback(c,m,clip,f.timestamp,started?f.timeSincePreviousFrame??0:0,adaptive);
  cursor.value=c;clock.value=result.elapsed;
  if(result.pulse){bursts.value=queueTouchHeartBursts(bursts.value,result.elapsed);runOnJS(pulse)();}
  if(result.finished){enabled.value=false;bursts.value=[-1e6,-1e6,-1e6,-1e6,-1e6,-1e6];Object.assign(m,createToyMotion(m.geometry,m.reduced));}
  if(result.notify)runOnJS(notify)(result.count,c.quality,result.finished);
  if(onSample&&started&&f.timeSincePreviousFrame){samples.value=[...samples.value,f.timeSincePreviousFrame];if(f.timestamp-lastSample.value>=1000){runOnJS(sample)(samples.value,c.quality);samples.value=[];lastSample.value=f.timestamp;}}
  return true;
 },[enabled,clock,cursor,clip,adaptive,bursts,pulse,notify,onSample,samples,lastSample,sample]);
 if(!art)return <Text>This plushie is not available on this App version.</Text>;
 const meterSize=Math.min(width*.39,height*.23);
 return <View style={{width,height}}>
  <View pointerEvents="none" style={{position:'absolute',top:height*.035,alignSelf:'center'}}><TouchHeartMeter count={count} size={meterSize} clock={clock} bursts={bursts} reduced={reduced}/></View>
  <View style={{position:'absolute',top:height*.27,left:(width-size)/2,width:size,height:size}}>
   <PlushieTouchToy asset={art} photo={message.photo??undefined} size={size} quality={quality} scope={`touch:${message.id}`} onFrame={frame} frameEnabled={enabled}/>
   {!reduced&&<TouchFlyingHearts clock={clock} bursts={bursts} size={size} travelY={height*.035+meterSize/2-height*.27-size*.42}/>}
  </View>
 </View>;
}
