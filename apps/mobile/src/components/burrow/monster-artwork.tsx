import { View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Image as TintImage } from 'expo-image';
import { MONSTER_ART } from '@/lib/monster-images';
import { monsterArtFrame, monsterDisplayScale, type MonsterArtSurface } from '@/lib/monster-art-geometry';
import { Image, resolveBurrowImageSource } from './burrow-image';

/** Keep all battle frames decoded/mounted: a hit never changes image source.
 * White uses the very same hit silhouette and geometry, not the idle pose. */
export function MonsterArtwork({id,width:slotWidth,height:slotHeight,surface='battle',flash}:{id:string;width:number;height:number;surface?:MonsterArtSurface;flash?:SharedValue<number>}){
 const multiplier=monsterDisplayScale(id,surface),width=slotWidth*multiplier,height=slotHeight*multiplier;
 const art=MONSTER_ART[id],normalFrame=monsterArtFrame(id,'normal',width,height),hitFrame=monsterArtFrame(id,'hit',width,height);
 const normal=useAnimatedStyle(()=>({opacity:(flash?.value??0)>0?0:1}));
 const hit=useAnimatedStyle(()=>({opacity:(flash?.value??0)>0?1:0}));
 const white=useAnimatedStyle(()=>({opacity:flash?.value??0}));
 return <View pointerEvents="none" style={{width,height,overflow:'hidden'}}>
  <Animated.View style={[{position:'absolute',left:0,top:0,width,height},normal]}>
   <Image source={art.normal} contentFit="contain" style={normalFrame}/>
  </Animated.View>
  {flash&&<>
   <Animated.View style={[{position:'absolute',left:0,top:0,width,height},hit]}>
    <Image source={art.hit} contentFit="contain" style={hitFrame}/>
   </Animated.View>
   <Animated.View style={[{position:'absolute',left:0,top:0,width,height},white]}>
    {/* expo-image iOS can render ImageRef before tintColor props finish applying.
        Keep a conventional cached source here so tint is applied after props.
        This layer stays mounted; no source changes or loads on each swipe. */}
    <TintImage source={resolveBurrowImageSource(art.hit)} tintColor="#FFFFFF" contentFit="contain" cachePolicy="memory-disk" transition={0} useAppleWebpCodec={false} style={hitFrame}/>
   </Animated.View>
  </>}
 </View>;
}
