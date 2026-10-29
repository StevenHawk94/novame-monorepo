import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { runOnUI, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { ToyHit } from '@/lib/squishy-toy-motion';
import type { ToyMotionHandle } from '@/lib/use-squishy-toy';

function Action({kind,onRecord,handle,gesture,pressed}:{kind:ToyHit;onRecord:(revision?:number,kind?:ToyHit)=>void;handle:ToyMotionHandle;gesture:GestureType;pressed:SharedValue<boolean>}) {
  // Same visual states as Home Affection, driven by the existing native tap
  // recognizer so no React round-trip or extra recognizer delays the hit.
  const pressStyle=useAnimatedStyle(()=>({backgroundColor:pressed.value?'#F3DFBF':'#FFF2DC',
    transform:[{translateY:pressed.value?3:0},{scale:pressed.value?0.98:1}],
    shadowOffset:{width:0,height:pressed.value?0:3},shadowOpacity:pressed.value?0:1,elevation:pressed.value?0:3}));
  return <GestureDetector gesture={gesture}><Animated.View collapsable={false} accessible accessibilityRole="button"
    accessibilityLabel={kind==='squeeze'?'Squeeze plushie':'Bonk plushie'}
    onAccessibilityTap={()=>{handle.hit(kind);runOnUI(onRecord)(undefined,kind);}} style={[styles.button,pressStyle]}>
    <Text style={styles.text}>{kind==='squeeze'?'Squeeze':'Bonk'}</Text>
  </Animated.View></GestureDetector>;
}
export function SquishyToyControls({onHit,onRecord,handle,identity,bodyGesture}:{onHit:(kind:ToyHit)=>void;onRecord:(revision?:number,kind?:ToyHit)=>void;handle:ToyMotionHandle;identity:SharedValue<number>;bodyGesture:GestureType}) {
  const leftRevision=useSharedValue(0),rightRevision=useSharedValue(0);
  const leftPressed=useSharedValue(false),rightPressed=useSharedValue(false);
  const gestures=useMemo(()=>{
    const make=(kind:ToyHit,pressRevision:SharedValue<number>,pressed:SharedValue<boolean>)=>Gesture.Tap().onBegin(()=>{
      'worklet';pressed.value=true;pressRevision.value=identity.value;onHit(kind);
    }).onEnd((_event,success)=>{
      'worklet';if(success)onRecord(pressRevision.value,kind);
    }).onFinalize(()=>{'worklet';pressed.value=false;});
    const squeeze=make('squeeze',leftRevision,leftPressed),punch=make('punch',rightRevision,rightPressed);
    // A held body pull and either/both buttons may coexist; recognising a tap
    // must not cancel the other finger's drag or the other button's receipt.
    squeeze.simultaneousWithExternalGesture(punch,bodyGesture);
    punch.simultaneousWithExternalGesture(squeeze,bodyGesture);
    return {squeeze,punch};
  },[onHit,onRecord,identity,bodyGesture,leftRevision,rightRevision,leftPressed,rightPressed]);
  return <View style={styles.row}><Action kind="squeeze" gesture={gestures.squeeze} pressed={leftPressed} onRecord={onRecord} handle={handle}/>
    <Action kind="punch" gesture={gestures.punch} pressed={rightPressed} onRecord={onRecord} handle={handle}/></View>;
}
const styles=StyleSheet.create({row:{flexDirection:'row',gap:12,marginTop:24},
  button:{flex:1,minHeight:54,borderRadius:20,backgroundColor:'#FFF2DC',shadowColor:'#D8872C',shadowOpacity:1,shadowRadius:0,shadowOffset:{width:0,height:3},elevation:3,alignItems:'center',justifyContent:'center',paddingHorizontal:18},
  text:{fontSize:17,fontWeight:'800',color:'#704038',textAlign:'center'}});
