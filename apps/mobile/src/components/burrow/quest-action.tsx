import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useAdventureMotion } from '@/lib/use-adventure-motion';

/** The card owns the touch target and claim lock. Only the visual button moves,
 * so a reminder never moves the hit area or competes with vertical scrolling. */
export function QuestAction({ready,arrow=false,pressed=false,disabled=false}:{ready:boolean;arrow?:boolean;pressed?:boolean;disabled?:boolean}) {
  const {active,reduced}=useAdventureMotion();
  const offset=useSharedValue(0),depth=useSharedValue(0);
  const shaking=ready&&!disabled&&!pressed&&active&&!reduced;
  useEffect(()=>{
    cancelAnimation(offset);offset.value=0;
    if(shaking)offset.value=withRepeat(withSequence(
      withTiming(0,{duration:1100}),withTiming(-3,{duration:70}),
      withTiming(3,{duration:90}),withTiming(-2,{duration:90}),
      withTiming(2,{duration:90}),withTiming(0,{duration:110}),
    ),-1,false);
    return()=>cancelAnimation(offset);
  },[offset,shaking]);
  useEffect(()=>{
    depth.value=withTiming(pressed&&!disabled?4:0,{duration:80,reduceMotion:ReduceMotion.System});
    return()=>cancelAnimation(depth);
  },[depth,pressed,disabled]);
  const reminder=useAnimatedStyle(()=>({transform:[{translateX:offset.value}]}));
  const press=useAnimatedStyle(()=>({transform:[{translateY:depth.value}]}));
  return <Animated.View pointerEvents="none" accessible={false} testID="quest-action" style={[s.button,arrow&&s.arrow,reminder]}>
    <LinearGradient colors={ready?['#B95428','#A54720']:['#DAD7D1','#C5C1BA']} style={[s.layer,s.base]}/>
    <Animated.View style={[s.layer,s.face,press]}>
      <LinearGradient colors={ready?['#E37D42','#CF602D']:['#F2F0EC','#E8E5DF']} style={StyleSheet.absoluteFillObject}/>
      <Text style={[s.label,!ready&&s.inactive,arrow&&s.arrowLabel]}>{arrow?'➜':'Claim'}</Text>
    </Animated.View>
  </Animated.View>;
}

const s=StyleSheet.create({
  button:{width:76,height:46,flexShrink:0},arrow:{width:48},
  layer:{position:'absolute',left:0,right:0,height:42,borderRadius:14},
  base:{top:4,shadowColor:'#44210E',shadowOffset:{width:0,height:2},shadowOpacity:.14,shadowRadius:2,elevation:2},
  face:{top:0,overflow:'hidden',alignItems:'center',justifyContent:'center'},
  label:{color:'#FFFFFF',fontSize:14,fontWeight:'800'},inactive:{color:'#85837E'},
  arrowLabel:{fontSize:27,lineHeight:32},
});
