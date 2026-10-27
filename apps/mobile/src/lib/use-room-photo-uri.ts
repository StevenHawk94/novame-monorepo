import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {cachedRoomPhotoUri,invalidateRoomPhotoCache,loadRoomPhoto} from './burrow-room-photo-cache';
import {sessionEpoch,subscribeSessionIdentity} from './session-lifecycle';

type Photo={id:string;updatedAt:string};
/** Shared private-file resolver for native images, SVG faces and Skia. No
 * rendering component imports, per-cell polling or independent media cache. */
export function useRoomPhotoResource(photo?:Photo){
 const key=photo?`${photo.id}:${photo.updatedAt}`:'';
 const [resolved,setResolved]=useState<{key:string;uri:string}|null>(()=>{
  const uri=photo?cachedRoomPhotoUri(photo):null;return uri?{key,uri}:null;
 });
 const [retry,setRetry]=useState(0),failures=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{failures.current=0;return()=>{if(timer.current)clearTimeout(timer.current);};},[key]);
 useFocusEffect(useCallback(()=>{
  if(!photo)return;
  let live=true,request=0;const epoch=sessionEpoch();
  const current=(own:number)=>live&&own===request&&epoch===sessionEpoch();
  const read=()=>{
   const own=++request;if(!photo||AppState.currentState!=='active')return;
   const cached=cachedRoomPhotoUri(photo);if(cached)setResolved({key,uri:cached});
   void loadRoomPhoto(photo).then(uri=>{if(current(own))setResolved({key,uri});}).catch(()=>{
    if(current(own))setResolved(null);
    if(current(own)&&failures.current++<2)timer.current=setTimeout(()=>{timer.current=null;if(current(own))read();},1000*failures.current);
   });
  };
  read();const identity=subscribeSessionIdentity(()=>{request++;setResolved(null);});
  const app=AppState.addEventListener('change',state=>{if(state==='active')read();else request++;});
  return()=>{live=false;request++;identity();app.remove();if(timer.current)clearTimeout(timer.current);timer.current=null;};
 },[key,retry]));
 const onError=()=>{
  if(photo)invalidateRoomPhotoCache(photo);setResolved(null);
  if(failures.current++<2){if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setRetry(n=>n+1),1000*failures.current);}
 };
 return {uri:(resolved?.key===key?resolved.uri:null)??(photo?cachedRoomPhotoUri(photo):null),onError};
}
export function useRoomPhotoUri(photo?:Photo){return useRoomPhotoResource(photo).uri;}
