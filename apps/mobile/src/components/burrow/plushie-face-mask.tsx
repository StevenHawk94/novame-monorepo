import {useId} from 'react';
import Svg,{ClipPath,Defs,G,Image as SvgImage,Path,Rect,SvgXml} from 'react-native-svg';
import type {BurrowArtAsset} from '@/lib/burrow-art-assets';
import {plushieFaceMask} from '@/lib/plushie-face-mask';
import {useRoomPhotoResource} from '@/lib/use-room-photo-uri';
import {roomPhotoPlaceholderSvg} from '@/lib/room-photo-placeholder-art';

const camera=roomPhotoPlaceholderSvg('doll');
/** Vector/image children ONLY. ForeignObject mutates UIKit child.hidden and
 * poisons Fabric's shared recycle pool; ordinary React views are forbidden. */
export function PlushieFaceMask({asset,photo,sourceUri,placeholder=false,backgroundColor='#FFF2DC',width,height,imageRect}:{
 asset:BurrowArtAsset;photo?:{id:string;updatedAt:string};sourceUri?:string;placeholder?:boolean;backgroundColor?:string;
 width?:number;height?:number;imageRect?:{x:number;y:number;width:number;height:number};
}){
 const id='plushieFace'+useId().replace(/:/g,''),mask=plushieFaceMask(asset);
 const resource=useRoomPhotoResource(photo),uri=sourceUri??resource.uri;
 const bounds=asset.photoBounds??[0,0,asset.width,asset.height];
 const w=width??mask?.width??bounds[2]-bounds[0],h=height??mask?.height??bounds[3]-bounds[1];
 return <Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
  <Defs><ClipPath id={id}>{mask?<Path d={mask.path} transform={`scale(${w/mask.width} ${h/mask.height})`}/>:<Rect width={w} height={h}/>}</ClipPath></Defs>
  <G clipPath={`url(#${id})`}>
   <Rect width={w} height={h} fill={backgroundColor}/>
   {!uri&&placeholder&&<SvgXml xml={camera} width={w} height={h}/>}
   {uri&&<SvgImage key={uri} href={{uri}} x={imageRect?.x??0} y={imageRect?.y??0}
    width={imageRect?.width??w} height={imageRect?.height??h} preserveAspectRatio={imageRect?'none':'xMidYMid slice'}/>}
  </G>
 </Svg>;
}
