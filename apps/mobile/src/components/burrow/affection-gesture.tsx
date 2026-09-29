import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { haptics } from '@/lib/haptics';
import Svg, { Path } from 'react-native-svg';
import type { AffectionType } from '@novame/domain';

export const AFFECTION_COPY: Record<AffectionType,{label:string;symbol:string;hint:string}> = {
  hug:{label:'Hug',symbol:'🤗',hint:'Hold gently for 3 seconds, then release.'},
  spicy:{label:'Spicy',symbol:'🌶️',hint:'Tap 10 times to turn up the warmth.'},
  cuddle:{label:'Cuddle',symbol:'🐰',hint:'Stroke left and right four times.'},
  gratitude:{label:'Gratitude',symbol:'💛',hint:'Bring two fingers together and hold for a second.'},
  kiss:{label:'Kiss',symbol:'💋',hint:'Spread two fingers apart, then release to send.'},
  miss_you:{label:'Miss You',symbol:'💗',hint:'Trace the heart clockwise from its top center.'},
};

const heartPoints = [[.5,.35],[.3,.2],[.15,.35],[.2,.55],[.5,.8],[.8,.55],[.85,.35],[.7,.2],[.5,.35]];

export function AffectionGesture({ type, disabled, onComplete }: {
  type: AffectionType; disabled: boolean; onComplete: (metrics: Record<string,number>) => void;
}) {
  const [progress,setProgress]=useState(0);
  const [active,setActive]=useState(false);
  const [assist,setAssist]=useState<number|null>(null);
  const [assistReady,setAssistReady]=useState(false);
  const focused=useIsFocused();
  const interactive=useRef(focused&&AppState.currentState==='active');
  interactive.current=focused&&AppState.currentState==='active';
  const tracking=useRef(false);
  const metrics=useRef<Record<string,number>|null>(null);
  const hapticStep=useRef(0);
  useEffect(()=>{
    const step=Math.floor(progress*4);
    if(interactive.current&&step>hapticStep.current&&step<4)void haptics.light().catch(()=>{});
    hapticStep.current=step;
  },[progress]);
  const gesture=useRef({ started:0, distance:0, maxScale:1, inwardAt:0, turns:0, direction:0, lastX:0, path:0, taps:0 });
  const done=useRef(false);
  const size=useRef({width:300,height:280});
  const callback=useRef(onComplete); callback.current=value=>{metrics.current=value;void haptics.light().catch(()=>{});onComplete(value);};
  useEffect(()=>{
    if(!focused){interactive.current=false;tracking.current=false;setActive(false);setAssist(null);setAssistReady(false);}
    const sub=AppState.addEventListener('change',state=>{interactive.current=focused&&state==='active';if(state!=='active'){tracking.current=false;setActive(false);setAssist(null);setAssistReady(false);}});
    return()=>sub.remove();
  },[focused]);
  useEffect(()=>{if(assist===null)return;const timer=setTimeout(()=>setAssistReady(true),Math.max(0,3000-(performance.now()-assist)));return()=>clearTimeout(timer);},[assist]);
  useEffect(()=>{ done.current=false;setProgress(0);setActive(false);gesture.current.taps=0; },[type]);
  useEffect(()=>{
    if(!active || type!=='hug') return;
    const timer=setInterval(()=>setProgress(Math.min(1,(performance.now()-gesture.current.started)/3000)),50);
    return ()=>clearInterval(timer);
  },[active,type]);
  const responder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>interactive.current && !disabled && !done.current && type!=='spicy',
    onMoveShouldSetPanResponder:()=>interactive.current && !disabled && !done.current && type!=='spicy',
    onPanResponderGrant:()=>{
      if(!interactive.current||disabled)return;
      tracking.current=true;
      gesture.current={started:performance.now(),distance:0,maxScale:1,inwardAt:0,turns:0,direction:0,lastX:0,path:0,taps:0};
      setProgress(0);setActive(true);
    },
    onPanResponderMove:(event,state)=>{
      if(!interactive.current||!tracking.current||disabled)return;
      const g=gesture.current;
      const touches=event.nativeEvent.touches;
      if((type==='kiss'||type==='gratitude') && touches.length===2){
        const distance=Math.hypot(touches[0].pageX-touches[1].pageX,touches[0].pageY-touches[1].pageY);
        if(!g.distance) g.distance=Math.max(distance,20);
        const scale=distance/g.distance;g.maxScale=Math.max(g.maxScale,scale);
        if(type==='kiss') setProgress(Math.min(1,Math.max(0,(scale-1)/.5)));
        else if(scale<=.7){ if(!g.inwardAt)g.inwardAt=performance.now();setProgress(Math.min(1,(performance.now()-g.inwardAt)/1000)); }
        else {g.inwardAt=0;setProgress(0);}
      } else if(type==='gratitude'){g.inwardAt=0;setProgress(0);}
      if(type==='cuddle' && Math.abs(state.dx-g.lastX)>28){
        const direction=Math.sign(state.dx-g.lastX);
        if(direction!==g.direction){g.turns++;g.direction=direction;}
        g.lastX=state.dx;setProgress(Math.min(1,g.turns/4));
      }
      if(type==='miss_you'){
        const point=heartPoints[g.path];
        if(point && Math.hypot(event.nativeEvent.locationX/size.current.width-point[0],event.nativeEvent.locationY/size.current.height-point[1])<.18){
          g.path++;setProgress(g.path/heartPoints.length);
        }
      }
    },
    onPanResponderRelease:()=>{
      if(!interactive.current||!tracking.current||disabled){tracking.current=false;setActive(false);setProgress(0);return;}
      tracking.current=false;
      setActive(false);const g=gesture.current;const durationMs=performance.now()-g.started;
      const valid=type==='hug'?durationMs>=3000:type==='kiss'?g.maxScale>=1.5:
        type==='gratitude'?g.inwardAt>0&&performance.now()-g.inwardAt>=1000:
        type==='cuddle'?g.turns>=4:g.path===heartPoints.length;
      if(valid){done.current=true;setProgress(1);callback.current({durationMs,scale:g.maxScale,turns:g.turns,pathPoints:g.path,holdMs:g.inwardAt?performance.now()-g.inwardAt:0});}
      else setProgress(0);
    },
    onPanResponderTerminate:()=>{tracking.current=false;setActive(false);setProgress(0);},
    onPanResponderTerminationRequest:()=>false,
  }),[type,disabled]);
  return <View style={styles.card}>
    <Text style={styles.title}>{AFFECTION_COPY[type].label}</Text><Text style={styles.hint}>{AFFECTION_COPY[type].hint}</Text>
    <View style={styles.pad} {...responder.panHandlers} onLayout={e=>{size.current=e.nativeEvent.layout;}}>
      {type==='miss_you'?<Svg width="100%" height="100%" viewBox="0 0 300 280" pointerEvents="none"><Path d="M150 98 C90 10 5 80 60 154 L150 224 L240 154 C295 80 210 10 150 98Z" fill="none" stroke="#E69C99" strokeWidth="16" strokeDasharray="10 7" /></Svg>:
        <Pressable disabled={disabled||type!=='spicy'} accessibilityRole="button" accessibilityLabel="Tap to add warmth" onPress={()=>{
          if(done.current||!interactive.current)return;const count=++gesture.current.taps;setProgress(count/10);
          if(count===10){done.current=true;callback.current({taps:count});}
        }}><Text style={[styles.symbol,{transform:[{scale:1+progress*.25}]}]}>{AFFECTION_COPY[type].symbol}</Text></Pressable>}
    </View>
    <View style={styles.track}><View style={[styles.fill,{width:`${progress*100}%`}]} /></View>
    <Text style={styles.hint}>{done.current?'Ready to send':`${Math.round(progress*100)}%`}</Text>
    {!done.current&&<Pressable accessibilityRole="button" accessibilityLabel={assist===null?'Use accessible gesture':assistReady?'Send love':'Cancel accessible gesture'} disabled={disabled} style={{padding:14,borderRadius:16,backgroundColor:'#F5DAD2'}} onPress={()=>{
      if(!interactive.current||disabled)return;
      if(assist===null){setAssist(performance.now());setAssistReady(false);return;}
      const elapsed=performance.now()-assist;
      if(elapsed>=3000){done.current=true;setProgress(1);callback.current({assistedHoldMs:Math.floor(elapsed)});}
      setAssist(null);setAssistReady(false);
    }}><Text style={styles.hint}>{assist===null?'Accessible option · tap, wait 3 seconds, then confirm':assistReady?'Send love':'Preparing… tap to cancel'}</Text></Pressable>}
    {assistReady&&<Text accessibilityLiveRegion="polite" style={styles.hint}>Ready. Activate Send love to confirm.</Text>}
    {done.current&&!disabled&&metrics.current&&<Pressable accessibilityRole="button" style={{padding:14}} onPress={()=>callback.current(metrics.current!)}><Text style={styles.hint}>Retry sending</Text></Pressable>}
    {done.current && !disabled && <Pressable accessibilityRole="button" onPress={()=>{done.current=false;gesture.current.taps=0;setProgress(0);}}><Text style={styles.hint}>Try gesture again</Text></Pressable>}
  </View>;
}
const styles=StyleSheet.create({card:{backgroundColor:'#FFF1E6',borderRadius:28,padding:22,gap:12},title:{fontSize:28,fontWeight:'800',color:'#823F41',textAlign:'center'},hint:{color:'#995B58',textAlign:'center',fontSize:15},pad:{height:250,alignItems:'center',justifyContent:'center'},symbol:{fontSize:90},track:{height:9,borderRadius:8,overflow:'hidden',backgroundColor:'#F5DAD2'},fill:{height:9,backgroundColor:'#E8757A'}});
