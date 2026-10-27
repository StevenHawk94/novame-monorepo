import { StyleSheet, View } from 'react-native';
import type { MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { burrowArtFor, burrowArtForItem, HOME_BACKGROUND_FLOOR } from '@/lib/burrow-art-assets';
import { plushieFloorBox } from '@/lib/plushie-room-layout';
import { Image } from './burrow-image';

export function PlushieRoomBackground({wallpaper,width,height,floorY,bottomInset}:{
  wallpaper?:MajorUpdateCatalogItem;width:number;height:number;floorY:number;bottomInset:number;
}){
  const paper=burrowArtForItem(wallpaper,'wallpapers')??burrowArtFor('wallpapers');
  const floor=plushieFloorBox(width,height,floorY,HOME_BACKGROUND_FLOOR);
  return <View testID="plushie-room-background" pointerEvents="none" style={[StyleSheet.absoluteFillObject,{bottom:-bottomInset,overflow:'hidden',backgroundColor:'#EAD9B7'}]}>
    <Image testID="plushie-room-wallpaper" source={paper?.source} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject}/>
    <View style={{position:'absolute',left:0,right:0,top:floor.seam,bottom:0,backgroundColor:'#7C442F'}}/>
    <Image testID="plushie-room-floor" source={HOME_BACKGROUND_FLOOR.source} contentFit="fill"
      style={{position:'absolute',left:floor.left,top:floor.top,width:floor.width,height:floor.height}}/>
  </View>;
}
