import { cancelAnimation, ReduceMotion, type SharedValue, withSequence, withTiming } from 'react-native-reanimated';

/** Restart the whole impact on the UI thread, including rapid return swipes.
 * A real rise/hold/fall sequence guarantees a visible peak: assigning 1 and
 * immediately animating to 0 from JS can coalesce before a frame is painted. */
export function playMonsterImpact(shake:SharedValue<number>,flash:SharedValue<number>){
 'worklet';
 cancelAnimation(shake);cancelAnimation(flash);
 shake.value=0;flash.value=0;
 shake.value=withSequence(
  withTiming(-8,{duration:24}),withTiming(8,{duration:34}),
  withTiming(-5,{duration:28}),withTiming(4,{duration:26}),withTiming(0,{duration:30}),
 );
 // A short hit highlight, not a strobe. Keep this feedback visible even when
 // system Reduce Motion removes the positional shake animation.
 flash.value=withSequence(ReduceMotion.Never,
  withTiming(1,{duration:24,reduceMotion:ReduceMotion.Never}),
  withTiming(1,{duration:36,reduceMotion:ReduceMotion.Never}),
  withTiming(0,{duration:110,reduceMotion:ReduceMotion.Never}),
 );
}

export function resetMonsterImpact(shake:SharedValue<number>,flash:SharedValue<number>){
 'worklet';
 cancelAnimation(shake);cancelAnimation(flash);shake.value=0;flash.value=0;
}
