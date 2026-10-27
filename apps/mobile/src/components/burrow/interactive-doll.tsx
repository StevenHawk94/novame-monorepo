import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { Image } from './burrow-image';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { dollFaceBounds, dollFaceRect } from '@/lib/burrow-doll-face';
import { toyAxes, type ToyMotion } from '@/lib/squishy-toy-motion';
import { useSquishyToy, type ToyMotionHandle } from '@/lib/use-squishy-toy';
import { SquishyToyControls } from './squishy-toy-controls';
import {PlushieFaceMask} from './plushie-face-mask';

type DollPhoto=MajorUpdateBootstrap['roomPhotos'][number]|undefined;
export type DollAction={kind:'squeeze'|'punch';token:number};

/** Same controller on binaries without Skia; only local warping is degraded. */
export function NativeDollSurface({asset,photo,artStyle,state,padding=0,showEmptyPhotoDecoration=false}:{
  asset:BurrowArtAsset;photo?:DollPhoto;artStyle:StyleProp<ViewStyle>;state:SharedValue<ToyMotion>;
  padding?:number;showEmptyPhotoDecoration?:boolean;
}) {
  const flat=StyleSheet.flatten(artStyle),width=typeof flat?.width==='number'?flat.width:300;
  const height=typeof flat?.height==='number'?flat.height:width*asset.height/asset.width,scale=width/asset.width;
  const motion=useAnimatedStyle(()=>{
    const value=state.value,axes=toyAxes(value);
    const dx=value.pulls.reduce((sum,p)=>sum+p.dx.x,0)*scale*.25;
    const dy=value.pulls.reduce((sum,p)=>sum+p.dy.x,0)*scale*.25;
    return {transform:[{translateX:dx+(1-axes.x)*((value.geometry.baseX-padding)*scale-width/2)},
      {translateY:dy+(1-axes.y)*((value.geometry.baseY-padding)*scale-height/2)},
      {scaleX:axes.x},{scaleY:axes.y}]};
  });
  return <Animated.View pointerEvents="none" style={[artStyle,motion]}>
    <View style={[styles.photo,dollFaceRect(asset)]}><PlushieFaceMask asset={asset} photo={photo} placeholder={showEmptyPhotoDecoration}/></View>
    <Image source={asset.source} contentFit="fill" style={styles.fill}/>
    {photo&&<View style={[styles.photo,dollFaceRect(asset)]}><PlushieFaceMask asset={asset} photo={photo} edgeOnly/></View>}
  </Animated.View>;
}

export function InteractiveDoll({asset,photo,style,artStyle,onInteract,action,disabled=false,showEmptyPhotoDecoration=false,onControllerReady,showActions=false,interactionScope,fillStage=false,onStageLayout,actionsStyle,containerStyle}:{
  asset:BurrowArtAsset;photo?:DollPhoto;style:StyleProp<ViewStyle>;artStyle:StyleProp<ViewStyle>;
  onInteract?:()=>void;onEditPhoto?:()=>void;action?:DollAction;pulse?:number;disabled?:boolean;showEmptyPhotoDecoration?:boolean;
  onControllerReady?:(handle:ToyMotionHandle|null)=>void;
  showActions?:boolean;
  fillStage?:boolean;
  onStageLayout?:(height:number)=>void;
  interactionScope?:string;
  actionsStyle?:StyleProp<ViewStyle>;containerStyle?:StyleProp<ViewStyle>;
}) {
  const flat=StyleSheet.flatten(artStyle),width=typeof flat?.width==='number'?flat.width:300,scale=width/asset.width;
  const left=typeof flat?.left==='number'?flat.left:0,top=typeof flat?.top==='number'?flat.top:0;
  const face=dollFaceBounds(asset);
  const geometry=useMemo(()=>({baseX:(asset.bounds[0]+asset.bounds[2])/2,baseY:asset.bounds[3],
    headX:(face[0]+face[2])/2,headTop:asset.bounds[1],
    headWidth:face[2]-face[0],scale,bounds:[...asset.bounds]}),[asset.bounds[0],asset.bounds[1],asset.bounds[2],asset.bounds[3],scale,face[0],face[2]]);
  const {state,gesture,handle,performHit,record,identity}=useSquishyToy({geometry,left,top,disabled,onInteract,action,onControllerReady,interactionScope});
  const stage=<GestureDetector gesture={gesture}><View collapsable={false} style={style} accessibilityRole="button"
    accessibilityLabel="Play with our dolls" accessibilityHint="Tap or drag to make the toy spring back.">
    <NativeDollSurface asset={asset} photo={photo} artStyle={artStyle} state={state} showEmptyPhotoDecoration={showEmptyPhotoDecoration}/>
  </View></GestureDetector>;
  const controls=showActions&&!disabled?<SquishyToyControls onHit={performHit} onRecord={record} handle={handle} identity={identity} bodyGesture={gesture}/>:null;
  if(fillStage)return <View style={{flex:1}}><View testID="plushie-centered-stage" onLayout={event=>onStageLayout?.(event.nativeEvent.layout.height)} style={{flex:1,justifyContent:'center'}}>{stage}</View>{controls}</View>;
  return controls||containerStyle?<View style={containerStyle}>{stage}{actionsStyle?<View style={actionsStyle}>{controls}</View>:controls}</View>:stage;
}
const styles=StyleSheet.create({fill:{width:'100%',height:'100%'},photo:{position:'absolute',overflow:'hidden'}});
