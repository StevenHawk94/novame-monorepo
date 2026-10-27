import {useMemo} from 'react';
import {Platform,TurboModuleRegistry,View,type StyleProp,type ViewStyle} from 'react-native';
import {GestureDetector} from 'react-native-gesture-handler';
import type {SharedValue,FrameInfo} from 'react-native-reanimated';
import type {TouchEvent,TouchQuality} from '@novame/domain';
import type {BurrowArtAsset} from '@/lib/burrow-art-assets';
import type {MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import {useSquishyToy} from '@/lib/use-squishy-toy';
import type {ToyMotion} from '@/lib/squishy-toy-motion';
import {dollFaceBounds} from '@/lib/burrow-doll-face';
import {NativeDollSurface} from './interactive-doll';
import {DollPhotoPreview} from './doll-photo-preview';
import {SquishyToyControls} from './squishy-toy-controls';
import type {LocalizedToy as FullToy} from './localized-toy';
let Full:typeof FullToy|null=null;
if(Platform.OS==='web'||(globalThis as {SkiaApi?:unknown}).SkiaApi||TurboModuleRegistry.get('RNSkiaModule')){
 try{Full=require('./localized-toy').LocalizedToy;}catch{}
}
export type TouchToyProps={asset:BurrowArtAsset;photo?:MajorUpdateBootstrap['roomPhotos'][number];size:number;quality:TouchQuality;
 scope:string;recording?:boolean;onInput?:(batch:TouchEvent[])=>void;inputStart?:SharedValue<number>;inputOffset?:SharedValue<number>;
 actionsStyle?:StyleProp<ViewStyle>;containerStyle?:StyleProp<ViewStyle>;onFrame?:(motion:ToyMotion,frame:FrameInfo)=>void|boolean;frameEnabled?:SharedValue<boolean>};
const noop=()=>{};
export function PlushieTouchToy(p:TouchToyProps){
 const scale=Math.min(p.size/p.asset.width,p.size/p.asset.height),artStyle={position:'absolute' as const,
  left:(p.size-p.asset.width*scale)/2,top:(p.size-p.asset.height*scale)/2,width:p.asset.width*scale,height:p.asset.height*scale};
 if(p.quality==='light'&&!p.recording&&!p.onFrame)return <DollPhotoPreview asset={p.asset} photo={p.photo} artStyle={artStyle} style={{width:p.size,height:p.size}}/>;
 if(p.quality==='full'&&Full)return <Full asset={p.asset} photo={p.photo} size={p.size} artStyle={artStyle} onInteract={noop}
  quality="full" readOnly={!p.recording} showActions={p.recording} onInput={p.onInput} inputStart={p.inputStart} inputOffset={p.inputOffset} onFrame={p.onFrame} frameEnabled={p.frameEnabled} actionsStyle={p.actionsStyle} containerStyle={p.containerStyle}
  interactionScope={p.scope} hideHearts retainTexture={false}/>;
 return <NativeTouchToy {...p} artStyle={artStyle}/>;
}
function NativeTouchToy(p:TouchToyProps&{artStyle:{left:number;top:number;width:number;height:number;position:'absolute'}}){
 const scale=p.artStyle.width/p.asset.width,face=dollFaceBounds(p.asset);
 const geometry=useMemo(()=>({baseX:(p.asset.bounds[0]+p.asset.bounds[2])/2,baseY:p.asset.bounds[3],headX:(face[0]+face[2])/2,headTop:p.asset.bounds[1],
  headWidth:face[2]-face[0],scale,bounds:[...p.asset.bounds]}),[p.asset,scale]);
 const c=useSquishyToy({geometry,left:p.artStyle.left,top:p.artStyle.top,onFrame:p.onFrame,frameEnabled:p.frameEnabled,onInput:p.onInput,inputStart:p.inputStart,inputOffset:p.inputOffset,
  interactionScope:p.scope,readOnly:!p.recording});
 return <View style={p.containerStyle}><GestureDetector gesture={c.gesture}><View collapsable={false} style={{width:p.size,height:p.size,alignSelf:'center'}}>
  {p.quality==='light'?<DollPhotoPreview asset={p.asset} photo={p.photo} artStyle={p.artStyle} style={{width:p.size,height:p.size}}/>
   :<NativeDollSurface asset={p.asset} photo={p.photo} artStyle={p.artStyle} state={c.state}/>}
 </View></GestureDetector>
 {p.recording&&<View style={p.actionsStyle}><SquishyToyControls handle={c.handle} onHit={c.performHit} onRecord={c.record} identity={c.identity} bodyGesture={c.gesture}/></View>}</View>;
}
