import {StyleSheet,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';
import Animated,{useAnimatedProps,useAnimatedStyle,type SharedValue} from 'react-native-reanimated';
const HeartPath=Animated.createAnimatedComponent(Path);
const path='M50 89 C42 82 8 61 8 34 C8 9 38 6 50 27 C62 6 92 9 92 34 C92 61 58 82 50 89';
export function TouchHeartMeter({progress,count,size=126}:{progress:SharedValue<number>;count:number;size?:number}){
 const ring=useAnimatedProps(()=>({strokeDashoffset:64*(1-Math.max(.2,Math.min(1,progress.value)))}));
 return <View style={{width:size,height:size}}><Svg width={size} height={size} viewBox="0 0 100 100">
  <Path d={path} fill="#FE3F70" stroke="#FFD5A4" strokeWidth={8}/>
  <HeartPath d="M60 11 C81 3 98 22 95 43" fill="none" stroke="#FF4D7D" strokeWidth={6} strokeLinecap="round" strokeDasharray="64 64" animatedProps={ring}/>
 </Svg><View style={[StyleSheet.absoluteFillObject,{alignItems:'center',justifyContent:'center',paddingTop:10}]}>
 <Text style={{color:'white',fontSize:size*.24,fontWeight:'800'}}>{count}</Text></View></View>;
}
function FlyingHeart({clock,bursts,index}:{clock:SharedValue<number>;bursts:SharedValue<number[]>;index:number}){
 const style=useAnimatedStyle(()=>{
  const age=clock.value-bursts.value[index],t=Math.max(0,Math.min(1,age/1050));
  return {opacity:age<0||age>1050?0:Math.min(1,t*8,(1-t)*5),transform:[{translateX:(index%2?1:-1)*(12+index*9)*Math.sin(t*Math.PI)},
   {translateY:-210*t},{scale:1-t*.55}]};
 });
 return <Animated.Text pointerEvents="none" style={[{position:'absolute',left:'47%',top:'42%',fontSize:30,color:'#F45F85'},style]}>♥</Animated.Text>;
}
export function TouchFlyingHearts({clock,bursts,light=false}:{clock:SharedValue<number>;bursts:SharedValue<number[]>;light?:boolean}){
 return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>{Array.from({length:light?2:6},(_,index)=><FlyingHeart key={index} index={index} clock={clock} bursts={bursts}/>)}</View>;
}
