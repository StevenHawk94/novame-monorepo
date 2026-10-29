import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useFocusEffect } from 'expo-router';
import UIAnimated, { cancelAnimation, Easing, ReduceMotion, withTiming, runOnJS, runOnUI, useAnimatedProps, useDerivedValue, useFrameCallback, useSharedValue, useReducedMotion, type SharedValue, type FrameInfo } from 'react-native-reanimated';
import { advanceWaterMotion, createWaterMotion, WATER_HOLES } from '@/lib/care-water-motion';
import { CareProgress } from './care-progress';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
const NativeG=UIAnimated.createAnimatedComponent(G<{matrix?:number[]}>);
const NativePath=UIAnimated.createAnimatedComponent(Path);
function WaterStream({motion,index}:{motion:SharedValue<ReturnType<typeof createWaterMotion>>;index:number}){
  const props=useAnimatedProps(()=>({d:motion.value.paths[index]}));
  return <NativePath animatedProps={props} fill="#7CB0C8" opacity={(index+1)/5}/>;
}
import { Image } from './burrow-image';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import { haptics } from '@/lib/haptics';
import { careLayout, CARROT_VIEWBOX, wateringCanPoint } from '@/lib/burrow-care-layout';

const CARROT_BODY='M97 84 C82 152 84 260 96 348 C99 368 104 374 110 366 C126 300 148 196 162 96 C166 76 154 66 132 66 C112 66 100 72 97 84 Z';
const BITE_COUNT=14;
const BITE_INTERVAL=320;
type Crumb={id:number;x:number;y:number;dx:number;dy:number;spin:number;size:number;color:string;duration:number;anim:Animated.Value};

/** A gentle continuous haptic train, only while the real hold is active.
 * Expo has no cross-platform continuous-haptics handle: short metered pulses
 * avoid long system vibrations that cannot stop promptly when a finger lifts. */
export function useCareHoldFeedback(onInterrupt:()=>void){
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const foreground=useRef(AppState.currentState==='active');
  const focused=useRef(false);
  const interrupt=useRef(onInterrupt);interrupt.current=onInterrupt;
  const stop=useCallback(()=>{if(timer.current!==null){clearInterval(timer.current);timer.current=null;}},[]);
  useFocusEffect(useCallback(()=>{
    focused.current=true;
    return()=>{focused.current=false;stop();interrupt.current();};
  },[stop]));
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',state=>{
      foreground.current=state==='active';
      if(!foreground.current){stop();interrupt.current();}
    });
    return()=>{stop();subscription.remove();};
  },[stop]);
  const canStart=()=>foreground.current&&focused.current;
  const start=()=>{
    if(timer.current!==null||!canStart())return;
    const pulse=()=>{void haptics.selection().catch(()=>{});};
    pulse();timer.current=setInterval(pulse,100);
  };
  return {start,stop,canStart};
}

function biteClip(bite:number) {
  if (!bite) return 'M0 -80 H250 V452 H0 Z';
  if (bite>=BITE_COUNT) return 'M0 0 Z';
  const y=372-(bite/BITE_COUNT)*306;
  const room=Math.max(0,y-66);
  const shrink=Math.min(1,room/27.625);
  let edge=`M 190 ${y}`;
  for(let i=0;i<4;i++){
    const xa=190-i*32.5, xb=xa-32.5;
    const seed=bite*7+i;
    const r=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
    const depth=16.25*.85*shrink*(1+(r(seed)-.5)*.8);
    const endY=y+(r(seed+99)-.5)*16.25*.5*.4*shrink;
    edge+=` Q ${(xa+xb)/2} ${y-depth*1.6} ${xb} ${endY}`;
  }
  return `M0 -80 H250 V${y} ${edge.replace(/^M /,'L ')} L0 ${y} Z`;
}

export function FeedInteraction({ onComplete, complete, availableHeight }: { onComplete:()=>void; complete:boolean; availableHeight?:number }) {
  const {width,height}=useWindowDimensions();
  const [measuredHeight,setMeasuredHeight]=useState<number|null>(null);
  const layout=useMemo(()=>careLayout(width,measuredHeight??availableHeight??height-140),[width,measuredHeight,availableHeight,height]);
  const {carrotHeight,carrotWidth}=layout;
  const [bite,setBite]=useState(0);
  const progress=useSharedValue(complete?1:0),finished=useRef(complete),generationRef=useRef(0);
  const [crumbs,setCrumbs]=useState<Crumb[]>([]);
  const biteRef=useRef(0);
  const crumbId=useRef(0);
  const crumbAnimations=useRef<Animated.CompositeAnimation[]>([]);
  const alive=useRef(true);
  const frame=useRef<ReturnType<typeof setTimeout>|null>(null),progressRef=useRef(complete?1:0),lastFrame=useRef(0);
  const onCompleteRef=useRef(onComplete);onCompleteRef.current=onComplete;
  const feedback=useCareHoldFeedback(()=>stop());
  const stop=()=>{
    generationRef.current++;
    if(frame.current!==null){clearTimeout(frame.current);frame.current=null;}
    if(lastFrame.current)progressRef.current=Math.min(1,progressRef.current+Math.max(0,Date.now()-lastFrame.current)/((BITE_COUNT-1)*BITE_INTERVAL));
    lastFrame.current=0;cancelAnimation(progress);feedback.stop();
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();crumbAnimations.current.forEach(animation=>animation.stop());};},[]);
  useEffect(()=>{if(complete){stop();finished.current=true;progressRef.current=1;progress.value=1;}},[complete]);
  const scatter=(atY:number,color='#F5841F')=>{
    const next=Array.from({length:4},()=>({
      id:++crumbId.current,x:124/230*carrotWidth,y:(atY-CARROT_VIEWBOX.top)/CARROT_VIEWBOX.height*carrotHeight,
      dx:(Math.random()-.5)*52/230*carrotWidth,dy:(70+Math.random()*70)/CARROT_VIEWBOX.height*carrotHeight,
      spin:(Math.random()-.5)*360,size:4+Math.random()*6,color,
      duration:520+Math.random()*240,anim:new Animated.Value(0),
    }));
    setCrumbs(previous=>[...previous,...next].slice(-40));
    next.forEach(crumb=>{
      const animation=Animated.timing(crumb.anim,{toValue:1,duration:crumb.duration,useNativeDriver:true});
      crumbAnimations.current.push(animation);
      animation.start(()=>{
        crumbAnimations.current=crumbAnimations.current.filter(item=>item!==animation);
        if(alive.current)setCrumbs(previous=>previous.filter(item=>item.id!==crumb.id));
      });
    });
  };
  const finish=(token:number)=>{
    if(!alive.current||token!==generationRef.current||!feedback.canStart()||finished.current)return;
    finished.current=true;stop();progressRef.current=1;progress.value=1;setBite(BITE_COUNT);onCompleteRef.current();
  };
  const tick=()=>{
    frame.current=null;
    const now=Date.now(),elapsed=Math.max(0,now-lastFrame.current);lastFrame.current=now;
    progressRef.current=Math.min(1,progressRef.current+elapsed/((BITE_COUNT-1)*BITE_INTERVAL));
    const nextBite=Math.floor(progressRef.current*BITE_COUNT);
    if(nextBite>biteRef.current){biteRef.current=nextBite;setBite(nextBite);scatter(372-nextBite/BITE_COUNT*306);}
    if(progressRef.current>=1){finish(generationRef.current);return;}
    frame.current=setTimeout(tick,80);
  };
  const start=()=>{
    if(frame.current!==null||complete||finished.current||progressRef.current>=1||!feedback.canStart())return;
    const token=++generationRef.current;
    feedback.start();lastFrame.current=Date.now();frame.current=setTimeout(tick,80);
    progress.value=withTiming(1,{duration:(1-progressRef.current)*((BITE_COUNT-1)*BITE_INTERVAL),easing:Easing.linear,reduceMotion:ReduceMotion.Never},done=>{if(done)runOnJS(finish)(token);});
  };
  return <View style={styles.carePage} onLayout={event=>{if(event.nativeEvent.layout.height>0)setMeasuredHeight(event.nativeEvent.layout.height);}}>
    <Text style={[styles.caption,{top:layout.hintTop}]}>Press and Hold</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Hold to feed your bunny" accessibilityActions={[{name:'activate',label:'Feed your bunny'}]} onAccessibilityAction={start} onAccessibilityTap={start} onPressIn={start} onPressOut={stop} style={[styles.carrotHit,{top:layout.carrotTop,width:carrotWidth,height:carrotHeight}]}>
      <Svg width={carrotWidth} height={carrotHeight} viewBox={`0 ${CARROT_VIEWBOX.top} ${CARROT_VIEWBOX.width} ${CARROT_VIEWBOX.height}`}>
        <Defs><ClipPath id="bite"><Path d={biteClip(bite)}/></ClipPath><ClipPath id="carrotBody"><Path d={CARROT_BODY}/></ClipPath></Defs>
        {bite<BITE_COUNT&&<G transform="translate(131 74) scale(.78)">
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#557F37" transform="rotate(-46) translate(0 -4) scale(1.02 .94)"/>
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#618F3C" transform="rotate(-17) translate(0 -8) scale(1.1 1.12)"/>
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#557F37" transform="rotate(11) translate(0 -7) scale(-1.06 1.06)"/>
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#618F3C" transform="rotate(38) translate(0 -3) scale(-.98 .9)"/>
          {['M1 8 C-8 -6 -22 -26 -34 -42','M1 8 C-3 -12 -10 -40 -18 -62','M1 8 C4 -14 8 -42 13 -62','M1 8 C8 -4 20 -24 31 -38'].map((d,i)=><Path key={i} d={d} fill="none" stroke="#3D6527" strokeWidth={3.4} strokeLinecap="round" opacity={.95}/>)}
        </G>}
        <G clipPath="url(#bite)"><Path d={CARROT_BODY} fill="#F1813C"/><G clipPath="url(#carrotBody)">
          <Path d="M86 90 C74 180 82 300 100 378 L78 378 L70 90 Z" fill="#D9682C" opacity={.14}/>
          <Path d="M140 84 C152 130 146 200 128 262 C150 200 156 128 150 84 Z" fill="#FFB27A" opacity={.3}/>
          {["M100 148 C116 141 134 147 151 142","M104 162 C118 157 130 161 142 158","M96 228 C111 221 128 228 139 222","M100 242 C112 238 122 241 131 238","M98 306 C109 301 120 306 127 302","M101 318 C109 315 116 317 121 315"].map((d,i)=><Path key={i} d={d} fill="none" stroke="#7A4A27" strokeWidth={2.6} opacity={.62}/>)}</G></G>
      </Svg>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>{crumbs.map(crumb=><Animated.View key={crumb.id} style={{position:'absolute',left:crumb.x-crumb.size/2,top:crumb.y-crumb.size/2,width:crumb.size,height:crumb.size,borderRadius:2,backgroundColor:crumb.color,
        opacity:crumb.anim.interpolate({inputRange:[0,.15,1],outputRange:[0,1,0]}),transform:[
          {translateX:crumb.anim.interpolate({inputRange:[0,1],outputRange:[0,crumb.dx]})},
          {translateY:crumb.anim.interpolate({inputRange:[0,1],outputRange:[0,crumb.dy]})},
          {scale:crumb.anim.interpolate({inputRange:[0,1],outputRange:[.4,.85]})},
          {rotate:crumb.anim.interpolate({inputRange:[0,1],outputRange:['0deg',`${crumb.spin}deg`]})},
        ]}}/>)}</View>
    </Pressable>
    <View style={[styles.meter,{bottom:layout.meterBottom}]}>
      <CareProgress progress={progress} label="Feeding" color="#F1813C"/>
    </View>
  </View>;
}

export function WaterInteraction({flower,onComplete,complete,availableHeight}:{flower?:BurrowArtAsset;onComplete:()=>void;complete:boolean;availableHeight?:number}){
  const {width,height}=useWindowDimensions();
  const [measuredHeight,setMeasuredHeight]=useState<number|null>(null);
  const layout=useMemo(()=>careLayout(width,measuredHeight??availableHeight??height-140,flower),[width,measuredHeight,availableHeight,height,flower]);
  const reduced=useReducedMotion(),motion=useSharedValue(createWaterMotion(complete)),running=useSharedValue(false);
  const measured=useSharedValue(layout),generation=useSharedValue(0),idleQueued=useSharedValue(false);
  const driverRef=useRef<ReturnType<typeof useFrameCallback>|null>(null);
  const holdTargets=useRef(new Set<string>()),alive=useRef(true),delivered=useRef(complete);
  const onCompleteRef=useRef(onComplete);onCompleteRef.current=onComplete;
  const feedback=useCareHoldFeedback(()=>release(true));
  const finish=useCallback((token:number)=>{
    if(!alive.current||token!==generation.value||!feedback.canStart()||delivered.current)return;
    delivered.current=true;holdTargets.current.clear();feedback.stop();onCompleteRef.current();
  },[]);
  const pauseIdle=useCallback(()=>{
    if(!holdTargets.current.size&&!motion.value.holding&&!motion.value.drops.length&&Math.abs(motion.value.tilt)<.05)driverRef.current?.setActive(false);
  },[]);
  const frameCallback=useCallback((frame:FrameInfo)=>{
    'worklet';
    if(!running.value)return;
    if(!motion.value.holding&&!motion.value.drops.length&&Math.abs(motion.value.tilt)<.05){
      if(!idleQueued.value){idleQueued.value=true;runOnJS(pauseIdle)();}return;
    }
    let done=false;
    motion.modify(state=>{done=advanceWaterMotion(state,frame.timeSincePreviousFrame??0,measured.value,reduced,Date.now());return state;},true);
    if(done)runOnJS(finish)(generation.value);
  },[running,motion,idleQueued,pauseIdle,measured,reduced,finish,generation]);
  const frameDriver=useFrameCallback(frameCallback,false);
  driverRef.current=frameDriver;
  useEffect(()=>{measured.value=layout;},[layout,measured]);
  useEffect(()=>{if(complete){delivered.current=true;feedback.stop();runOnUI(()=>{'worklet';motion.modify(state=>{state.completed=true;state.holding=false;state.progress=1;return state;},true);})();}},[complete]);
  useFocusEffect(useCallback(()=>{
    alive.current=true;
    const update=()=>{
      const active=AppState.currentState==='active';
      runOnUI((enabled:boolean)=>{'worklet';running.value=enabled;if(!enabled)generation.value++;})(active);
      if(!active)frameDriver.setActive(false);
    };
    update();const sub=AppState.addEventListener('change',update);
    return()=>{alive.current=false;frameDriver.setActive(false);sub.remove();runOnUI(()=>{'worklet';running.value=false;generation.value++;})();};
  },[frameDriver]));
  const progress=useDerivedValue(()=>motion.value.progress);
  const canProps=useAnimatedProps(()=>{
    const radians=motion.value.tilt*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
    return {matrix:[c,s,-s,c,34-34*c+10*s,10-34*s-10*c]};
  });
  const start=(target:string)=>{
    if(delivered.current||!feedback.canStart())return;
    holdTargets.current.add(target);feedback.start();
    runOnUI((startedAt:number)=>{'worklet';idleQueued.value=false;if(running.value&&!motion.value.completed)motion.modify(state=>{if(!state.holding){state.holdStartedAt=startedAt;state.holdSeconds=0;}state.holding=true;return state;},true);})(Date.now());
    frameDriver.setActive(true);
  };
  const release=(interrupted=false)=>{
    holdTargets.current.clear();feedback.stop();
    runOnUI((interrupt:boolean)=>{'worklet';if(interrupt)generation.value++;motion.modify(state=>{state.holding=false;state.holdStartedAt=0;state.holdSeconds=0;if(!state.completed)state.progress=0;if(interrupt){state.drops=[];state.tilt=0;state.paths=['','','','',''];}return state;},true);})(interrupted);
  };
  const releaseTarget=(target:string)=>{holdTargets.current.delete(target);if(!holdTargets.current.size)release();};
  return <View style={styles.carePage} onLayout={event=>{if(event.nativeEvent.layout.height>0)setMeasuredHeight(event.nativeEvent.layout.height);}}>
    <Text style={[styles.caption,{top:layout.hintTop}]}>Press and Hold</Text>
    <View style={[styles.waterStage,{top:layout.stageTop,width:layout.stageWidth,height:layout.stageHeight}]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${layout.stageWidth} ${layout.stageHeight}`} pointerEvents="none">
        <Defs><ClipPath id="waterLanding"><Rect x={0} y={0} width={layout.stageWidth} height={layout.waterEnd}/></ClipPath></Defs>
        <G transform={`translate(${layout.can.x} ${layout.can.y}) scale(${layout.can.scale})`}>
          <NativeG animatedProps={canProps}>
            <Path d="M66 -30 C138 -34 142 22 50 46" stroke="#9AC4D4" strokeWidth={15} fill="none" strokeLinecap="round"/>
            <Ellipse cx={10} cy={-62} rx={72} ry={16} rotation={11} origin="10, -62" fill="#4F7D8C"/>
            <Ellipse cx={-16} cy={54} rx={62} ry={14} rotation={11} origin="-16, 54" fill="#4F7D8C"/>
            <Path d="M-58.7 -69.4 L78.7 -42.6 L44.9 57.8 L-76.9 34.2 Z" fill="#9AC4D4"/>
            <Ellipse cx={10} cy={-56} rx={72} ry={16} rotation={11} origin="10, -56" fill="#9AC4D4"/>
            <Ellipse cx={-16} cy={46} rx={62} ry={14} rotation={11} origin="-16, 46" fill="#9AC4D4"/>
            <Path d="M-65.6 9.9 L-191.6 -46.1 L-200.4 -25.9 L-74.4 30.1 Z" fill="#9AC4D4"/>
            <Path d="M-191.6 -46.1 L-202.1 -71.6 L-225.9 -16.4 L-200.4 -25.9 Z" fill="#9AC4D4"/>
            <Ellipse cx={-214} cy={-44} rx={8} ry={30} rotation={23.3} origin="-214, -44" fill="#4F7D8C"/>
            <G fill="#38606E">{WATER_HOLES.map(([x,y],index)=><Circle key={index} cx={x} cy={y} r={2.4}/>)}</G>
            <G transform="translate(2 -8)" fill="#E9AC22">
              <Ellipse cx={0} cy={-23} rx={19} ry={16}/>
              <Ellipse cx={21.9} cy={-7.1} rx={19} ry={16} rotation={72} origin="21.9, -7.1"/>
              <Ellipse cx={13.5} cy={18.6} rx={19} ry={16} rotation={144} origin="13.5, 18.6"/>
              <Ellipse cx={-13.5} cy={18.6} rx={19} ry={16} rotation={216} origin="-13.5, 18.6"/>
              <Ellipse cx={-21.9} cy={-7.1} rx={19} ry={16} rotation={288} origin="-21.9, -7.1"/>
              <Circle cx={0} cy={0} r={12.5} fill="#1E6B4F"/>
            </G>
          </NativeG>
        </G>
        <G clipPath="url(#waterLanding)">{[0,1,2,3,4].map(index=><WaterStream key={index} motion={motion} index={index}/>)}</G>
      </Svg>
      <View pointerEvents="none" style={[styles.waterFlower,{left:layout.flower.left,top:layout.flower.top,width:layout.flower.width,height:layout.flower.height}]}>{flower?<Image source={flower.source} contentFit="contain" style={[styles.flower,layout.flower.image]}/>:<Text style={{fontSize:layout.flower.height*.7}}>🌼</Text>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="Hold the watering can for three seconds"
        onAccessibilityTap={()=>start('accessible')} accessibilityActions={[{name:'activate',label:'Water the flower'}]} onAccessibilityAction={()=>start('accessible')}
        onPressIn={()=>start('can')} onPressOut={()=>releaseTarget('can')} style={[styles.waterHit,layout.canHit]}/>
      <Pressable accessibilityRole="button" accessibilityLabel="Hold the flower for three seconds"
        onAccessibilityTap={()=>start('accessible')} accessibilityActions={[{name:'activate',label:'Water the flower'}]} onAccessibilityAction={()=>start('accessible')}
        onPressIn={()=>start('flower')} onPressOut={()=>releaseTarget('flower')} style={[styles.waterHit,{left:layout.flower.left-12,top:layout.flower.top-12,width:layout.flower.width+24,height:layout.flower.height+24}]}/>
    </View>
    <View style={[styles.meter,{bottom:layout.meterBottom,gap:12}]}>
      <CareProgress progress={progress} label="Watering" color="#5FCACA"/>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  carePage:{flex:1,alignItems:'center',position:'relative'},
  caption:{position:'absolute',left:0,right:0,fontSize:18,color:'#15110D',textAlign:'center',lineHeight:26},
  carrotHit:{position:'absolute',alignItems:'center',justifyContent:'center'},
  progressText:{fontSize:20,fontWeight:'800',color:'#42271B',textAlign:'center'},
  meter:{position:'absolute',width:'100%',paddingHorizontal:28,gap:24,alignItems:'center'},
  track:{height:14,width:'84%',maxWidth:340,backgroundColor:'#E7E1D9',borderRadius:10,overflow:'hidden'},
  carrotFill:{height:'100%',backgroundColor:'#F1813C'},waterFill:{height:'100%',backgroundColor:'#5FCACA'},
  waterStage:{position:'absolute'},waterHit:{position:'absolute'},
  waterFlower:{position:'absolute',overflow:'hidden',alignItems:'center',justifyContent:'center'},
  flower:{position:'absolute'},
});
