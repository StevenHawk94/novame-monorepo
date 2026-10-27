import { Skia, ClipOp, ImageFormat } from '@shopify/react-native-skia';
import { Image as NativeImage } from 'react-native';
import * as FS from 'expo-file-system/legacy';
import { SURPRISE_FRAME_OPTIONS } from './surprise-frame-assets';
import geometry from './surprise-frame-geometry.json';
import { normalizeMetroAssetUri } from './metro-asset-uri';
import { portraitPath } from './surprise-media-cache';
import { sessionEpoch } from './session-lifecycle';
import { surpriseDefaultFacePlacement } from './surprise-photo-geometry';

/** Build once before presenting. All particles share one decoded bitmap instead
 * of mounting 18 independent SVG masks/native photo loaders at playback time. */
export async function renderSurprisePortrait(frame:string,photo:string,current:()=>boolean=()=>true,destination=portraitPath(photo),defaultFace=false){
  const epoch=sessionEpoch();
  if((await FS.getInfoAsync(destination)).exists)return destination;
  const art=SURPRISE_FRAME_OPTIONS.find(row=>row.id===frame),hole=geometry[frame as keyof typeof geometry];
  if(!art||!hole)return undefined;
  const frameUri=NativeImage.resolveAssetSource(art.source)?.uri;
  if(!frameUri)return undefined;
  const [faceData,frameData]=await Promise.all([Skia.Data.fromURI(photo),Skia.Data.fromURI(normalizeMetroAssetUri(frameUri))]);
  const face=Skia.Image.MakeImageFromEncoded(faceData),border=Skia.Image.MakeImageFromEncoded(frameData);
  const surface=Skia.Surface.MakeOffscreen(512,512),clip=Skia.Path.MakeFromSVGString(hole.path);
  if(!face||!border||!surface||!clip){face?.dispose();border?.dispose();surface?.dispose();clip?.dispose();return undefined;}
  try{
    const canvas=surface.getCanvas(),paint=Skia.Paint();
    const {x,y,width,height}=defaultFace?surpriseDefaultFacePlacement(hole.bounds,hole.path):{x:hole.bounds[0],y:hole.bounds[1],width:hole.bounds[2],height:hole.bounds[3]};
    // Equivalent to SVG xMidYMid slice, including non-square cutouts.
    const ratio=Math.max(width/face.width(),height/face.height());
    const sw=width/ratio,sh=height/ratio;
    canvas.save();canvas.clipPath(clip,ClipOp.Intersect,true);
    canvas.drawImageRect(face,Skia.XYWHRect((face.width()-sw)/2,(face.height()-sh)/2,sw,sh),Skia.XYWHRect(x,y,width,height),paint);
    canvas.restore();canvas.drawImageRect(border,Skia.XYWHRect(0,0,border.width(),border.height()),Skia.XYWHRect(0,0,512,512),paint);
    surface.flush();const image=surface.makeImageSnapshot();
    try{
      if(epoch!==sessionEpoch()||!current())throw Error('session_changed');
      await FS.writeAsStringAsync(destination,image.encodeToBase64(ImageFormat.PNG,100),{encoding:FS.EncodingType.Base64});
      if(epoch!==sessionEpoch()||!current()){await FS.deleteAsync(destination,{idempotent:true});throw Error('session_changed');}
    }finally{image.dispose();paint.dispose();}
    return destination;
  }finally{face.dispose();border.dispose();clip.dispose();surface.dispose();}
}
