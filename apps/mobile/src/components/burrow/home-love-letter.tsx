import {useEffect} from 'react';
import {Text,View} from 'react-native';
import Animated,{cancelAnimation,useAnimatedStyle,useSharedValue,withRepeat,withSequence,withTiming} from 'react-native-reanimated';
import {BURROW_FIXED_ART} from '@/lib/burrow-art-assets';
import {HOME_LETTER_PLACEMENT,homeAnchoredBox} from '@/lib/burrow-home-layout';
import {useAdventureMotion} from '@/lib/use-adventure-motion';
import {Image} from './burrow-image';

/** Anchor the badge and rotation to visible artwork, not its transparent canvas
 * or its larger touch target. Preserve the existing artwork's exact size. */
export function HomeLoveLetter({scale,count=0}:{scale:number;count?:number}){
  const {active,reduced}=useAdventureMotion(),angle=useSharedValue(0);
  const unread=Math.max(0,Math.floor(count));
  const shaking=active&&!reduced&&unread>0;
  useEffect(()=>{
    cancelAnimation(angle);angle.value=0;
    if(shaking)angle.value=withRepeat(withSequence(
      withTiming(0,{duration:480}),withTiming(-7,{duration:80}),
      withTiming(7,{duration:100}),withTiming(-5,{duration:100}),
      withTiming(5,{duration:100}),withTiming(0,{duration:140}),
    ),-1,false);
    return()=>{cancelAnimation(angle);angle.value=0;};
  },[shaking,angle]);
  const motion=useAnimatedStyle(()=>({transform:[{rotate:`${angle.value}deg`}]}));
  const asset=BURROW_FIXED_ART.letter,box=homeAnchoredBox(asset,HOME_LETTER_PLACEMENT,scale);
  const [left,top,right,bottom]=asset.bounds,ratio=box.width/asset.width;
  const diameter=34*scale;
  return <Animated.View pointerEvents="none" style={[{position:'absolute',left:box.left+left*ratio,top:box.top+top*ratio,width:(right-left)*ratio,height:(bottom-top)*ratio},motion]}>
    <Image source={asset.source} contentFit="fill" style={{position:'absolute',left:-left*ratio,top:-top*ratio,width:box.width,height:box.height}}/>
    {unread>0&&<View style={{position:'absolute',left:-diameter/2,top:-diameter/2,minWidth:diameter,height:diameter,borderRadius:diameter/2,paddingHorizontal:diameter*.12,backgroundColor:'#FF3038',alignItems:'center',justifyContent:'center'}}>
      <Text allowFontScaling={false} style={{fontSize:diameter*.65,lineHeight:diameter*.85,fontWeight:'800',color:'#FFFFFF'}}>{unread}</Text>
    </View>}
  </Animated.View>;
}
