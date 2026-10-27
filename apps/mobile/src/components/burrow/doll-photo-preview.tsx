import {Pressable,StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
import type {BurrowArtAsset} from '@/lib/burrow-art-assets';
import type {MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import {dollFaceRect} from '@/lib/burrow-doll-face';
import {Image} from './burrow-image';
import {PlushieFaceMask} from './plushie-face-mask';

/** Photo editing only: no deformation, hearts, haptics or toy-quest callback. */
export function DollPhotoPreview({asset,photo,style,artStyle,onEditPhoto,disabled=false,label='Change doll face photo'}:{
 asset:BurrowArtAsset;photo?:MajorUpdateBootstrap['roomPhotos'][number];style:StyleProp<ViewStyle>;
 artStyle?:StyleProp<ViewStyle>;onEditPhoto?:()=>void;disabled?:boolean;label?:string;
}){
 const face=dollFaceRect(asset);
 return <View pointerEvents="box-none" style={style}>
  <View pointerEvents="box-none" style={artStyle??StyleSheet.absoluteFillObject}>
   <View pointerEvents="none" style={[face,{position:'absolute',overflow:'hidden'}]}>
    <PlushieFaceMask asset={asset} photo={photo} placeholder/>
   </View>
   <Image pointerEvents="none" source={asset.source} contentFit="fill" style={{width:'100%',height:'100%'}}/>
   {onEditPhoto&&<Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={onEditPhoto} hitSlop={8} style={[face,{position:'absolute'}]}/>}
  </View>
 </View>;
}
