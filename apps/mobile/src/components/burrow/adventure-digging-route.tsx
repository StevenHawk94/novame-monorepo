import { memo, useEffect, useId, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Animated, { cancelAnimation, Easing, ReduceMotion, runOnUI, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Image } from './burrow-image';
import { ADVENTURE_PROGRESS_ART } from '@/lib/adventure-progress-assets';
import { DIGGING_PATH, DIGGING_PATH_HEIGHT, DIGGING_PATH_LENGTH, DIGGING_PATH_WIDTH, diggingDirtParticle, diggingPathPoint,diggingCursorFraction } from '@/lib/adventure-digging-path';
import type { AdventureProgressMotion } from '@/lib/adventure-presentation-clock';
import type {BunnyVariant} from '@/lib/bunny-identity-model';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** SVG invalidates its entire drawing surface for an animated path prop.
 * Keep the unchanging earth strokes on a separate retained surface, so a
 * subpixel orange-progress update does not repaint both full tunnel strokes. */
const TunnelBed=memo(function TunnelBed({id}:{id:string}){
  return <Svg accessible={false} width="100%" height="100%" viewBox={`0 0 ${DIGGING_PATH_WIDTH} ${DIGGING_PATH_HEIGHT}`}>
    <Defs><LinearGradient id={`earth${id}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#884724"/><Stop offset="1" stopColor="#71391E"/></LinearGradient></Defs>
    <Path d={DIGGING_PATH} fill="none" stroke="#5B2C13" strokeWidth={72} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d={DIGGING_PATH} fill="none" stroke={`url(#earth${id})`} strokeWidth={56} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
});

function DirtParticle({cycle,progress,index,active,scale}:{cycle:SharedValue<number>;progress:SharedValue<number>;index:number;active:boolean;scale:number}) {
  const style = useAnimatedStyle(() => {
    const p = diggingDirtParticle(cycle.value % 1, index, diggingPathPoint(progress.value).facing);
    return {opacity:active && progress.value < 1 ? p.opacity : 0,
      transform:[{translateX:p.x * scale},{translateY:p.y * scale},{scale:p.scale}]};
  });
  const size = (4 + index % 3) * scale;
  return <Animated.View style={[s.dirt,{width:size,height:size,borderRadius:size*.3},style]}/>;
}

/** One shared UI-thread progress drives path trimming and cursor position. */
export function AdventureDiggingRoute({progress,remaining,scale,pending=false,timeline='journey',motion,leaderVariant='biscuit',followerVariant}:{progress:number;remaining:number;scale:number;pending?:boolean;timeline?:string;motion?:AdventureProgressMotion;leaderVariant?:BunnyVariant;followerVariant?:BunnyVariant}) {
  const focused = useIsFocused(), reduced = useReducedMotion();
  const [foreground,setForeground] = useState(AppState.currentState === 'active');
  const id = useId().replace(/[^a-zA-Z0-9]/g,'');
  const shown = useSharedValue(progress), cycle = useSharedValue(0);
  // The local durable Start intent drives both distance and digging immediately.
  // Confirmation only adjusts the remaining motion, never this loop's phase.
  const active = focused && foreground && (pending || (remaining > 0 && progress < 1));
  const moving = active;
  const clock = useRef({progress,remaining,motion});clock.current={progress,remaining,motion};
  useEffect(() => {
    const sub = AppState.addEventListener('change',state => setForeground(state === 'active'));
    return () => sub.remove();
  },[]);
  useEffect(() => {
    // Only entry/resume, confirmation or an actual plan change retimes motion.
    // The parent's one-second countdown renders must never cancel/restart it.
    const next=clock.current;
    runOnUI((fraction:number,milliseconds:number,advance:boolean,target:number,afterwards:number)=>{
      'worklet';
      cancelAnimation(shown);
      shown.value=Math.max(shown.value,Math.max(0,Math.min(1,fraction)));
      if(advance&&milliseconds>0&&shown.value<1){
        const first=withTiming(Math.max(shown.value,target),{duration:milliseconds,easing:Easing.linear,reduceMotion:ReduceMotion.Never});
        shown.value=afterwards>0?withSequence(first,withTiming(1,{duration:afterwards,easing:Easing.linear,reduceMotion:ReduceMotion.Never})):first;
      }
    })(next.progress,next.motion?.duration??next.remaining,moving,next.motion?.target??1,next.motion?.afterwards??0);
    return () => cancelAnimation(shown);
  },[shown,timeline,moving,pending]);
  useEffect(() => {
    runOnUI((animate:boolean)=>{
      'worklet';
      cancelAnimation(cycle);
      // Keep the phase on pause/resume; confirmation does not touch this loop.
      if(animate)cycle.value=withRepeat(withTiming(cycle.value+1,{duration:1000,easing:Easing.linear}),-1,false);
    })(active&&!reduced);
    return () => cancelAnimation(cycle);
  },[cycle,active,reduced]);
  const trace = useAnimatedProps(() => ({strokeDashoffset:DIGGING_PATH_LENGTH*(1-diggingCursorFraction(shown.value)),opacity:1}));
  const cursor = useAnimatedStyle(() => {
    const p = diggingPathPoint(diggingCursorFraction(shown.value));
    return {transform:[{translateX:p.x*scale},{translateY:p.y*scale}]};
  });
  const follower=useAnimatedStyle(()=>{
    const p=diggingPathPoint(diggingCursorFraction(shown.value,true));
    return {transform:[{translateX:p.x*scale},{translateY:p.y*scale}]};
  });
  const followerPose=useAnimatedStyle(()=>({transform:[
    {translateY:active&&!reduced&&shown.value<1?Math.sin(cycle.value*Math.PI*4)*2*scale:0},
    {scaleX:diggingPathPoint(diggingCursorFraction(shown.value,true)).facing},
    {rotate:`${active&&!reduced&&shown.value<1?Math.sin(cycle.value*Math.PI*2)*4:0}deg`},
  ]}));
  const pose = useAnimatedStyle(() => ({transform:[
    {translateY:active && !reduced && shown.value<1 ? Math.sin(cycle.value*Math.PI*4)*2*scale : 0},
    {scaleX:diggingPathPoint(diggingCursorFraction(shown.value)).facing},
    {rotate:`${active && !reduced && shown.value<1 ? Math.sin(cycle.value*Math.PI*2)*4 : 0}deg`},
  ]}));
  return <View pointerEvents="none" testID="adventure-digging-route" style={{width:DIGGING_PATH_WIDTH*scale,height:DIGGING_PATH_HEIGHT*scale}}
    accessibilityRole="progressbar" accessibilityLabel="Adventure progress" accessibilityValue={{min:0,max:100,now:Math.round(progress*100)}}>
    <TunnelBed id={id}/>
    <Svg accessible={false} style={StyleSheet.absoluteFillObject} width="100%" height="100%" viewBox={`0 0 ${DIGGING_PATH_WIDTH} ${DIGGING_PATH_HEIGHT}`}>
      <Defs>
        <LinearGradient id={`dug${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FF881C"/><Stop offset="1" stopColor="#FF9824"/></LinearGradient>
      </Defs>
      <AnimatedPath d={DIGGING_PATH} fill="none" stroke={`url(#dug${id})`} strokeWidth={56} strokeLinecap="butt" strokeLinejoin="round"
        strokeDasharray={[DIGGING_PATH_LENGTH,DIGGING_PATH_LENGTH]} animatedProps={trace}/>
    </Svg>
    <Image source={ADVENTURE_PROGRESS_ART.start} contentFit="contain" style={{position:'absolute',left:12*scale,top:-3*scale,width:100*scale,height:100*scale}}/>
    <Image source={ADVENTURE_PROGRESS_ART.end} contentFit="contain" style={{position:'absolute',left:364*scale,top:335*scale,width:108*scale,height:108*scale}}/>
    {followerVariant&&<Animated.View testID="adventure-following-cursor" style={[s.cursor,follower]}>
      <Animated.View style={[{position:'absolute',left:-37*scale,top:-47*scale,width:74*scale,height:74*scale},followerPose]}>
        <Image source={ADVENTURE_PROGRESS_ART[followerVariant]} contentFit="contain" style={s.actor}/>
      </Animated.View>
    </Animated.View>}
    <Animated.View testID="adventure-digging-cursor" style={[s.cursor,cursor]}>
      {Array.from({length:6},(_,index)=><DirtParticle key={index} cycle={cycle} progress={shown} index={index} active={active&&!reduced} scale={scale}/>)}
      <Animated.View style={[{position:'absolute',left:-37*scale,top:-47*scale,width:74*scale,height:74*scale},pose]}>
        <Image source={ADVENTURE_PROGRESS_ART[leaderVariant]} contentFit="contain" style={s.actor}/>
      </Animated.View>
    </Animated.View>
  </View>;
}

const s=StyleSheet.create({
  cursor:{position:'absolute',left:0,top:0,width:0,height:0},
  actor:{width:'100%',height:'100%'},dirt:{position:'absolute',backgroundColor:'#9A542D'},
});
