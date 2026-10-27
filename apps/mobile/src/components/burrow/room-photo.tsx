import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Alert, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { Image } from './burrow-image';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchMemoryPhoto, saveMemoryPhoto, deleteMemoryPhoto, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { cachedRoomPhotoUri, invalidateRoomPhotoCache, loadRoomPhoto } from '@/lib/burrow-room-photo-cache';
import { burrowClock, refreshBurrow, refreshBurrowAfterCurrent, enqueuePlushiePhoto, enqueueFramePhoto } from '@/lib/burrow-store';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { persistPhotoDraft, readPhotoDraft, removePhotoDraft, type PhotoDraft } from '@/lib/burrow-photo-drafts';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import { dollFaceBounds, dollFaceRect } from '@/lib/burrow-doll-face';
import { roomPhotoFailureCode, roomPhotoFailureMessage, TOY_PHOTO_DAILY_LIMIT_MESSAGE, TOY_PHOTO_DAILY_LIMIT_TITLE } from '@/lib/room-photo-errors';
import { BurrowBackButton } from './burrow-back-button';
import { haptics } from '@/lib/haptics';
import { FramePhotoCropper } from './frame-photo-cropper';
import { PlushiePhotoCropper } from './plushie-photo-cropper';
import { FRAME_PHOTO_ASPECT, FRAME_PHOTO_OUTPUT_SIZE, centeredRoomPhotoCrop, type PhotoCrop } from '@/lib/room-photo-crop';
import { toyPhotoFor, toyPhotoChangedToday, roomPhotoTarget } from '@/lib/burrow-toy-photos';
import {PlushieFaceMask} from './plushie-face-mask';

type Photo = { id: string; updatedAt: string };
type MemoryTarget = { entryId: string; slot: number; photo?: Photo; canEdit: boolean };
// Memory photos retain short-lived links. Room/Toy photos instead use an
// account-scoped document file keyed by photo version, not an expiring URL.
const PHOTO_LINK_REFRESH_MS = 90_000;
const photoUrlCache = new Map<string, { url: string; fetchedAt: number }>();
subscribeSessionIdentity(() => { photoUrlCache.clear(); });
const photoKey = (photo: Photo | undefined, memory: boolean) => photo ? `${memory ? 'memory' : 'room'}:${photo.id}:${photo.updatedAt}` : '';

export {useRoomPhotoUri} from '@/lib/use-room-photo-uri';

export async function pickRoomPhoto(source: 'camera' | 'library', kind: 'frame' | 'doll' = 'doll') {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('camera_permission_denied');
  }
  // iOS forces its native editor to a square, regardless of the chosen aspect.
  // Frame photos use our own 201:290 cropper after camera/library returns.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: kind === 'doll', aspect: [1, 1], quality: .9, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : result.assets[0];
}

export async function uploadRoomPhoto(data: MajorUpdateBootstrap, ownerId: string, kind: 'frame' | 'doll', asset: Pick<ImagePicker.ImagePickerAsset, 'uri' | 'width' | 'height'>, crop?: PhotoCrop, toyId?: string) {
  if (kind === 'doll' && !toyId) throw Error('toy_required');
  const epoch = sessionEpoch();
  const image = await manipulateAsync(asset.uri, [
    { crop: crop ?? centeredRoomPhotoCrop(asset.width, asset.height, kind) },
    { resize: kind === 'frame' ? FRAME_PHOTO_OUTPUT_SIZE : { width: 512, height: 512 } },
  ], { format: SaveFormat.JPEG, compress: .8, base64: true });
  if (!image.base64 || epoch !== sessionEpoch()) throw new Error('photo_session_changed');
  if(kind==='frame'){
    await enqueueFramePhoto(data,ownerId,image.base64,randomUUID());
    return;
  }
  const scope = { userId: data.profile.id, partnerId: data.partner?.id ?? '' };
  // Freeze the exact submitted bytes/key before the request. A lost response
  // must retry this upload, not crop again or consume another daily change.
  const draft = { base64: image.base64, key: randomUUID(), expectedPhotoId: null, savedAt: Date.now(), submitted: true };
  const target = roomPhotoTarget(kind, ownerId, toyId);
  persistPhotoDraft(scope, target, draft);
  if(kind==='doll'){
    await enqueuePlushiePhoto(data,ownerId,toyId!,image.base64,draft.key);
    try{removePhotoDraft(scope,target,draft.key);}catch{console.warn('[plushie-photo/local]','legacy_draft_cleanup_pending');}
    return;
  }
}

/** Room/Toy images resolve from an app-private file; memories stay session-only. */
export function RoomPhoto({ photo, circle = false, memory = false }: { photo?: Photo; circle?: boolean; memory?: boolean }) {
  const key = photoKey(photo, memory);
  const [resolved, setResolved] = useState<{key:string;uri:string}|null>(() => {
    const uri=photo ? memory ? photoUrlCache.get(key)?.url : cachedRoomPhotoUri(photo) : null;
    return uri ? {key,uri} : null;
  });
  const [retry, setRetry] = useState(0);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { failures.current = 0; return () => { if (retryTimer.current) clearTimeout(retryTimer.current); }; }, [key]);
  const url=(resolved?.key===key?resolved.uri:null)??(!memory&&photo ? cachedRoomPhotoUri(photo) : null);
  useFocusEffect(useCallback(() => {
    let alive = true; let generation = 0;
    const load = () => {
      const request = ++generation;
      if (!photo || AppState.currentState !== 'active') { if (!photo) setResolved(null); return; }
      if (!memory) {
        const cached=cachedRoomPhotoUri(photo);
        if(cached)setResolved({key,uri:cached});
        void loadRoomPhoto(photo).then(uri=>{if(alive&&request===generation)setResolved({key,uri});}).catch(()=>{});
        return;
      }
      const signed=photoUrlCache.get(key);
      const cached=signed?.url;
      if (cached) setResolved({key,uri:cached});
      if (signed && Date.now() - signed.fetchedAt < PHOTO_LINK_REFRESH_MS) return;
      void fetchMemoryPhoto(photo.id).then(next => {
        if (alive && request === generation) { photoUrlCache.set(key,{url:next,fetchedAt:Date.now()}); setResolved({key,uri:next}); }
      }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 100_000);
    const identity = subscribeSessionIdentity(() => { generation++; photoUrlCache.delete(key); setResolved(null); });
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') load();
      else if (memory) {
        // Memory photos are private: keep navigation fast within a foreground
        // session, but discard their signed link once the app is hidden.
        generation++;
        photoUrlCache.delete(key);
        setResolved(null);
      }
    });
    return () => { alive = false; generation++; clearInterval(timer); identity(); app.remove(); };
  }, [key, retry]));
  return url ? <Image source={{ uri: url }} cachePolicy={memory ? 'none' : 'memory-disk'} contentFit="cover"
    onError={() => { if(photo){if(memory)photoUrlCache.delete(key);else invalidateRoomPhotoCache(photo);}setResolved(null);
      if (failures.current++ < 2) retryTimer.current = setTimeout(() => setRetry(n => n + 1), 1000 * failures.current);
    }} style={[styles.image, circle && { borderRadius: 200 }]} accessibilityLabel={memory ? 'Shared memory photo' : circle ? 'Doll face photo' : 'Room photo'} />
    : <Pressable accessibilityRole="button" accessibilityLabel="Reload private photo" onPress={() => { failures.current = 0; setRetry(n => n + 1); }} style={styles.empty}><Text>{photo ? '↻ Photo' : circle ? '🐰' : '🖼️'}</Text></Pressable>;
}

export function RoomPhotoEditor({ data, ownerId, kind, onClose, onSaved, onDailyLimit, memory: memoryTarget, embedded = false, toyAsset, toyId, initialSource, captureOnly = false }: {
  data: MajorUpdateBootstrap; ownerId: string; kind: 'frame' | 'doll'; onClose: () => void; memory?: MemoryTarget;
  embedded?: boolean; toyAsset?: BurrowArtAsset; toyId?: string; initialSource?: 'camera' | 'library'; captureOnly?: boolean; onSaved?: () => void; onDailyLimit?: () => void;
}) {
  // Editing is based on the photo version the user actually opened. A live
  // refresh must not silently retarget a draft onto another device's new photo.
  const memory = useRef(memoryTarget).current;
  const [draft, setDraft] = useState<(PhotoDraft & { uri: string }) | null>(null);
  const [pendingFrameAsset, setPendingFrameAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [pendingToyAsset,setPendingToyAsset]=useState<ImagePicker.ImagePickerAsset|null>(null);
  const [cameraFacing,setCameraFacing]=useState<'front'|'back'>('front');
  const [position,setPosition]=useState({x:0,y:0,zoom:1});
  const positionRef=useRef(position);
  positionRef.current=position;
  const dragStart=useRef({x:0,y:0});
  const [busy, setBusy] = useState(false);
  const operationInFlight = useRef(false);
  const [libraryProcessing, setLibraryProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(captureOnly && initialSource === 'camera');
  const [cameraProcessing, setCameraProcessing] = useState(false);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const insets=useSafeAreaInsets();
  const [cameraFocused,setCameraFocused]=useState(true),[cameraActive,setCameraActive]=useState(AppState.currentState==='active');
  const [cameraReady,setCameraReady]=useState(false),[cameraFailed,setCameraFailed]=useState(false),[cameraRevision,setCameraRevision]=useState(0);
  useFocusEffect(useCallback(()=>{setCameraFocused(true);return()=>{setCameraFocused(false);setCameraReady(false);};},[]));
  useEffect(()=>{const app=AppState.addEventListener('change',state=>{
    setCameraActive(state==='active');if(state!=='active'){setCameraReady(false);setCameraRevision(value=>value+1);}
  });return()=>app.remove();},[]);
  const cameraRef = useRef<CameraView>(null);
  const cameraSwitching=useRef(false);
  const liveCamera=useRef({revision:cameraRevision,active:false});
  liveCamera.current={revision:cameraRevision,active:cameraOpen&&cameraActive&&cameraFocused&&!!cameraPermission?.granted&&!capturedPhotoUri};
  useEffect(()=>{
    if(!liveCamera.current.active||cameraReady||cameraFailed)return;
    const timer=setTimeout(()=>{setCameraFailed(true);setError('Camera did not start. Please retry.');},8000);
    return()=>clearTimeout(timer);
  },[cameraOpen,cameraActive,cameraFocused,cameraPermission?.granted,capturedPhotoUri,cameraRevision,cameraReady,cameraFailed]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [cameraArea,setCameraArea]=useState({width:0,height:0});
  const [cameraStage,setCameraStage]=useState({x:0,y:0,width:0,height:0});
  const alive = useRef(true);
  const close = useRef(onClose);
  close.current = onClose;
  const epoch = useRef(sessionEpoch());
  const scope = useRef({userId:data.profile.id,partnerId:data.partner?.id??''}).current;
  const pairVersion=useRef(data.pairVersion).current;
  const samePair = useRef(true);
  samePair.current = scope.userId===data.profile.id&&scope.partnerId===(data.partner?.id??'')&&pairVersion===data.pairVersion;
  const target = memory ? `memory:${memory.entryId}:${memory.slot}` : roomPhotoTarget(kind, ownerId, toyId);
  const current = () => alive.current && samePair.current && epoch.current === sessionEpoch();
  useEffect(()=>{if(!samePair.current)close.current();},[data.profile.id,data.partner?.id,data.pairVersion]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeSessionIdentity(() => close.current());
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(()=>{
    try{const restored=readPhotoDraft(scope,target);if(restored){setDraft({...restored,uri:`data:image/jpeg;base64,${restored.base64}`});setCameraOpen(false);}}
    catch{setError('The saved photo draft could not be read. It has not been replaced.');}
  },[]);
  const photo = memory ? memory.photo : kind === 'doll' ? toyPhotoFor(data.roomPhotos, ownerId, toyId) : data.roomPhotos?.find(p => p.ownerId === ownerId && p.kind === kind);
  const canEdit = memory ? memory.canEdit : kind === 'doll'
    ? !!toyId && (ownerId === data.profile.id || ownerId === data.partner?.id) && !toyPhotoChangedToday(data, toyId, ownerId)
    : ownerId === data.profile.id && (!data.photoUsage || data.photoUsage.localDate!==data.localDate || data.photoUsage.frame.remaining>0);
  async function preparePhoto(uri: string, width: number, height: number, crop?:{originX:number;originY:number;width:number;height:number}) {
      const targetKind = kind === 'frame' && !memory ? 'frame' : 'doll';
      // Doll and memory photos stay square; a frame draft stays 201:290 all the
      // way through its preview, saved JPEG and Home display.
      const image = await manipulateAsync(uri, [
        { crop: crop ?? centeredRoomPhotoCrop(width, height, targetKind) },
        { resize: targetKind === 'frame' ? FRAME_PHOTO_OUTPUT_SIZE : { width: 512, height: 512 } },
      ], { format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (current() && image.base64) {
        const next={uri:image.uri,base64:image.base64,key:randomUUID(),expectedPhotoId:memory?.photo?.id??null,savedAt:Date.now()};
        setDraft(next);
        setPosition({x:0,y:0,zoom:1});
        try{persistPhotoDraft(scope,target,next);}catch{setError('Could not keep this draft on your device. Free space or discard another photo draft before saving.');}
      }
  }
  async function choose(camera: boolean) {
    if (operationInFlight.current || busy || !canEdit || !current()) return;
    operationInFlight.current = true;
    setBusy(true); setError(null);
    try {
      // The system photo picker grants access to the chosen image without a
      // library permission prompt. Requesting that permission first can crash
      // an older development client before the picker is even presented.
      if (camera && kind === 'doll' && toyAsset) {
        const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
        if (!current()) return;
        if (!permission.granted) { Alert.alert('Camera permission needed', 'Allow camera access in Settings to take a toy photo.'); if(captureOnly)onClose(); return; }
        setCapturedPhotoUri(null);
        setCameraOpen(true);
        return;
      }
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!current()) return;
        if (!permission.granted) { Alert.alert('Camera permission needed', 'Allow camera access in Settings to take a room photo.'); return; }
      }
      const frame = kind === 'frame' && !memory;
      const plushie=kind==='doll'&&!!toyAsset&&!memory;
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: !frame&&!plushie, aspect: [1,1], quality: 0.9, exif: false };
      const picked = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!current()) return;
      if (picked.canceled) { if(initialSource&&!draft)onClose(); return; }
      const source = picked.assets[0];
      if(!source?.uri||!Number.isFinite(source.width)||!Number.isFinite(source.height)||source.width<1||source.height<1)throw Error('photo_too_small');
      if (frame) { setPendingFrameAsset(source); return; }
      if(plushie){setPendingToyAsset(source);return;}
      if (captureOnly) {
        // The native picker already lets the user drag/zoom and finish the
        // square crop. Apply that result directly, without a second toy editor.
        setLibraryProcessing(true);
        await uploadRoomPhoto(data, ownerId, kind, source, undefined, toyId);
        if (current()) { onSaved?.(); onClose(); }
      } else await preparePhoto(source.uri, source.width, source.height);
    } catch (failure) {
      if (!current()) return;
      if (captureOnly) recoverDirectPhoto(failure);
      else setError('That photo could not be opened. Try another image.');
    }
    finally {
      operationInFlight.current = false;
      if (current()) { setBusy(false); setLibraryProcessing(false); }
    }
  }
  function recoverDirectPhoto(failure: unknown) {
    if (roomPhotoFailureCode(failure) === 'daily_limit_reached') {
      onDailyLimit?.(); onClose();
      Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE, TOY_PHOTO_DAILY_LIMIT_MESSAGE);
      return;
    }
    try {
      const recoverable = readPhotoDraft(scope, target);
      if (recoverable) {
        setDraft({ ...recoverable, uri: `data:image/jpeg;base64,${recoverable.base64}` });
        setCameraOpen(false);
      }
    } catch {
      setError('The photo upload could not be recovered from this device. Please free some space and try again.');
      return;
    }
    setError(roomPhotoFailureMessage(failure, 'Your photo could not be saved. Please try again.'));
  }
  const initialSourceLaunched=useRef(false);
  useEffect(()=>{
    if(!initialSource||initialSourceLaunched.current)return;
    initialSourceLaunched.current=true;
    try { if (readPhotoDraft(scope,target)) return; }
    catch { return; } // The restore effect already exposes the disk error.
    // Direct Plushie selection has no editor Modal to present first. Its source
    // menu has already dismissed before this component is mounted.
    const timer=setTimeout(()=>void choose(initialSource==='camera'),captureOnly?0:280);
    return()=>clearTimeout(timer);
  },[initialSource]);
  function flipCamera(){
    if(operationInFlight.current||cameraSwitching.current||!cameraReady||!cameraActive)return;
    cameraSwitching.current=true;liveCamera.current={...liveCamera.current,revision:liveCamera.current.revision+1};
    setCameraReady(false);setCameraFailed(false);setError(null);setCameraRevision(n=>n+1);setCameraFacing(f=>f==='front'?'back':'front');
  }
  async function takeToyPhoto() {
    if(cameraSwitching.current||!cameraReady||!cameraActive||!cameraFocused||!cameraPermission?.granted)return;
    if (operationInFlight.current || busy || !cameraRef.current) return;
    if (!canEdit) { onDailyLimit?.(); onClose(); Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE, TOY_PHOTO_DAILY_LIMIT_MESSAGE); return; }
    // A physical camera capture plus image encoding/upload can take seconds.
    // Acknowledge the shutter immediately, then keep the progress state visible
    // until the saved photo has been reflected in the Toy screen.
    void haptics.medium();
    operationInFlight.current = true;
    setBusy(true); setCameraProcessing(true); setError(null);
    try {
      const captured = await cameraRef.current.takePictureAsync({ quality: .9, exif: false });
      if (!captured || !current()) return;
      // Hold the exact shutter frame over the camera while encoding/uploading.
      // Unmounting the live preview before takePictureAsync resolves can cancel the capture.
      setCapturedPhotoUri(captured.uri);
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
      if (captureOnly) {
        await uploadRoomPhoto(data, ownerId, kind, captured, crop, toyId);
        if (current()) { onSaved?.(); onClose(); }
      } else {
        await preparePhoto(captured.uri, captured.width, captured.height, crop);
        if (current()) setCameraOpen(false);
      }
    } catch (failure) {
      if (!current()) return;
      setCapturedPhotoUri(null);
      if (captureOnly) recoverDirectPhoto(failure);
      else setError(roomPhotoFailureMessage(failure, 'That photo could not be taken. Please try again.'));
    }
    finally { operationInFlight.current = false; if (current()) { setBusy(false); setCameraProcessing(false); } }
  }
  async function save() {
    if (!draft || operationInFlight.current || busy || !current() || (!canEdit && !draft.submitted)) return;
    operationInFlight.current = true;
    setBusy(true); setError(null);
    try {
      let upload=draft;
      if(kind==='doll'&&toyAsset&&!draft.submitted&&position.zoom>1.001){
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
      if (!current()) return;
      upload={...upload,submitted:true};
      persistPhotoDraft(scope,target,upload);
      // Freeze the submitted bytes as the retry draft. Never crop them a
      // second time with the same idempotency key after a lost response.
      setDraft(upload); setPosition({x:0,y:0,zoom:1});
      if (memory) await saveMemoryPhoto(memory.entryId, memory.slot, upload.expectedPhotoId, upload.base64, upload.key, data.profile.id,scope.partnerId);
      else if(kind==='doll')await enqueuePlushiePhoto(data,ownerId,toyId!,upload.base64,upload.key);
      else await enqueueFramePhoto(data,ownerId,upload.base64,upload.key);
      if (!current()) return;
      if (memory) await refreshBurrowAfterCurrent({ after: burrowClock() });
      if (!current()) return;
      if(!memory){
        try{removePhotoDraft(scope,target,draft.key);}catch{console.warn('[room-photo/local]','legacy_draft_cleanup_pending');}
      }else removePhotoDraft(scope,target,draft.key);
      if (current()) { onSaved?.(); onClose(); }
    } catch (failure) {
      if (!current()) return;
      const code = (failure as { body?: { error?: string } }).body?.error ?? (failure instanceof Error ? failure.message : '');
      if (captureOnly && code === 'daily_limit_reached') { recoverDirectPhoto(failure); return; }
      setError(code === 'photo_conflict' || code === 'upload_expired' ? 'This photo changed or the upload expired. Close, refresh, and choose it again. Your saved memory is safe.' : code === 'daily_limit_reached' ? 'You already changed this toy’s photo today. Try again after your local midnight.' : 'Save didn’t finish. Retry uses the same request, so it won’t count twice.');
    } finally { operationInFlight.current = false; if (current()) setBusy(false); }
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
  const toySize=Math.min((cameraArea.width||screenWidth)-28,430);
  const toyHeight=Math.max(100,Math.min((cameraArea.height||screenHeight)-insets.top-insets.bottom-200,toySize*1.48));
  const toyArt=(()=>{
    if(!toyAsset)return {left:0,top:0,width:toySize,height:toyHeight};
    const scale=Math.min(toySize/toyAsset.width,toyHeight/toyAsset.height);
    return {left:(toySize-toyAsset.width*scale)/2,
      top:(toyHeight-toyAsset.height*scale)/2,width:toyAsset.width*scale,height:toyAsset.height*scale};
  })();
  const drag=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>kind==='doll'&&!!draft&&!draft.submitted&&!busy,
    onMoveShouldSetPanResponder:()=>kind==='doll'&&!!draft&&!draft.submitted&&!busy,
    onPanResponderGrant:()=>{dragStart.current={x:positionRef.current.x,y:positionRef.current.y};},
    onPanResponderMove:(_event,gesture)=>{
      const limit=Math.max(0,(positionRef.current.zoom-1)*toySize*.42);
      setPosition(previous=>({...previous,x:Math.max(-limit,Math.min(limit,dragStart.current.x+gesture.dx)),
        y:Math.max(-limit,Math.min(limit,dragStart.current.y+gesture.dy))}));
    },
  }).panHandlers,[draft,kind,toySize,busy]);
  const zoom=(direction:1|-1)=>setPosition(previous=>{
    const next=Math.max(1,Math.min(2.5,Math.round((previous.zoom+direction*.15)*100)/100));
    if(next===1)return {x:0,y:0,zoom:1};
    return {...previous,zoom:next};
  });
  const draftFaceRect=toyAsset&&draft?(()=>{
    const b=dollFaceBounds(toyAsset),w=(b[2]-b[0])*toyArt.width/toyAsset.width,h=(b[3]-b[1])*toyArt.height/toyAsset.height;
    const side=Math.max(w,h)*position.zoom;
    return {x:(w-side)/2+position.x,y:(h-side)/2+position.y,width:side,height:side};
  })():undefined;
  const content = cameraOpen && toyAsset ? <View style={styles.cameraPage} onLayout={event=>setCameraArea(event.nativeEvent.layout)}>
      {cameraFocused&&cameraActive&&cameraPermission?.granted&&!capturedPhotoUri&&!cameraFailed&&<CameraView key={cameraRevision} ref={cameraRef} facing={cameraFacing} mirror={cameraFacing==='front'} style={StyleSheet.absoluteFillObject}
        onCameraReady={()=>{if(liveCamera.current.active&&liveCamera.current.revision===cameraRevision){cameraSwitching.current=false;setCameraReady(true);}}} onMountError={()=>{if(liveCamera.current.active&&liveCamera.current.revision===cameraRevision){cameraSwitching.current=false;setCameraReady(false);setCameraFailed(true);setError('Camera unavailable. Please retry.');}}} />}
      {capturedPhotoUri&&<Image source={{uri:capturedPhotoUri}} contentFit="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" />}
      <View style={[styles.cameraHeader,{paddingTop:insets.top+12}]}><BurrowBackButton light onPress={()=>captureOnly?onClose():setCameraOpen(false)}/><Text style={styles.cameraTitle}>Align your face</Text><Pressable accessibilityRole="button" accessibilityLabel="Flip camera" disabled={busy||cameraProcessing||!cameraActive||!cameraReady} onPress={flipCamera} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:28,color:'#FFF'}}>↻</Text></Pressable></View>
      <View pointerEvents="none" onLayout={event=>setCameraStage(event.nativeEvent.layout)} style={[styles.toyPreview,{position:'absolute',left:((cameraArea.width||screenWidth)-toySize)/2,top:insets.top+70+Math.max(0,((cameraArea.height||screenHeight)-insets.top-insets.bottom-200-toyHeight)/2),width:toySize,height:toyHeight}]}><Image source={toyAsset.source} contentFit="fill" style={[styles.toyArt,toyArt]}/></View>
      {cameraFailed&&<Pressable accessibilityRole="button" accessibilityLabel="Retry camera" onPress={()=>{setCameraFailed(false);setCameraReady(false);setCameraRevision(value=>value+1);setError(null);}} style={styles.cameraProcessing}><Text style={styles.cameraProcessingTitle}>Retry camera</Text></Pressable>}
      {cameraProcessing&&<View style={styles.cameraProcessing} accessibilityRole="progressbar" accessibilityLabel="Processing your photo">
        <ActivityIndicator size="large" color="#FFF" />
        <Text style={styles.cameraProcessingTitle}>Processing your photo...</Text>
        <Text style={styles.cameraProcessingHint}>Please wait a moment while we save it to your plushie.</Text>
      </View>}
      {error&&<Text style={styles.cameraTitle}>{error}</Text>}
      <View style={[styles.cameraActions,{paddingBottom:insets.bottom+24}]}><Pressable accessibilityRole="button" accessibilityLabel="Take photo" disabled={busy||!cameraReady||!cameraActive} onPress={()=>void takeToyPhoto()} style={({pressed})=>[styles.shutter,(pressed||cameraProcessing)&&styles.shutterPressed]}>{cameraProcessing?<ActivityIndicator color="#4C2B22"/>:<View style={styles.shutterInner}/>}</Pressable></View>
    </View> : <View style={embedded ? styles.embedded : styles.scrim}><ScrollView style={embedded ? styles.embeddedSheet : styles.sheet} contentContainerStyle={{ padding: 22, gap: 14, paddingBottom: embedded ? 44 : 22 }} keyboardShouldPersistTaps="handled">
      {embedded&&<BurrowBackButton onPress={onClose}/>}
      <Text style={styles.title}>{memory ? 'A photo to remember' : kind === 'doll' ? 'A familiar little face' : 'A memory on the wall'}</Text>
      <Text style={styles.copy}>{memory ? canEdit ? `Drag and zoom to crop. Only you can change this memory.${data.partner?' Photos are shared privately with your current partner.':''} No AI.` : 'Your partner’s memory · view only' : kind === 'doll' ? 'Align your face inside the toy. Its transparent opening follows this costume, not a fixed circle.' : ownerId === data.profile.id ? `Drag and zoom in the photo editor. ${data.partner?'Your partner can look, but ':''}Only you can replace this photo.` : 'Your partner’s photo · view only'}</Text>
      {kind==='doll'&&toyAsset?<View style={[styles.toyPreview,{width:toySize,height:toyHeight}]}>
        <View style={[styles.toyArt,toyArt]}>
          <View style={[styles.toyFace,dollFaceRect(toyAsset)]} {...drag}><PlushieFaceMask asset={toyAsset}
            width={(dollFaceBounds(toyAsset)[2]-dollFaceBounds(toyAsset)[0])*toyArt.width/toyAsset.width}
            height={(dollFaceBounds(toyAsset)[3]-dollFaceBounds(toyAsset)[1])*toyArt.height/toyAsset.height}
            sourceUri={draft?.uri} photo={draft?undefined:photo} imageRect={draftFaceRect} backgroundColor="#FFFAF2"/></View>
          <Image source={toyAsset.source} contentFit="fill" style={styles.image} pointerEvents="none" />
          <View pointerEvents="none" style={[styles.toyFace,dollFaceRect(toyAsset)]}><PlushieFaceMask asset={toyAsset} edgeOnly
            width={(dollFaceBounds(toyAsset)[2]-dollFaceBounds(toyAsset)[0])*toyArt.width/toyAsset.width}
            height={(dollFaceBounds(toyAsset)[3]-dollFaceBounds(toyAsset)[1])*toyArt.height/toyAsset.height}
            sourceUri={draft?.uri} photo={draft?undefined:photo} imageRect={draftFaceRect}/></View>
        </View>
      </View>:<View style={[styles.preview,kind==='frame'&&!memory&&styles.framePreview]}>{draft ? <Image source={{ uri: draft.uri }} cachePolicy="none" contentFit="cover" style={styles.image} /> : <RoomPhoto photo={photo} memory={!!memory} />}</View>}
      {kind === 'doll' && toyPhotoChangedToday(data, toyId, ownerId) && <Text style={styles.copy}>Today’s photo change for this toy is used. Other toys have their own photos.</Text>}
      {kind==='doll'&&draft&&!draft.submitted&&<View style={styles.row}><Button label="− Zoom" disabled={busy} onPress={()=>zoom(-1)}/><Button label="+ Zoom" disabled={busy} onPress={()=>zoom(1)}/></View>}
      {error && <Text accessibilityRole="alert" style={styles.copy}>{error}</Text>}
      {canEdit && <View style={styles.row}>{(memory||kind==='frame')&&<Button label="Photo library" disabled={busy} onPress={() => void choose(false)} />}<Button label="Camera" disabled={busy} onPress={() => void choose(true)} /></View>}
      {draft && <><Text style={styles.copy}>Draft kept on this device. Review and tap Save to send; closing the app does not upload it. Signing out removes local drafts.</Text>
        <Button label={busy && (memory || kind==='doll') ? 'Saving…' : 'Save / retry photo'} disabled={busy || (!canEdit&&!draft.submitted)} onPress={() => void save()} />
        <Button label="Discard local photo draft" disabled={busy} onPress={()=>Alert.alert('Discard this local draft?','This will not undo a photo that the server already saved.',[{text:'Keep',style:'cancel'},{text:'Discard',style:'destructive',onPress:()=>{try{removePhotoDraft(scope,target,draft.key);setDraft(null);}catch{setError('Could not remove the draft. Please try again.');}}}])}/></>}
      {memory && photo && canEdit && !draft && <Button label="Delete photo" disabled={busy} onPress={() => Alert.alert('Delete this photo?', 'It will disappear from this memory for both of you. Your words stay saved.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} />}
      <Button label={draft ? 'Close · keep draft' : 'Close'} disabled={busy} onPress={onClose} />
    </ScrollView></View>;
  // Never mount the legacy preview/confirmation sheet for the direct Plushie
  // flow, including while the system photo library is being presented.
  if (captureOnly && !cameraOpen) return <>
    {pendingToyAsset&&toyAsset&&<PlushiePhotoCropper asset={pendingToyAsset} toy={toyAsset} onCancel={()=>{setPendingToyAsset(null);onClose();}} onConfirm={async crop=>{
      if(!current()||operationInFlight.current)return;
      operationInFlight.current=true;setLibraryProcessing(true);
      try{await uploadRoomPhoto(data,ownerId,kind,pendingToyAsset,crop,toyId);if(current()){setPendingToyAsset(null);onSaved?.();onClose();}}
      catch(failure){if(current()){setPendingToyAsset(null);recoverDirectPhoto(failure);}}
      finally{operationInFlight.current=false;if(current())setLibraryProcessing(false);}
    }}/>}
    {libraryProcessing && <View style={styles.directPhotoProgress} accessibilityRole="progressbar" accessibilityLabel="Saving photo"><ActivityIndicator color="#553521" /></View>}
    {(error || draft) && !libraryProcessing && <View style={[StyleSheet.absoluteFillObject,styles.scrim]}>
      <View style={styles.retrySheet}>
        <Text style={styles.title}>Save your photo</Text>
        <Text accessibilityRole="alert" style={styles.copy}>{error ?? 'Your previous photo upload did not finish. Retry to save it.'}</Text>
        {draft ? <Button label={busy?'Saving…':'Retry saving photo'} disabled={busy} onPress={()=>void save()}/>
          : <Button label="Try again" disabled={busy} onPress={()=>void choose(initialSource==='camera')}/>}
        <Button label="Close" disabled={busy} onPress={onClose}/>
      </View>
    </View>}
  </>;
  return <>{embedded ? content : <Modal transparent presentationStyle="overFullScreen" animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>{content}</Modal>}
    {pendingToyAsset&&toyAsset&&<PlushiePhotoCropper asset={pendingToyAsset} toy={toyAsset} onCancel={()=>setPendingToyAsset(null)} onConfirm={async crop=>{await preparePhoto(pendingToyAsset.uri,pendingToyAsset.width,pendingToyAsset.height,crop);setPendingToyAsset(null);}}/>}
    {pendingFrameAsset&&<FramePhotoCropper asset={pendingFrameAsset} onCancel={()=>setPendingFrameAsset(null)}
      onConfirm={async crop=>{await preparePhoto(pendingFrameAsset.uri,pendingFrameAsset.width,pendingFrameAsset.height,crop);setPendingFrameAsset(null);}}/>}</>;
}
function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: .4 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#21130CCC', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '88%', flexGrow: 0, borderRadius: 28, backgroundColor: '#FFF4E1' },
  title: { fontSize: 23, fontWeight: '800', color: '#553521' }, copy: { color: '#79563E', fontSize: 14, lineHeight: 21 },
  preview: { width: 180, height: 180, alignSelf: 'center', overflow: 'hidden', borderRadius: 14, backgroundColor: '#E8C8A0' },
  framePreview: { height: 180 / FRAME_PHOTO_ASPECT },
  image: { width: '100%', height: '100%' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, row: { flexDirection: 'row', gap: 12 },
  button: { flexGrow: 1, borderRadius: 16, backgroundColor: '#2F8D72', padding: 14, alignItems: 'center' }, buttonText: { color: '#FFF4E1', fontWeight: '700' },
  embedded:{flex:1,width:'100%',backgroundColor:'#FFFAF2'},embeddedSheet:{flex:1,width:'100%',backgroundColor:'#FFFAF2'},
  toyPreview:{alignSelf:'center',position:'relative'},toyArt:{position:'absolute'},toyFace:{position:'absolute',overflow:'hidden'},
  cameraPage:{flex:1,backgroundColor:'#17120E',justifyContent:'space-between',alignItems:'center'},
  cameraHeader:{width:'100%',paddingTop:58,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  cameraTitle:{color:'#FFF',fontWeight:'800',fontSize:22,textAlign:'center'},
  cameraActions:{position:'absolute',left:0,right:0,bottom:0,paddingHorizontal:24,paddingBottom:60,flexDirection:'row',alignItems:'center',justifyContent:'center'},
  directPhotoProgress:{...StyleSheet.absoluteFillObject,alignItems:'center',justifyContent:'center',backgroundColor:'#21130C33'},
  retrySheet:{width:'100%',maxWidth:520,padding:22,gap:14,borderRadius:28,backgroundColor:'#FFF4E1'},
  shutter:{width:82,height:82,borderWidth:4,borderColor:'#FFF',borderRadius:41,alignItems:'center',justifyContent:'center'},
  shutterPressed:{backgroundColor:'#FFF9F0',transform:[{scale:.91}]},
  shutterInner:{width:64,height:64,borderRadius:32,backgroundColor:'#FFF'},
  cameraProcessing:{position:'absolute',left:20,right:20,top:'47%',paddingVertical:24,paddingHorizontal:22,borderRadius:24,alignItems:'center',gap:10,backgroundColor:'rgba(39,24,18,.84)'},
  cameraProcessingTitle:{color:'#FFF',fontSize:20,fontWeight:'800',textAlign:'center'},
  cameraProcessingHint:{color:'#F4E8DF',fontSize:14,textAlign:'center',lineHeight:20},
});
