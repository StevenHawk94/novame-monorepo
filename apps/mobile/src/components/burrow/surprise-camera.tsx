import { BurrowBackButton } from './burrow-back-button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image } from './burrow-image';
import { SurprisePortrait } from './surprise-art';
import type { SurpriseFrame } from '@/lib/surprise-api';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { surpriseFaceCrop } from '@/lib/surprise-photo-geometry';
import frameGeometry from '@/lib/surprise-frame-geometry.json';
import { haptics } from '@/lib/haptics';
import { withDeadline } from '@/lib/async-lifecycle';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Photo={uri:string;width:number;height:number};
export function SurpriseCamera({frame,onDone,onBack}:{frame:SurpriseFrame;onDone:(uri:string)=>Promise<void>;onBack?:()=>void}) {
  const window=useWindowDimensions(),insets=useSafeAreaInsets();
  const [area,setArea]=useState({width:window.width,height:window.height});
  const size=area.width,stageHeight=area.height;
  const frameSize=Math.max(80,Math.min(size*.92,stageHeight-insets.top-insets.bottom-260));
  const frameLeft=(size-frameSize)/2,frameTop=insets.top+66+Math.max(0,(stageHeight-insets.top-insets.bottom-260-frameSize)/2);
  const camera=useRef<CameraView>(null),alive=useRef(true),epoch=useRef(sessionEpoch()),focusedRef=useRef(true),operation=useRef(0);
  const [permission,requestPermission,getPermission]=useCameraPermissions();
  const permissionAsked=useRef(false),permissionLock=useRef(false),externalPicker=useRef(false);
  const [front,setFront]=useState(true),[ready,setReady]=useState(false),[focused,setFocused]=useState(true);
  const [active,setActive]=useState(AppState.currentState!=='background'),[cameraFailed,setCameraFailed]=useState(false),[cameraRevision,setCameraRevision]=useState(0);
  const [asset,setAsset]=useState<Photo|null>(null);
  const [busy,setBusy]=useState(false),lock=useRef(false),[error,setError]=useState('');
  const [zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0}),start=useRef(offset);
  const current=(request=operation.current)=>alive.current&&focusedRef.current&&epoch.current===sessionEpoch()&&request===operation.current;
  const retryCamera=()=>{setReady(false);setCameraFailed(false);setError('');setCameraRevision(value=>value+1);};
  useFocusEffect(useCallback(()=>{
    focusedRef.current=true;setFocused(true);setActive(AppState.currentState!=='background');
    void getPermission().catch(()=>{});
    return()=>{focusedRef.current=false;operation.current++;setFocused(false);setReady(false);};
  },[getPermission]));
  useEffect(()=>{
    alive.current=true;
    const app=AppState.addEventListener('change',state=>{
      setActive(state==='active');
      if(state!=='active'){setReady(false);setCameraRevision(value=>value+1);if(!externalPicker.current)operation.current++;}
      else if(focusedRef.current){void getPermission().catch(()=>{});}
    });
    return()=>{alive.current=false;operation.current++;app.remove();};
  },[getPermission]);
  async function askPermission(){
    if(permissionLock.current)return;permissionLock.current=true;
    try{await requestPermission();}catch{if(alive.current)setError('Camera permission could not be requested. Try again or upload a photo.');}
    finally{permissionLock.current=false;}
  }
  useEffect(()=>{
    // The old permission control was hidden under the frame. Request on entry,
    // then mount the native front camera only while this screen is active.
    if(!focused||!active||!permission||permission.granted||permission.canAskAgain===false||permissionAsked.current)return;
    permissionAsked.current=true;void askPermission();
  },[permission,focused,active]);
  const cameraRunning=focused&&active&&!!permission?.granted&&!asset&&!cameraFailed;
  const cameraKey=(front?'front':'back')+':'+cameraRevision;
  const liveCamera=useRef({key:cameraKey,running:cameraRunning});liveCamera.current={key:cameraKey,running:cameraRunning};
  useEffect(()=>{
    if(!cameraRunning||ready)return;
    const timer=setTimeout(()=>{setCameraFailed(true);setError('Camera did not start. Retry the camera or upload a photo.');},8000);
    return()=>clearTimeout(timer);
  },[cameraRunning,ready,cameraRevision,front]);
  const scale=asset?Math.max(size/asset.width,stageHeight/asset.height)*zoom:1;
  const geometry=useRef({asset,scale,offset,busy});geometry.current={asset,scale,offset,busy};
  const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>!!geometry.current.asset&&!geometry.current.busy,
    onPanResponderGrant:()=>{start.current=geometry.current.offset;},onPanResponderMove:(_,g)=>setOffset({x:start.current.x+g.dx,y:start.current.y+g.dy})}),[]);
  async function work(task:(request:number)=>Promise<void>){
    if(lock.current||!current()||AppState.currentState==='background')return;
    lock.current=true;setBusy(true);setError('');const request=++operation.current;
    try{await task(request);}catch{if(current(request))setError('Could not prepare your photo. Please try again.');}
    finally{lock.current=false;if(alive.current&&epoch.current===sessionEpoch())setBusy(false);}
  }
  function accept(next:Photo,request:number){if(current(request)){setAsset(next);setZoom(1);setOffset({x:0,y:0});setReady(false);}}
  async function processPhoto(next:Photo,request:number,photoZoom=1,photoOffset={x:0,y:0}){
    const hole=frameGeometry[frame as keyof typeof frameGeometry];
    const bounds=hole?hole.bounds.map(value=>value/512):[.29,.37,.42,.42];
    let crop;try{crop=surpriseFaceCrop(next.width,next.height,size,photoZoom,photoOffset,bounds,stageHeight,frameTop,frameLeft,frameSize);}
    catch{if(current(request))setError('Move your photo so it fills the face opening.');return;}
    const photo=await withDeadline(manipulateAsync(next.uri,[{crop},{resize:{width:512}}],{format:SaveFormat.JPEG,compress:.82}),10000);
    if(current(request))await onDone(photo.uri);
  }
  async function capture(){
    if(lock.current||!ready||!camera.current||!cameraRunning)return;
    void haptics.medium();
    await work(async request=>{
      // Keep the live camera mounted until capture returns. Freeze that exact
      // image during cropping/persistence, matching the Toy shutter feedback.
      const photo=await withDeadline(camera.current!.takePictureAsync({quality:.9,exif:false}),10000);
      if(!photo||!current(request))return;
      accept(photo,request);await processPhoto(photo,request);
    });
  }
  async function library(){await work(async request=>{
    externalPicker.current=true;
    try{
      const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:false,quality:.9,exif:false});
      if(!picked.canceled)accept(picked.assets[0],request);
    }finally{externalPicker.current=false;}
  });}
  async function confirm(){if(asset)await work(request=>processPhoto(asset,request,zoom,offset));}
  function flip(){if(busy||asset)return;setReady(false);setCameraFailed(false);setFront(value=>!value);}
  return <View style={s.body} onLayout={event=>{const {width,height}=event.nativeEvent.layout;if(width>0&&height>0)setArea({width,height});}}>
    <View style={s.stage} {...responder.panHandlers}>
      {asset?<Image source={{uri:asset.uri}} contentFit="fill" style={{position:'absolute',width:asset.width*scale,height:asset.height*scale,left:(size-asset.width*scale)/2+offset.x,top:(stageHeight-asset.height*scale)/2+offset.y}}/>
      :cameraRunning?<CameraView key={cameraKey} ref={camera} style={StyleSheet.absoluteFillObject}
        facing={front?'front':'back'} mirror={front} mode="picture" active={cameraRunning}
        onCameraReady={()=>{if(current()&&liveCamera.current.running&&liveCamera.current.key===cameraKey){setReady(true);setCameraFailed(false);}}}
        onMountError={()=>{if(current()&&liveCamera.current.running&&liveCamera.current.key===cameraKey){setCameraFailed(true);setError('Camera unavailable. Retry or upload a photo instead.');}}}/>:null}
      <View pointerEvents="none" style={{position:'absolute',top:frameTop,left:frameLeft}}><SurprisePortrait frame={frame} size={frameSize} transparentCenter/></View>
    </View>
    <View style={[s.header,{top:insets.top+12}]}>
      <BurrowBackButton light accessibilityLabel="Back" onPress={() => onBack?.()} />
      <Text style={s.title}>Take a photo</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" style={s.headerAction} disabled={busy||!!asset} onPress={flip}><Feather name="refresh-cw" color="white" size={26}/></Pressable>
    </View>
    {!asset&&!busy&&(!permission?.granted||cameraFailed||!ready)&&<View style={s.cameraStatus}>
      {!permission?.granted?<><Text style={s.copy}>Allow camera access to add your face.</Text><Pressable accessibilityRole="button" accessibilityLabel="Allow camera access" onPress={()=>permission?.canAskAgain===false?void Linking.openSettings():void askPermission()}><Text style={s.link}>{permission?.canAskAgain===false?'Open Settings':'Allow camera access'}</Text></Pressable></>
        :cameraFailed?<Pressable accessibilityRole="button" accessibilityLabel="Retry camera" onPress={retryCamera}><Text style={s.link}>Retry camera</Text></Pressable>
        :<><ActivityIndicator color="#FFF0DA"/><Text style={s.copy}>Starting {front?'front':'back'} camera…</Text></>}
    </View>}
    {busy&&<View style={s.processing} accessibilityRole="progressbar" accessibilityLabel="Processing your photo"><ActivityIndicator color="#FFF0DA"/><Text style={s.processingTitle}>Processing your photo…</Text><Text style={s.copy}>Please wait a moment while we prepare your surprise.</Text></View>}
    <View style={[s.controls,{bottom:insets.bottom+20}]}>
      <Text style={s.copy}>{asset?'Drag to position your face. Zoom if needed.':'Fit your face in the frame.'}</Text>
      {asset&&<View style={s.row}><Pressable disabled={busy} onPress={()=>setZoom(z=>Math.max(1,z-.2))}><Text style={s.link}>− Zoom</Text></Pressable><Pressable disabled={busy} onPress={()=>setZoom(z=>Math.min(4,z+.2))}><Text style={s.link}>+ Zoom</Text></Pressable></View>}
      {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <View style={s.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={asset?'Retake':'Upload photo'} disabled={busy} onPress={()=>{if(asset){setAsset(null);retryCamera();}else void library();}}><Text style={s.link}>{asset?'Retake':'Upload photo'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={asset?'Use this photo':'Take photo'} disabled={busy||(!asset&&(!cameraRunning||!ready))}
          onPress={()=>void(asset?confirm():capture())} style={({pressed})=>[s.shutter,(pressed||busy)&&{transform:[{scale:.94}]}]}>
          {busy?<ActivityIndicator color="#4A2917"/>:asset?<Feather name="check" size={34} color="#4A2917"/>:<View style={s.shutterInner}/>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={asset?'Choose another':'Switch camera'} disabled={busy} onPress={()=>asset?void library():flip()}><Text style={s.link}>{asset?'Choose another':'Flip camera'}</Text></Pressable>
      </View>
    </View>
  </View>;
}
const s=StyleSheet.create({
  body:{flex:1,backgroundColor:'#281A10'},stage:{...StyleSheet.absoluteFillObject,overflow:'hidden'},
  header:{position:'absolute',left:20,right:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontFamily:'Georgia',fontWeight:'700',color:'white',fontSize:23},
  headerAction:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  controls:{position:'absolute',left:16,right:16,gap:12,padding:12,borderRadius:22,backgroundColor:'#160B0466'},
  cameraStatus:{position:'absolute',top:'45%',left:24,right:24,alignItems:'center',gap:10,padding:14,borderRadius:20,backgroundColor:'#281A10D9'},
  processing:{position:'absolute',top:'45%',left:20,right:20,padding:22,gap:12,borderRadius:24,alignItems:'center',backgroundColor:'#281A10E8'},processingTitle:{fontSize:20,fontWeight:'800',color:'#FFF0DA',textAlign:'center'},
  copy:{color:'white',textAlign:'center',fontSize:15,lineHeight:21},link:{color:'white',fontSize:14,fontWeight:'600',padding:10},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',gap:8},
  shutter:{width:72,height:72,borderRadius:36,backgroundColor:'white',alignItems:'center',justifyContent:'center',borderWidth:4,borderColor:'#C9B5A1'},shutterInner:{width:56,height:56,borderRadius:28,backgroundColor:'white',borderWidth:1,borderColor:'#E9DCCC'},
  error:{color:'#FFB8A5',textAlign:'center'},
});
