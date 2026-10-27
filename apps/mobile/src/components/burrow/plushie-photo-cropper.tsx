import {useEffect,useMemo,useRef,useState} from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Image} from './burrow-image';
import type {BurrowArtAsset} from '@/lib/burrow-art-assets';
import {dollFaceBounds} from '@/lib/burrow-doll-face';
import {positionedDollCrop,type PhotoCrop} from '@/lib/room-photo-crop';
import {PlushieFaceMask} from './plushie-face-mask';

export function PlushiePhotoCropper({asset,toy,onCancel,onConfirm}:{asset:{uri:string;width:number;height:number};toy:BurrowArtAsset;onCancel:()=>void;onConfirm:(crop:PhotoCrop)=>Promise<void>}){
 const window=useWindowDimensions(),insets=useSafeAreaInsets(),width=Math.min(390,window.width-64),height=Math.max(100,Math.min(width*1.45,window.height-insets.top-insets.bottom-360));
 const scale=Math.min(width/toy.width,height/toy.height),art={left:(width-toy.width*scale)/2,top:(height-toy.height*scale)/2,width:toy.width*scale,height:toy.height*scale};
 const [l,t,r,b]=dollFaceBounds(toy),face={left:art.left+l*scale,top:art.top+t*scale,width:(r-l)*scale,height:(b-t)*scale};
 const side=Math.max(face.width,face.height),[zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0});
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const geometry=positionedDollCrop(asset.width,asset.height,side,zoom,offset.x,offset.y),live=useRef({geometry,zoom});live.current={geometry,zoom};
 const start=useRef({x:0,y:0,zoom:1,distance:0});
 const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>!lock.current,onMoveShouldSetPanResponder:()=>!lock.current,
  onPanResponderGrant:event=>{const touches=event.nativeEvent.touches;start.current={x:live.current.geometry.offsetX,y:live.current.geometry.offsetY,zoom:live.current.zoom,distance:touches.length>1?Math.hypot(touches[1].pageX-touches[0].pageX,touches[1].pageY-touches[0].pageY):0};},
  onPanResponderMove:(event,gesture)=>{if(lock.current)return;const touches=event.nativeEvent.touches;
   if(touches.length>1){const distance=Math.hypot(touches[1].pageX-touches[0].pageX,touches[1].pageY-touches[0].pageY);if(!start.current.distance){start.current.distance=distance;start.current.zoom=live.current.zoom;}setZoom(Math.max(1,Math.min(3,start.current.zoom*distance/Math.max(1,start.current.distance))));}
   else setOffset({x:start.current.x+gesture.dx,y:start.current.y+gesture.dy});},
 }),[]);
 async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError(false);try{await onConfirm(live.current.geometry.crop);}catch{if(alive.current)setError(true);}finally{if(alive.current){lock.current=false;setBusy(false);}}}
 const button={padding:14,borderRadius:20,backgroundColor:'#653721',alignItems:'center' as const};
 return <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" onRequestClose={()=>{if(!lock.current)onCancel();}}>
  <View style={{flex:1,backgroundColor:'#21130CCC',alignItems:'center',justifyContent:'center',paddingHorizontal:16,paddingTop:insets.top+16,paddingBottom:insets.bottom+16}}><View style={{padding:16,borderRadius:24,backgroundColor:'#FFF4E1',alignItems:'center',gap:12}}>
   <Text style={{fontSize:24,fontWeight:'800',color:'#553521'}}>Crop for your plushie</Text><Text style={{color:'#79563E'}}>Drag and zoom to position your photo.</Text>
   <View testID="plushie-crop-stage" style={{width,height}} {...responder.panHandlers}>
    <View pointerEvents="none" style={{position:'absolute',...face,overflow:'hidden'}}>
     <PlushieFaceMask asset={toy} width={face.width} height={face.height} sourceUri={asset.uri} backgroundColor="#EAD4B5"
      imageRect={{width:asset.width*geometry.scale,height:asset.height*geometry.scale,x:(face.width-asset.width*geometry.scale)/2+geometry.offsetX,y:(face.height-asset.height*geometry.scale)/2+geometry.offsetY}}/>
    </View><Image testID="plushie-crop-outline" pointerEvents="none" source={toy.source} contentFit="fill" style={{position:'absolute',...art}}/>
   </View>
   <View style={{flexDirection:'row',gap:22,alignItems:'center'}}><Pressable accessibilityRole="button" accessibilityLabel="Zoom out" disabled={busy} onPress={()=>setZoom(z=>Math.max(1,z-.2))} style={button}><Text style={{color:'#FFF'}}>−</Text></Pressable><Text>Zoom {Math.round(zoom*100)}%</Text><Pressable accessibilityRole="button" accessibilityLabel="Zoom in" disabled={busy} onPress={()=>setZoom(z=>Math.min(3,z+.2))} style={button}><Text style={{color:'#FFF'}}>+</Text></Pressable></View>
   {error&&<Text accessibilityRole="alert" style={{color:'#A23824'}}>Photo could not be saved. Please try again.</Text>}
   <Pressable accessibilityRole="button" accessibilityLabel="Save plushie photo" disabled={busy} onPress={()=>void save()} style={[button,{width:'100%',opacity:busy?.5:1}]}><Text style={{color:'#FFF',fontWeight:'800'}}>{busy?'Saving…':'Use This Photo'}</Text></Pressable>
   <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel}><Text style={{color:'#79563E',padding:8}}>Cancel</Text></Pressable>
  </View></View>
 </Modal>;
}
