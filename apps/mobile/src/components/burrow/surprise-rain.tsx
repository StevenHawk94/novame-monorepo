import { memo, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { SurprisePortrait } from './surprise-art';
import { useSurprisePreview } from '@/lib/surprise-preview';

function FallingFace({index,width,height,frame,uri,playing,count,portraitUri}:{index:number;width:number;height:number;frame:string;uri?:string;playing:boolean;count:number;portraitUri?:string}) {
  const phase=useRef((index*17%count)/count).current;
  const progress=useRef(new Animated.Value(phase)).current;
  const resume=useRef(phase);
  // One shared motion profile for head-tap, recorded preview and received rain.
  // Keep the previous 20% reduction, then slow the current speed another 30%.
  // Speed reductions increase the travel duration by the reciprocal factor.
  const size=width*(.17+(index*31%65)/650), duration=(1400+(index*47%400))/.8/.7;
  useEffect(()=>{
    if(!playing)return;
    // Spread the first wave across the viewport immediately, then recycle at the top.
    // A stopped preview remains a composed rain scene over its real underlay.
    const start=resume.current;progress.setValue(start);
    const fall=(time:number)=>Animated.timing(progress,{toValue:1,duration:time,easing:Easing.linear,useNativeDriver:true,isInteraction:false});
    const first=fall(duration*(1-start));let live=true;let loop:Animated.CompositeAnimation|undefined;
    first.start(({finished})=>{
      if(!live||!finished)return;
      progress.setValue(0);
      // A loop of a single native timing runs wholly on the native thread.
      // Looping Animated.sequence would require JS callbacks on every cycle.
      loop=Animated.loop(fall(duration));loop.start();
    });
    return()=>{live=false;first.stop();loop?.stop();progress.stopAnimation(value=>{resume.current=value;});};
  },[playing,width,height]);
  const x=(index*.61803398875%1)*(width+size)-size*.7;
  return <Animated.View pointerEvents="none" renderToHardwareTextureAndroid shouldRasterizeIOS style={{position:'absolute',left:x,top:-size,opacity:.95,
    transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[0,height+size*2]})},
      {translateX:progress.interpolate({inputRange:[0,.5,1],outputRange:[-10,16,-5]})},
      {rotate:progress.interpolate({inputRange:[0,1],outputRange:[`${index%2?-20:15}deg`,`${index%2?25:-15}deg`]})}]}}>
    <SurprisePortrait frame={frame} uri={uri} portraitUri={portraitUri} size={size}/>
  </Animated.View>;
}
/** Fixed-size recycled native animations: particle count never grows with audio length. */
export const SurpriseRain=memo(function SurpriseRain({frame,uri,playing,portraitUri}:{frame:string;uri?:string;playing:boolean;transparent?:boolean;portraitUri?:string}) {
  const portrait=useSurprisePreview(frame,uri,portraitUri);
  const [area,setArea]=useState({width:0,height:0});const [reduce,setReduce]=useState(false);
  useEffect(()=>{let live=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(live)setReduce(value);});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduce);return()=>{live=false;sub.remove();};},[]);
  const count=18;
  return <View pointerEvents="none" style={s.root} onLayout={event=>setArea({width:event.nativeEvent.layout.width,height:event.nativeEvent.layout.height})}>
    {Array.from({length:20},(_,i)=><View key={`spark${i}`} style={[s.spark,{left:`${i*37%100}%`,top:`${i*23%100}%`,height:10+i%4*8,opacity:.12+i%3*.1}]}/>)}
    {portrait&&(reduce?<View style={s.still}><SurprisePortrait frame={frame} uri={uri} portraitUri={portrait} size={230}/></View>
      :area.width>0&&Array.from({length:count},(_,index)=><FallingFace key={index} index={index} count={count} {...area} frame={frame} uri={uri} portraitUri={portrait} playing={playing}/>))}
  </View>;
});
const s=StyleSheet.create({root:{...StyleSheet.absoluteFillObject,backgroundColor:'transparent',overflow:'hidden'},spark:{position:'absolute',width:2,borderRadius:2,backgroundColor:'#EABC86'},still:{flex:1,justifyContent:'center',alignItems:'center'}});
