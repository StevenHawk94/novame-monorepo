import {useEffect,useRef} from 'react';
import {Animated,AppState,Easing,StyleSheet,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useReducedMotion} from 'react-native-reanimated';
import type {AffectionType} from '@novame/domain';
import {BURROW_AFFECTION_ICONS} from '@/lib/burrow-ui-assets';
import {Image} from './burrow-image';
import {AffectionHeartBurst,AFFECTION_BURST_DURATION} from './affection-heart-burst';

export const AFFECTION_SENT_SCALES=[0,1.3,1,1.2,1,1.1,1];
export function AffectionSentVisual({type}:{type:AffectionType}){
  const progress=useRef(new Animated.Value(0)).current,played=useRef(false);
  const focused=useIsFocused(),reduced=useReducedMotion();
  useEffect(()=>{
    if(reduced||played.current){progress.setValue(1);return;}
    if(!focused||AppState.currentState!=='active')return;
    played.current=true;progress.setValue(0);
    const animation=Animated.timing(progress,{toValue:1,duration:AFFECTION_BURST_DURATION,easing:Easing.linear,useNativeDriver:true});
    animation.start();
    const sub=AppState.addEventListener('change',state=>{if(state!=='active'){animation.stop();progress.setValue(1);}});
    return()=>{sub.remove();animation.stop();progress.setValue(1);};
  },[focused,reduced,progress]);
  return <View pointerEvents="none" accessible={false} style={styles.root}>
    <Animated.View style={{transform:[{scale:progress.interpolate({inputRange:[0,.26,.42,.55,.68,.79,1],outputRange:AFFECTION_SENT_SCALES})}]}}>
      <Image source={BURROW_AFFECTION_ICONS[type]} contentFit="contain" style={styles.icon}/>
    </Animated.View>
    {!reduced&&<AffectionHeartBurst progress={progress}/>}
  </View>;
}
const styles=StyleSheet.create({root:{...StyleSheet.absoluteFillObject,alignItems:'center',justifyContent:'center'},icon:{width:112,height:112}});
