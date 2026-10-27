import type { ScrollViewProps } from 'react-native';
import Animated, { scrollTo, useAnimatedRef, useAnimatedScrollHandler } from 'react-native-reanimated';

/** Only the map opts in. Keep bottom rubber-banding native; clamp negative
 * top offsets synchronously on the UI thread, including drag/deceleration.
 * No React state, JS scroll callback, timer or replacement spring is involved. */
export function BurrowMapScrollView(props:ScrollViewProps) {
  const ref=useAnimatedRef<Animated.ScrollView>();
  const constrainTop=(event:{contentOffset:{x:number;y:number}})=>{
    'worklet';
    if(event.contentOffset.y<0)scrollTo(ref,event.contentOffset.x,0,false);
  };
  const onScroll=useAnimatedScrollHandler({
    onScroll:constrainTop,onEndDrag:constrainTop,onMomentumEnd:constrainTop,
  });
  return <Animated.ScrollView {...props} ref={ref} horizontal={false}
    bounces alwaysBounceVertical alwaysBounceHorizontal={false}
    contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
    contentInset={{top:0,bottom:0,left:0,right:0}} refreshControl={undefined}
    scrollEventThrottle={16} onScroll={onScroll}/>;
}
