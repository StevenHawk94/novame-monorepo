import {StyleSheet,Text,View} from 'react-native';
import Svg,{Defs,LinearGradient,Stop,Path} from 'react-native-svg';
import Animated,{useAnimatedStyle,type SharedValue} from 'react-native-reanimated';
import {touchHeartScale,touchHeartCollectScale,touchHeartFlight} from '@/lib/touch-heart-motion';
const path='M50 91 C44 88 5 62 5 33 C5 8 32 3 50 24 C68 3 95 8 95 33 C95 62 56 88 50 91Z';
export function TouchHeartMeter({count,size=126,clock,bursts,reduced=false}:{count:number;size?:number;clock?:SharedValue<number>;bursts?:SharedValue<number[]>;reduced?:boolean}){
 const style=useAnimatedStyle(()=>({transform:[{scale:touchHeartScale(count)*(reduced||!clock||!bursts?1:touchHeartCollectScale(clock.value,bursts.value))}]}));
 return <View accessible accessibilityLabel={`${count} touches collected`} style={{width:size,height:size}}>
  <Animated.View style={[StyleSheet.absoluteFillObject,style]}>
   <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
     <LinearGradient id="touchHeartBody" x1="0%" y1="0%" x2="100%" y2="100%"><Stop offset="0" stopColor="#F64D70"/><Stop offset="1" stopColor="#EF4867"/></LinearGradient>
    </Defs>
    {/* Bounded vector penumbra: same native SVG path, no blur filter/snapshot
        or rectangular elevation shadow. The main heart covers its upper edge. */}
    <Path d={path} transform="translate(0 4)" fill="#403B30" opacity={.055} stroke="#403B30" strokeWidth={3}/>
    <Path d={path} transform="translate(0 3.4)" fill="#403B30" opacity={.085} stroke="#403B30" strokeWidth={1.5}/>
    <Path d={path} transform="translate(0 2.7)" fill="#403B30" opacity={.16}/>
    <Path d={path} fill="url(#touchHeartBody)"/>
   </Svg>
   <View style={[StyleSheet.absoluteFillObject,{alignItems:'center',justifyContent:'center'}]}><Text style={{color:'white',fontSize:size*.24,fontWeight:'800'}}>{count}</Text></View>
  </Animated.View>
 </View>;
}
function FlyingHeart({clock,bursts,index,travelY,size}:{clock:SharedValue<number>;bursts:SharedValue<number[]>;index:number;travelY:number;size:number}){
 const style=useAnimatedStyle(()=>{
  const f=touchHeartFlight(clock.value-bursts.value[index],index,travelY);
  return {opacity:f.opacity,transform:[{translateX:f.x},{translateY:f.y},{scale:f.scale}]};
 });
 return <Animated.Text pointerEvents="none" style={[{position:'absolute',left:(size-45)/2,top:size*.42-30,width:45,height:60,lineHeight:60,textAlign:'center',fontSize:45,color:'#F45F85'},style]}>♥</Animated.Text>;
}
export function TouchFlyingHearts({clock,bursts,size,travelY}:{clock:SharedValue<number>;bursts:SharedValue<number[]>;size:number;travelY:number}){
 return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>{Array.from({length:6},(_,index)=><FlyingHeart key={index} index={index} clock={clock} bursts={bursts} size={size} travelY={travelY}/>)}</View>;
}
