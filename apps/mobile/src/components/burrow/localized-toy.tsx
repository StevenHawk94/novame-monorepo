import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, ClipOp, Fill, Group, ImageShader, Path, Shader, Skia, useImage, type SkImage } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, type SharedValue,type FrameInfo } from 'react-native-reanimated';
import type {TouchQuality,TouchEvent} from '@novame/domain';
import { resolveBurrowImageSource } from './burrow-image';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { dollFaceBounds } from '@/lib/burrow-doll-face';
import { subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { TOY_TEXTURE_PADDING, TOY_WARP_SKSL } from '@/lib/burrow-toy-warp';
import { toyShaderUniforms, type ToyMotion } from '@/lib/squishy-toy-motion';
import { useSquishyToy, type ToyMotionHandle } from '@/lib/use-squishy-toy';
import { useRoomPhotoUri } from '@/lib/use-room-photo-uri';
import { NativeDollSurface, type DollAction } from './interactive-doll';
import { SquishyToyControls } from './squishy-toy-controls';
import {plushieFaceMask} from '@/lib/plushie-face-mask';

type DollPhoto=MajorUpdateBootstrap['roomPhotos'][number]|undefined;
type Texture={key:string;image:SkImage};
const textureCache=new Map<string,SkImage>();
subscribeSessionIdentity(()=>{textureCache.clear();});
const warpEffect=Skia.RuntimeEffect.Make(TOY_WARP_SKSL);
const heartPath=Skia.Path.MakeFromSVGString('M12 21 C10 19 0 12 0 6 C0 -1 9 -2 12 4 C15 -2 24 -1 24 6 C24 12 14 19 12 21 Z');

function composeTexture(costume:SkImage,face:SkImage|null,asset:BurrowArtAsset,padding:number):SkImage|null {
  try {
    const width=asset.width+padding*2,height=asset.height+padding*2;
    const resolution=Math.min(1,1024/Math.max(width,height));
    // Compose once on a bounded CPU surface. No live-view/Metal readback is
    // needed, including while a native-stack transition destroys the drawable.
    const surface=Skia.Surface.Make(Math.ceil(width*resolution),Math.ceil(height*resolution));
    if(!surface)return null;
    const canvas=surface.getCanvas();canvas.clear(Skia.Color('transparent'));canvas.scale(resolution,resolution);
    if(face) {
      const [left,top,right,bottom]=dollFaceBounds(asset),aspect=(right-left)/(bottom-top);
      const mask=plushieFaceMask(asset),clip=mask?Skia.Path.MakeFromSVGString(mask.path):null;
      canvas.save();
      if(clip){clip.offset(padding+left,padding+top);canvas.clipPath(clip,ClipOp.Intersect,true);}
      const sourceWidth=Math.min(face.width(),face.height()*aspect),sourceHeight=sourceWidth/aspect;
      canvas.drawImageRect(face,{x:(face.width()-sourceWidth)/2,y:(face.height()-sourceHeight)/2,width:sourceWidth,height:sourceHeight},
        {x:padding+left,y:padding+top,width:right-left,height:bottom-top},Skia.Paint());
      canvas.restore();
    }
    canvas.drawImage(costume,padding,padding);surface.flush();
    // One composition per photo revision, not per touch / React render.
    return surface.makeImageSnapshot().makeNonTextureImage();
  }catch{return null;}
}

function ToyHeart({state,index,scale}:{state:SharedValue<ToyMotion>;index:number;scale:number}) {
  const opacity=useDerivedValue(()=>{
    const p=state.value.particles[index],t=p.age/p.life;
    return t<0||t>=1?0:Math.min(1,t*8,(1-t)*4);
  });
  const transform=useDerivedValue(()=>{
    const p=state.value.particles[index],t=Math.max(0,Math.min(1,p.age/p.life));
    return [{translateX:(p.x+p.dx*t)*scale},{translateY:(p.y+p.dy*t)*scale},{scale:scale*(1.2+.4*Math.sin(t*Math.PI))}];
  });
  return heartPath?<Group opacity={opacity} transform={transform}><Path path={heartPath} color="#F16A82"/></Group>:null;
}

function ToyCanvas({state,texture,left,top,width,height,scale,onLayout}:{
  state:SharedValue<ToyMotion>;texture:SkImage;
  left:number;top:number;width:number;height:number;scale:number;
  onLayout:()=>void;
}) {
  const uniforms=useDerivedValue(()=>toyShaderUniforms(state.value,scale));
  // The layout is already known. Skia 2.2's onSize mapper dereferences a null
  // native view after dismissal; neither onSize nor snapshot polling is needed
  // to render an already decoded, composed texture at these fixed dimensions.
  return <View pointerEvents="none" onLayout={onLayout} style={{position:'absolute',left,top,width,height}}>
      <Canvas style={{width,height}}>
        <Fill><Shader source={warpEffect!} uniforms={uniforms}><ImageShader image={texture} fit="fill" rect={{x:0,y:0,width,height}}/></Shader></Fill>
      </Canvas>
    </View>;
}

/** Particles must not share the costume's bounded shader viewport. Extending
 * this cheap transparent layer preserves the body texture/warp dimensions and
 * lets the complete two-second flight pass above the instruction text. */
function ToyHeartLayer({state,left,top,width,height,scale}:{
  state:SharedValue<ToyMotion>;left:number;top:number;width:number;height:number;scale:number;
}){
  const rise=Math.ceil(240*scale);
  return <View testID="plushie-heart-overlay" pointerEvents="none" style={{position:'absolute',left,top:top-rise,width,height:height+rise,zIndex:2}}>
    <Canvas style={{width,height:height+rise}}>
      <Group transform={[{translateY:rise}]}>
        {Array.from({length:12},(_,index)=><ToyHeart key={index} state={state} index={index} scale={scale}/>)}
      </Group>
    </Canvas>
  </View>;
}

export function LocalizedToy({asset,photo,size,artStyle,action,onInteract,onControllerReady,showActions=false,interactionScope,fillStage=false,onStageLayout,
 quality='full',onInput,inputStart,inputOffset,onFrame,frameEnabled,readOnly=false,hideHearts=false,retainTexture=true,actionsStyle,containerStyle}:{
  asset:BurrowArtAsset;photo?:DollPhoto;size:number;artStyle:StyleProp<ViewStyle>;action?:DollAction;
  onInteract:()=>void;onControllerReady?:(handle:ToyMotionHandle|null)=>void;
  showActions?:boolean;
  fillStage?:boolean;
  onStageLayout?:(height:number)=>void;
  interactionScope?:string;
  quality?:TouchQuality;onInput?:(batch:TouchEvent[])=>void;inputStart?:SharedValue<number>;
  inputOffset?:SharedValue<number>;actionsStyle?:StyleProp<ViewStyle>;containerStyle?:StyleProp<ViewStyle>;
  onFrame?:(motion:ToyMotion,frame:FrameInfo)=>void|boolean;readOnly?:boolean;hideHearts?:boolean;retainTexture?:boolean;
  frameEnabled?:SharedValue<boolean>;
}) {
  const photoUri=useRoomPhotoUri(photo),costumeSource=resolveBurrowImageSource(asset.source);
  const costume=useImage(quality!=='full'?null:typeof costumeSource==='number'?costumeSource:
    costumeSource&&typeof costumeSource==='object'&&'uri' in costumeSource?costumeSource.uri:null);
  const face=useImage(quality==='full'?photoUri:null),faceBounds=dollFaceBounds(asset);
  const padding=Math.max(TOY_TEXTURE_PADDING,Math.ceil(asset.height*.18+(faceBounds[2]-faceBounds[0])*.18));
  const key=`squishy-v4-face-mask:${JSON.stringify(asset.source)}:${asset.width}:${asset.height}:${padding}:${photo?.id??'empty'}:${photo?.updatedAt??''}`;
  const [texture,setTexture]=useState<Texture|null>(()=>{
    const image=retainTexture?textureCache.get(key):null;return image?{key,image}:null;
  });
  const readyTexture=texture?.key===key?texture.image:retainTexture?textureCache.get(key)??null:null;
  const [paintedKey,setPaintedKey]=useState<string|null>(null);
  const paint=useRef<{key:string;live:boolean;frame:number|null}>({key,live:true,frame:null});
  // A composed/cached texture is not a painted native Canvas. Keep the
  // predecoded image underneath through native layout and two paint frames;
  // replacing the native view as soon as useImage resolves exposed a blank.
  paint.current.key=key;
  useLayoutEffect(()=>{
    paint.current.live=true;
    return()=>{paint.current.live=false;if(paint.current.frame!==null)cancelAnimationFrame(paint.current.frame);};
  },[key]);
  const onCanvasLayout=useCallback(()=>{
    if(!paint.current.live||paint.current.key!==key)return;
    if(paint.current.frame!==null)cancelAnimationFrame(paint.current.frame);
    paint.current.frame=requestAnimationFrame(()=>{
      paint.current.frame=requestAnimationFrame(()=>{
        paint.current.frame=null;
        if(paint.current.live&&paint.current.key===key)setPaintedKey(key);
      });
    });
  },[key]);
  const [unavailableKey,setUnavailableKey]=useState<string|null>(null);
  const warpUnavailable=quality!=='full'||!warpEffect||unavailableKey===key;
  const flattened=StyleSheet.flatten(artStyle);
  const artLeft=typeof flattened?.left==='number'?flattened.left:0,artTop=typeof flattened?.top==='number'?flattened.top:0;
  const artWidth=typeof flattened?.width==='number'?flattened.width:size,scale=artWidth/asset.width;
  const canvasLeft=artLeft-padding*scale,canvasTop=artTop-padding*scale;
  const canvasWidth=(asset.width+padding*2)*scale,canvasHeight=(asset.height+padding*2)*scale;
  const geometry=useMemo(()=>({baseX:padding+(asset.bounds[0]+asset.bounds[2])/2,baseY:padding+asset.bounds[3],
    headX:padding+(faceBounds[0]+faceBounds[2])/2,headTop:padding+asset.bounds[1],
    headWidth:faceBounds[2]-faceBounds[0],scale,bounds:asset.bounds.map(n=>n+padding)}),
    [asset.bounds[0],asset.bounds[1],asset.bounds[2],asset.bounds[3],padding,scale,faceBounds[0],faceBounds[2]]);
  const {state,gesture,handle,performHit,record,identity}=useSquishyToy({geometry,left:canvasLeft,top:canvasTop,onInteract,onControllerReady,action,interactionScope,onInput,inputStart,inputOffset,onFrame,frameEnabled,readOnly});

  useEffect(()=>{
    if(quality!=='full'){setTexture(null);return;}
    const cached=retainTexture?textureCache.get(key):null;if(cached){setTexture({key,image:cached});return;}
    if(!costume||(photo&&!face))return;
    const composite=composeTexture(costume,photo?face:null,asset,padding);
    if(!composite){setUnavailableKey(key);return;}
    if(retainTexture)textureCache.set(key,composite);
    if(textureCache.size>4){const old=textureCache.keys().next().value!;textureCache.delete(old);}
    setTexture({key,image:composite});
  },[key,costume,face,asset,padding,!!photo,quality,retainTexture]);

  const stage=<GestureDetector gesture={gesture}><View collapsable={false} style={{width:size,height:size,alignSelf:'center',overflow:'visible'}}>
    {(warpUnavailable||!readyTexture||paintedKey!==key)&&<NativeDollSurface asset={asset} photo={photo} artStyle={artStyle} state={state} padding={padding}/>}
    {!warpUnavailable&&readyTexture&&<ToyCanvas key={key} state={state} texture={readyTexture}
      left={canvasLeft} top={canvasTop} width={canvasWidth} height={canvasHeight} scale={scale} onLayout={onCanvasLayout}/>}
    {!hideHearts&&<ToyHeartLayer state={state} left={canvasLeft} top={canvasTop} width={canvasWidth} height={canvasHeight} scale={scale}/>}
  </View></GestureDetector>;
  return <View style={containerStyle?[fillStage?{flex:1,overflow:'visible' as const}:undefined,containerStyle]:fillStage?{flex:1,overflow:'visible'}:undefined}>{fillStage?<View testID="plushie-centered-stage" onLayout={event=>onStageLayout?.(event.nativeEvent.layout.height)} style={{flex:1,justifyContent:'center',overflow:'visible'}}>{stage}</View>:stage}
    {showActions&&(actionsStyle?<View style={actionsStyle}><SquishyToyControls onHit={performHit} onRecord={record} handle={handle} identity={identity} bodyGesture={gesture}/></View>:
     <SquishyToyControls onHit={performHit} onRecord={record} handle={handle} identity={identity} bodyGesture={gesture}/>)}</View>;
}
