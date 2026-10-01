import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { fetchRoomPhoto, saveRoomPhoto, fetchMemoryPhoto, saveMemoryPhoto, deleteMemoryPhoto, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { getBurrowSnapshot, refreshBurrow } from '@/lib/burrow-store';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { persistPhotoDraft, readPhotoDraft, removePhotoDraft, type PhotoDraft } from '@/lib/burrow-photo-drafts';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import { dollFaceBounds, dollFaceRect } from '@/lib/burrow-doll-face';
import { BurrowBackButton } from './burrow-back-button';

type Photo = { id: string; updatedAt: string };
type MemoryTarget = { entryId: string; slot: number; photo?: Photo; canEdit: boolean };
const photoUrlCache = new Map<string, string>();
const optimisticPhotoCache = new Map<string, string>();
subscribeSessionIdentity(() => { photoUrlCache.clear(); optimisticPhotoCache.clear(); });
function cacheRoomPhotoPreview(photoId: string, uri: string) { optimisticPhotoCache.set(photoId, uri); }
const photoKey = (photo: Photo | undefined, memory: boolean) => photo ? `${memory ? 'memory' : 'room'}:${photo.id}:${photo.updatedAt}` : '';

/** Signed URLs are kept in session memory so remounting a room never flashes empty. */
export function RoomPhoto({ photo, circle = false, memory = false }: { photo?: Photo; circle?: boolean; memory?: boolean }) {
  const key = photoKey(photo, memory);
  const [url, setUrl] = useState<string | null>(() => photo ? optimisticPhotoCache.get(photo.id) ?? photoUrlCache.get(key) ?? null : null);
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let alive = true; let generation = 0;
    const load = () => {
      const request = ++generation;
      if (!photo || AppState.currentState !== 'active') { if (!photo) setUrl(null); return; }
      const local=optimisticPhotoCache.get(photo.id);
      const cached=local??photoUrlCache.get(key);
      if (cached) setUrl(cached);
      void (memory ? fetchMemoryPhoto : fetchRoomPhoto)(photo.id).then(next => {
        if (alive && request === generation) { photoUrlCache.set(key,next); if(!local)setUrl(next); }
      }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 100_000);
    const identity = subscribeSessionIdentity(() => { generation++; setUrl(null); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') load(); });
    return () => { alive = false; generation++; clearInterval(timer); identity(); app.remove(); };
  }, [key, retry]));
  return url ? <Image source={{ uri: url }} cachePolicy="memory-disk" contentFit="cover"
    onError={() => { if(photo)optimisticPhotoCache.delete(photo.id); photoUrlCache.delete(key); setUrl(null); setRetry(n=>n+1); }} style={[styles.image, circle && { borderRadius: 200 }]} accessibilityLabel={memory ? 'Shared memory photo' : circle ? 'Doll face photo' : 'Room photo'} />
    : <Pressable accessibilityRole="button" accessibilityLabel="Reload private photo" onPress={() => setRetry(n => n + 1)} style={styles.empty}><Text>{photo ? '↻ Photo' : circle ? '🐰' : '🖼️'}</Text></Pressable>;
}

export function RoomPhotoEditor({ data, ownerId, kind, onClose, memory: memoryTarget, embedded = false, toyAsset, initialSource }: {
  data: MajorUpdateBootstrap; ownerId: string; kind: 'frame' | 'doll'; onClose: () => void; memory?: MemoryTarget;
  embedded?: boolean; toyAsset?: BurrowArtAsset; initialSource?: 'camera' | 'library';
}) {
  // Editing is based on the photo version the user actually opened. A live
  // refresh must not silently retarget a draft onto another device's new photo.
  const memory = useRef(memoryTarget).current;
  const [draft, setDraft] = useState<(PhotoDraft & { uri: string }) | null>(null);
  const [position,setPosition]=useState({x:0,y:0,zoom:1});
  const positionRef=useRef(position);
  positionRef.current=position;
  const dragStart=useRef({x:0,y:0});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [cameraArea,setCameraArea]=useState({width:0,height:0});
  const [cameraStage,setCameraStage]=useState({x:0,y:0,width:0,height:0});
  const alive = useRef(true);
  const close = useRef(onClose);
  close.current = onClose;
  const epoch = useRef(sessionEpoch());
  const scope = useRef({userId:data.profile.id,partnerId:data.partner?.id??''}).current;
  const samePair = useRef(true);
  samePair.current = scope.userId===data.profile.id&&scope.partnerId===(data.partner?.id??'');
  const target = memory ? `memory:${memory.entryId}:${memory.slot}` : `${kind}:${ownerId}`;
  const current = () => alive.current && samePair.current && epoch.current === sessionEpoch();
  useEffect(()=>{if(!samePair.current)close.current();},[data.profile.id,data.partner?.id]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeSessionIdentity(() => close.current());
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(()=>{
    try{const restored=readPhotoDraft(scope,target);if(restored)setDraft({...restored,uri:`data:image/jpeg;base64,${restored.base64}`});}
    catch{setError('The saved photo draft could not be read. It has not been replaced.');}
  },[]);
  const photo = memory ? memory.photo : data.roomPhotos?.find(p => p.ownerId === ownerId && p.kind === kind);
  const canEdit = memory ? memory.canEdit : kind === 'doll' ? !data.dollChangeUsed : ownerId === data.profile.id;
  async function preparePhoto(uri: string, width: number, height: number, crop?:{originX:number;originY:number;width:number;height:number}) {
      const side = Math.min(width, height);
      // The costume remains a separate transparent layer. A square bitmap
      // behind it is clipped by that costume's own irregular face opening.
      const image = await manipulateAsync(uri, [
        { crop: crop??{ originX: Math.floor((width-side)/2), originY: Math.floor((height-side)/2), width: side, height: side } },
        { resize: { width: 512, height: 512 } },
      ], { format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (current() && image.base64) {
        const next={uri:image.uri,base64:image.base64,key:randomUUID(),expectedPhotoId:memory?.photo?.id??null,savedAt:Date.now()};
        setDraft(next);
        setPosition({x:0,y:0,zoom:1});
        try{persistPhotoDraft(scope,target,next);}catch{setError('Could not keep this draft on your device. Free space or discard another photo draft before saving.');}
      }
  }
  async function choose(camera: boolean) {
    if (busy || !canEdit || !current()) return;
    setBusy(true); setError(null);
    try {
      // The system photo picker grants access to the chosen image without a
      // library permission prompt. Requesting that permission first can crash
      // an older development client before the picker is even presented.
      if (camera && kind === 'doll' && toyAsset) {
        const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
        if (!current()) return;
        if (!permission.granted) { Alert.alert('Camera permission needed', 'Allow camera access in Settings to take a toy photo.'); return; }
        setCameraOpen(true);
        return;
      }
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!current()) return;
        if (!permission.granted) { Alert.alert('Camera permission needed', 'Allow camera access in Settings to take a room photo.'); return; }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1,1], quality: 0.9, exif: false };
      const picked = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!current()) return;
      if (picked.canceled) { if(initialSource&&!draft)onClose(); return; }
      const source = picked.assets[0];
      await preparePhoto(source.uri, source.width, source.height);
    } catch { if (current()) setError('That photo could not be opened. Try another image.'); }
    finally { if (current()) setBusy(false); }
  }
  const initialSourceLaunched=useRef(false);
  useEffect(()=>{
    if(!initialSource||initialSourceLaunched.current)return;
    initialSourceLaunched.current=true;
    const timer=setTimeout(()=>void choose(initialSource==='camera'),280);
    return()=>clearTimeout(timer);
  },[initialSource]);
  async function takeToyPhoto() {
    if (busy || !cameraRef.current) return;
    setBusy(true); setError(null);
    try {
      const captured = await cameraRef.current.takePictureAsync({ quality: .9, exif: false });
      if (!captured || !current()) return;
      let crop: {originX:number;originY:number;width:number;height:number}|undefined;
      if(toyAsset&&cameraArea.width&&cameraArea.height&&cameraStage.width){
        const [left,top,right,bottom]=dollFaceBounds(toyAsset);
        const faceX=cameraStage.x+toyArt.left+left/toyAsset.width*toyArt.width;
        const faceY=cameraStage.y+toyArt.top+top/toyAsset.height*toyArt.height;
        const faceW=(right-left)/toyAsset.width*toyArt.width;
        const faceH=(bottom-top)/toyAsset.height*toyArt.height;
        const scale=Math.max(cameraArea.width/captured.width,cameraArea.height/captured.height);
        const offsetX=(cameraArea.width-captured.width*scale)/2;
        const offsetY=(cameraArea.height-captured.height*scale)/2;
        const side=Math.min(captured.width,captured.height,Math.round(Math.max(faceW,faceH)/scale));
        crop={originX:Math.max(0,Math.min(captured.width-side,Math.round((faceX+faceW/2-offsetX)/scale-side/2))),
          originY:Math.max(0,Math.min(captured.height-side,Math.round((faceY+faceH/2-offsetY)/scale-side/2))),width:side,height:side};
      }
      await preparePhoto(captured.uri, captured.width, captured.height, crop);
      if (current()) setCameraOpen(false);
    } catch { if (current()) setError('That photo could not be taken. Please try again.'); }
    finally { if (current()) setBusy(false); }
  }
  async function save() {
    if (!draft || busy || !current() || (!canEdit && kind!=='doll')) return;
    setBusy(true); setError(null);
    try {
      let upload=draft;
      if(kind==='doll'&&toyAsset&&position.zoom>1.001){
        const [left,top,right,bottom]=dollFaceBounds(toyAsset);
        const faceW=(right-left)/toyAsset.width*toyArt.width;
        const faceH=(bottom-top)/toyAsset.height*toyArt.height;
        const displayScale=Math.max(faceW/512,faceH/512)*position.zoom;
        const side=Math.max(128,Math.round(512/position.zoom));
        const originX=Math.max(0,Math.min(512-side,Math.round((512-side)/2-position.x/displayScale)));
        const originY=Math.max(0,Math.min(512-side,Math.round((512-side)/2-position.y/displayScale)));
        const adjusted=await manipulateAsync(draft.uri,[{crop:{originX,originY,width:side,height:side}},{resize:{width:512,height:512}}],
          {format:SaveFormat.JPEG,compress:.8,base64:true});
        if(!adjusted.base64)throw new Error('photo_crop_failed');
        upload={...draft,uri:adjusted.uri,base64:adjusted.base64};
      }
      persistPhotoDraft(scope,target,upload);
      if (memory) await saveMemoryPhoto(memory.entryId, memory.slot, upload.expectedPhotoId, upload.base64, upload.key, data.profile.id,scope.partnerId);
      else {
        const saved=await saveRoomPhoto(ownerId, kind, upload.base64, upload.key, data.profile.id,scope.partnerId);
        const photoId=typeof saved.photoId==='string'?saved.photoId:photo?.id;
        if(photoId)cacheRoomPhotoPreview(photoId,upload.uri);
      }
      if (!current()) return;
      removePhotoDraft(scope,target,draft.key);
      await refreshBurrow();
      if(!memory){
        const latest=getBurrowSnapshot().data?.roomPhotos?.find(item=>item.ownerId===ownerId&&item.kind===kind);
        if(latest)cacheRoomPhotoPreview(latest.id,upload.uri);
      }
      if (current()) onClose();
    } catch (failure) {
      if (!current()) return;
      const code = (failure as { body?: { error?: string } }).body?.error ?? (failure instanceof Error ? failure.message : '');
      setError(code === 'photo_conflict' || code === 'upload_expired' ? 'This photo changed or the upload expired. Close, refresh, and choose it again. Your saved memory is safe.' : code === 'daily_limit_reached' ? 'You already changed a doll today. Try again after your local midnight.' : 'Save didn’t finish. Retry uses the same request, so it won’t count twice.');
    } finally { if (current()) setBusy(false); }
  }
  async function remove() {
    if (!memory || !photo || !canEdit || busy) return;
    setBusy(true); setError(null);
    try {
      await deleteMemoryPhoto(memory.entryId, photo.id, data.profile.id);
      if (!current()) return;
      await refreshBurrow();
      if (current()) onClose();
    } catch { if (current()) setError('The photo could not be removed. Please retry.'); }
    finally { if (current()) setBusy(false); }
  }
  const toySize=Math.min(screenWidth-28,430);
  const toyHeight=Math.min(screenHeight*.57,toySize*1.48);
  const toyArt=(()=>{
    if(!toyAsset)return {left:0,top:0,width:toySize,height:toyHeight};
    const [left,top,right,bottom]=toyAsset.bounds;
    const scale=Math.min(toySize/(right-left),toyHeight/(bottom-top));
    return {left:(toySize-(right-left)*scale)/2-left*scale,
      top:(toyHeight-(bottom-top)*scale)/2-top*scale,width:toyAsset.width*scale,height:toyAsset.height*scale};
  })();
  const drag=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>kind==='doll'&&!!draft,
    onMoveShouldSetPanResponder:()=>kind==='doll'&&!!draft,
    onPanResponderGrant:()=>{dragStart.current={x:positionRef.current.x,y:positionRef.current.y};},
    onPanResponderMove:(_event,gesture)=>{
      const limit=Math.max(0,(positionRef.current.zoom-1)*toySize*.42);
      setPosition(previous=>({...previous,x:Math.max(-limit,Math.min(limit,dragStart.current.x+gesture.dx)),
        y:Math.max(-limit,Math.min(limit,dragStart.current.y+gesture.dy))}));
    },
  }).panHandlers,[draft,kind,toySize]);
  const zoom=(direction:1|-1)=>setPosition(previous=>{
    const next=Math.max(1,Math.min(2.5,Math.round((previous.zoom+direction*.15)*100)/100));
    if(next===1)return {x:0,y:0,zoom:1};
    return {...previous,zoom:next};
  });
  const content = cameraOpen && toyAsset ? <View style={styles.cameraPage} onLayout={event=>setCameraArea(event.nativeEvent.layout)}>
      <CameraView ref={cameraRef} facing="front" mirror style={StyleSheet.absoluteFillObject} />
      <View style={styles.cameraHeader}><BurrowBackButton light onPress={()=>setCameraOpen(false)}/><Text style={styles.cameraTitle}>Align your face</Text><View style={{width:44}} /></View>
      <View pointerEvents="none" onLayout={event=>setCameraStage(event.nativeEvent.layout)} style={[styles.toyPreview,{width:toySize,height:toyHeight}]}><Image source={toyAsset.source} contentFit="fill" style={[styles.toyArt,toyArt]}/></View>
      {error&&<Text style={styles.cameraTitle}>{error}</Text>}
      <View style={styles.cameraActions}><Button label="Photo library" onPress={()=>{setCameraOpen(false);setTimeout(()=>void choose(false),320);}}/><Pressable accessibilityRole="button" accessibilityLabel="Take photo" disabled={busy} onPress={()=>void takeToyPhoto()} style={styles.shutter}><View style={styles.shutterInner}/></Pressable></View>
    </View> : <View style={embedded ? styles.embedded : styles.scrim}><ScrollView style={embedded ? styles.embeddedSheet : styles.sheet} contentContainerStyle={{ padding: 22, gap: 14, paddingBottom: embedded ? 44 : 22 }} keyboardShouldPersistTaps="handled">
      {embedded&&<BurrowBackButton onPress={onClose}/>}
      <Text style={styles.title}>{memory ? 'A photo to remember' : kind === 'doll' ? 'A familiar little face' : 'A memory on the wall'}</Text>
      <Text style={styles.copy}>{memory ? canEdit ? `Drag and zoom to crop. Only you can change this memory.${data.partner?' Photos are shared privately with your current partner.':''} No AI.` : 'Your partner’s memory · view only' : kind === 'doll' ? 'Align your face inside the toy. Its transparent opening follows this costume, not a fixed circle.' : ownerId === data.profile.id ? `Drag and zoom in the photo editor. ${data.partner?'Your partner can look, but ':''}Only you can replace this photo.` : 'Your partner’s photo · view only'}</Text>
      {kind==='doll'&&toyAsset?<View style={[styles.toyPreview,{width:toySize,height:toyHeight}]}>
        <View style={[styles.toyArt,toyArt]}>
          <View style={[styles.toyFace,dollFaceRect(toyAsset)]} {...drag}>{draft?<Image source={{uri:draft.uri}} cachePolicy="none" contentFit="cover" pointerEvents="none" style={[styles.image,{transform:[{translateX:position.x},{translateY:position.y},{scale:position.zoom}]}]}/>:photo?<RoomPhoto key={`${photo.id}:${photo.updatedAt}`} photo={photo}/>:null}</View>
          <Image source={toyAsset.source} contentFit="fill" style={styles.image} pointerEvents="none" />
        </View>
      </View>:<View style={styles.preview}>{draft ? <Image source={{ uri: draft.uri }} cachePolicy="none" style={styles.image} /> : <RoomPhoto photo={photo} memory={!!memory} />}</View>}
      {kind === 'doll' && data.dollChangeUsed && <Text style={styles.copy}>Today’s doll change is used. You can still view both rooms.</Text>}
      {kind==='doll'&&draft&&<View style={styles.row}><Button label="− Zoom" onPress={()=>zoom(-1)}/><Button label="+ Zoom" onPress={()=>zoom(1)}/></View>}
      {error && <Text accessibilityRole="alert" style={styles.copy}>{error}</Text>}
      {canEdit && <View style={styles.row}><Button label="Photo library" disabled={busy} onPress={() => void choose(false)} /><Button label="Camera" disabled={busy} onPress={() => void choose(true)} /></View>}
      {draft && <><Text style={styles.copy}>Draft kept on this device. Review and tap Save to send; closing the app does not upload it. Signing out removes local drafts.</Text>
        <Button label={busy ? 'Saving…' : 'Save / retry photo'} disabled={busy || (!canEdit&&kind!=='doll')} onPress={() => void save()} />
        <Button label="Discard local photo draft" disabled={busy} onPress={()=>Alert.alert('Discard this local draft?','This will not undo a photo that the server already saved.',[{text:'Keep',style:'cancel'},{text:'Discard',style:'destructive',onPress:()=>{try{removePhotoDraft(scope,target,draft.key);setDraft(null);}catch{setError('Could not remove the draft. Please try again.');}}}])}/></>}
      {memory && photo && canEdit && !draft && <Button label="Delete photo" disabled={busy} onPress={() => Alert.alert('Delete this photo?', 'It will disappear from this memory for both of you. Your words stay saved.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} />}
      <Button label={draft ? 'Close · keep draft' : 'Close'} disabled={busy} onPress={onClose} />
    </ScrollView></View>;
  return embedded ? content : <Modal transparent presentationStyle="overFullScreen" animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>{content}</Modal>;
}
function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: .4 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#21130CCC', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '88%', flexGrow: 0, borderRadius: 28, backgroundColor: '#FFF4E1' },
  title: { fontSize: 23, fontWeight: '800', color: '#553521' }, copy: { color: '#79563E', fontSize: 14, lineHeight: 21 },
  preview: { width: 180, height: 180, alignSelf: 'center', overflow: 'hidden', borderRadius: 14, backgroundColor: '#E8C8A0' },
  image: { width: '100%', height: '100%' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, row: { flexDirection: 'row', gap: 12 },
  button: { flexGrow: 1, borderRadius: 16, backgroundColor: '#2F8D72', padding: 14, alignItems: 'center' }, buttonText: { color: '#FFF4E1', fontWeight: '700' },
  embedded:{flex:1,width:'100%',backgroundColor:'#FFFAF2'},embeddedSheet:{flex:1,width:'100%',backgroundColor:'#FFFAF2'},
  toyPreview:{alignSelf:'center',position:'relative'},toyArt:{position:'absolute'},toyFace:{position:'absolute',overflow:'hidden',backgroundColor:'#FFFAF2'},
  cameraPage:{flex:1,backgroundColor:'#17120E',justifyContent:'space-between',alignItems:'center'},
  cameraHeader:{width:'100%',paddingTop:58,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  cameraTitle:{color:'#FFF',fontWeight:'800',fontSize:22,textAlign:'center'},
  cameraActions:{width:'100%',paddingHorizontal:24,paddingBottom:60,flexDirection:'row',alignItems:'center',gap:18},
  shutter:{width:82,height:82,borderWidth:4,borderColor:'#FFF',borderRadius:41,alignItems:'center',justifyContent:'center',marginRight:'40%'},
  shutterInner:{width:64,height:64,borderRadius:32,backgroundColor:'#FFF'},
});
