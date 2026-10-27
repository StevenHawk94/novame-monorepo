import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AppState,Text,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {runOnJS,runOnUI,useSharedValue,useReducedMotion,type FrameInfo} from 'react-native-reanimated';
import type {TouchClip,TouchEvent} from '@novame/domain';
import {createTouchRecorder,type TouchRecordingCheckpoint} from '@/lib/plushie-touch-recorder';
import type {BurrowArtAsset} from '@/lib/burrow-art-assets';
import type {MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import type {ToyMotion} from '@/lib/squishy-toy-motion';
import {PlushieTouchToy} from './plushie-touch-toy';
import {TouchHeartMeter,TouchFlyingHearts} from './plushie-touch-heart';

export type RecordingStatus={started:boolean;seconds:number;count:number};
export function PlushieTouchRecording({asset,photo,size,scope,onComplete,onInterrupted,initial,onCheckpoint,onStatus,width=size,height=size+290,bottom=24}:{
 asset:BurrowArtAsset;photo:MajorUpdateBootstrap['roomPhotos'][number];size:number;scope:string;
 onComplete:(clip:TouchClip)=>void;onInterrupted:()=>void;initial?:TouchRecordingCheckpoint|null;
 onCheckpoint?:(checkpoint:TouchRecordingCheckpoint)=>void;onStatus?:(status:RecordingStatus)=>void;width?:number;height?:number;bottom?:number;
}){
 const [count,setCount]=useState(initial?.touches??0),[seconds,setSeconds]=useState(Math.ceil((60000-(initial?.elapsedMs??0))/1000));
 const [started,setStarted]=useState(initial?.started??false),[saveError,setSaveError]=useState(false),focused=useIsFocused(),reduced=useReducedMotion();
 const recorder=useRef(createTouchRecorder(initial,2)),live=useRef(true),accepting=useRef(false),done=useRef(false),elapsedJS=useRef(initial?.elapsedMs??0),savedAt=useRef(-1);
 const handlers=useRef({onComplete,onInterrupted,onCheckpoint,onStatus});handlers.current={onComplete,onInterrupted,onCheckpoint,onStatus};
 const feedback=useSharedValue(initial?.touches??0),start=useSharedValue(-1),offset=useSharedValue(initial?.elapsedMs??0),clock=useSharedValue(0),
  elapsedUI=useSharedValue(initial?.elapsedMs??0),progress=useSharedValue((initial?.elapsedMs??0)/60000),sent=useSharedValue(false),
  enabled=useSharedValue(false),resuming=useSharedValue(initial?.started??false),last=useSharedValue(-1),serial=useSharedValue(0),
  bursts=useSharedValue<number[]>([-1e6,-1e6,-1e6,-1e6,-1e6,-1e6]);
 const persist=useCallback((force=false)=>{
  if(!force&&elapsedJS.current-savedAt.current<500)return;
  try{handlers.current.onCheckpoint?.(recorder.current.checkpoint(elapsedJS.current));savedAt.current=elapsedJS.current;setSaveError(false);}
  catch{setSaveError(true);} // Keep the live recording; never return to idle.
 },[]);
 const pause=useCallback(()=>{
  // Only lifecycle boundaries read the UI value synchronously. No per-frame
  // JS polling, wall clock, or background time is added to the clip.
  const elapsed=Math.max(elapsedJS.current,Math.floor(elapsedUI.value));elapsedJS.current=elapsed;
  accepting.current=false;
  enabled.value=false;recorder.current.pause(elapsed);persist(true);
 },[elapsedUI,enabled,persist]);
 const resume=useCallback(()=>{
  if(done.current)return;accepting.current=true;const at=elapsedJS.current,wasStarted=recorder.current.started;
  runOnUI(()=>{'worklet';offset.value=at;elapsedUI.value=at;start.value=-1;last.value=-1;resuming.value=wasStarted;enabled.value=true;})();
 },[offset,elapsedUI,start,last,resuming,enabled]);
 useLayoutEffect(()=>{
  live.current=true;if(focused&&AppState.currentState==='active')resume();
  return()=>{live.current=false;if(!done.current)pause();enabled.value=false;};
 },[focused,resume,pause,enabled]);
 useEffect(()=>{const app=AppState.addEventListener('change',status=>{if(status==='active'&&focused)resume();else if(!done.current)pause();});return()=>app.remove();},[focused,resume,pause]);
 useEffect(()=>{handlers.current.onStatus?.({started,seconds,count});},[started,seconds,count]);
 useEffect(()=>{runOnUI((n:number)=>{'worklet';if(n>feedback.value){const b=[...bursts.value];for(let i=0;i<Math.min(6,n-feedback.value);i++)b[serial.value++%6]=clock.value;bursts.value=b;}feedback.value=n;})(count);},[count,feedback,bursts,serial,clock]);
 const input=useCallback((batch:TouchEvent[])=>{
  if(!live.current||!accepting.current||done.current)return;
  for(const e of batch)recorder.current.input(e);
  elapsedJS.current=Math.max(elapsedJS.current,batch.at(-1)?.[0]??0);
  setStarted(recorder.current.started);setCount(recorder.current.touches);persist(savedAt.current<0);
 },[persist]);
 const tick=useCallback((elapsed:number,finish:boolean)=>{
  if(!live.current||done.current)return;elapsedJS.current=Math.max(elapsedJS.current,Math.floor(elapsed));
  recorder.current.advance(elapsed);setCount(recorder.current.touches);
  setSeconds(Math.max(0,Math.ceil((60000-elapsed)/1000)));persist(finish);
  if(finish){
   // Completion uses the SAME logical active-time axis as recorded events,
   // not a separately rounded absolute UI start timestamp.
   const clip=recorder.current.finishElapsed(60000);done.current=true;
   if(clip)handlers.current.onComplete(clip);else handlers.current.onInterrupted();
  }
 },[persist]);
 const frame=useCallback((_m:ToyMotion,f:FrameInfo)=>{
  'worklet';clock.value=f.timestamp;if(!enabled.value||sent.value)return;
  if(resuming.value&&start.value<0)start.value=f.timestamp;
  if(start.value<0)return;
  const elapsed=Math.min(60000,Math.max(elapsedUI.value,offset.value+Math.max(0,f.timestamp-start.value)));
  elapsedUI.value=elapsed;progress.value=elapsed/60000;
  if(elapsed>=60000){sent.value=true;runOnJS(tick)(60000,true);}
  else if(f.timestamp-last.value>=100){last.value=f.timestamp;runOnJS(tick)(elapsed,false);}
 },[clock,enabled,sent,resuming,start,offset,elapsedUI,progress,last,tick,feedback,bursts,serial]);
 const toyTop=height*.27;
 return <View testID="touch-recording-stage" style={{width,height}}>
  <View pointerEvents="none" style={{position:'absolute',top:height*.035,alignSelf:'center'}}><TouchHeartMeter progress={progress} count={count} size={Math.min(width*.39,height*.23)}/></View>
  <View style={{position:'absolute',top:toyTop,left:0,width,height:height-toyTop}}>
   <PlushieTouchToy asset={asset} photo={photo} size={size} quality="full" scope={scope} recording onInput={input} inputStart={start} inputOffset={offset} onFrame={frame}
    containerStyle={{width,height:height-toyTop}} actionsStyle={{position:'absolute',top:height-bottom-78-toyTop,left:24,width:width-48}}/>
   {!reduced&&<View pointerEvents="none" style={{position:'absolute',top:0,left:(width-size)/2,width:size,height:size}}><TouchFlyingHearts clock={clock} bursts={bursts}/></View>}</View>
  {saveError&&<Text accessibilityRole="alert" style={{position:'absolute',bottom:bottom+94,left:24,right:24,textAlign:'center',color:'#7D251B',backgroundColor:'#FFF9EF',padding:8,borderRadius:12}}>Your recording is still here. Free up storage to save it; we’ll retry.</Text>}
 </View>;
}
