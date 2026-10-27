import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const colors=['#E99C44','#E56D8A','#7EBC9A','#A08AC5','#F7CC62'];
function Piece({index,active}:{index:number;active:boolean}){
 const t=useSharedValue(0),angle=index*2.39996;
 useEffect(()=>{if(active)t.value=withTiming(1,{duration:1300*(1-t.value),easing:Easing.linear});return()=>cancelAnimation(t);},[t,active]);
 const style=useAnimatedStyle(()=>({opacity:t.value<.75?1:(1-t.value)*4,
  transform:[{translateX:Math.cos(angle)*(75+index%4*12)*t.value},
   {translateY:-40-(85+index%3*12)*t.value+170*t.value*t.value},{rotate:`${index*47*t.value}deg`}]}));
 return <Animated.View style={[s.piece,{backgroundColor:colors[index%colors.length],width:5+index%3,height:4+index%4},style]}/>;
}
/** Small, one-shot burst confined to the centred victory card, not the screen. */
export function ReleaseConfetti({active}:{active:boolean}){
 return <View pointerEvents="none" accessibilityElementsHidden style={[s.burst,{opacity:active?1:0}]}>
  {Array.from({length:18},(_,index)=><Piece key={index} index={index} active={active}/>)}
 </View>;
}
const s=StyleSheet.create({burst:{position:'absolute',width:260,height:190,top:'50%',marginTop:-150,alignSelf:'center',overflow:'hidden'},
 piece:{position:'absolute',left:130,top:90,borderRadius:1}});
