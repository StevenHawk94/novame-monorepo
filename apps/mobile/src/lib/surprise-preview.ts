import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import * as FS from 'expo-file-system/legacy';
import { SURPRISE_DEFAULT_FACE, SURPRISE_FRAME_OPTIONS } from './surprise-frame-assets';
import { renderSurprisePortrait } from './surprise-portrait-renderer';
import { prepareBurrowImages } from './prepared-burrow-images';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { afterUiSettles } from './ui-idle';

const ready=new Map<string,string>(),flights=new Map<string,Promise<string>>();
const key=(frame:string,photo?:string)=>JSON.stringify([frame,photo??'default']);
const destination=(frame:string,photo?:string)=>photo?`${photo}.preview-${frame}.png`:`${FS.cacheDirectory}surprise-default-${frame}.png`;
/** One composited + decoded bitmap shared by every falling particle. Local
 * files are not assumed decoded; never reveal a border while its face loads. */
export function prepareSurprisePreview(frame:string,photo?:string):Promise<string>{
  if(!/^[a-z_]+$/.test(frame))return Promise.reject(Error('invalid_frame'));
  const token=key(frame,photo),cached=ready.get(token);
  if(cached)return prepareBurrowImages([{uri:cached}],512).then(()=>cached);
  const pending=flights.get(token);if(pending)return pending;
  const epoch=sessionEpoch(),source=photo??Image.resolveAssetSource(SURPRISE_DEFAULT_FACE)?.uri;
  if(!source)return Promise.reject(Error('portrait_not_ready'));
  const task=(async()=>{
    // Historical retired frames remain photo-only; never map them to a
    // different current frame or silently remove their recorded portrait.
    const uri=photo&&!SURPRISE_FRAME_OPTIONS.some(option=>option.id===frame)?photo:
      await renderSurprisePortrait(frame,source,()=>epoch===sessionEpoch(),destination(frame,photo),!photo);
    if(!uri)throw Error('portrait_not_ready');
    await prepareBurrowImages([{uri}],512);
    if(epoch!==sessionEpoch())throw Error('session_changed');
    ready.set(token,uri);while(ready.size>40)ready.delete(ready.keys().next().value!);
    return uri;
  })().finally(()=>{if(flights.get(token)===task)flights.delete(token);});
  flights.set(token,task);return task;
}
export function useSurprisePreview(frame:string,photo?:string,provided?:string,enabled=true){
  const token=key(frame,photo),[result,setResult]=useState<{token:string;uri:string}|null>(null);
  useEffect(()=>{
    if(provided||!enabled)return;let live=true;
    const cancel=afterUiSettles(()=>{
      void prepareSurprisePreview(frame,photo).then(uri=>{if(live)setResult({token,uri});}).catch(()=>{});
    });
    return()=>{live=false;cancel();};
  },[token,provided,enabled]);
  return provided??ready.get(token)??(result?.token===token?result.uri:undefined);
}
export async function releaseSurprisePreview(frame:string,photo?:string){
  if(!photo)return;
  const token=key(frame,photo);ready.delete(token);
  // Finish an in-flight render before removing the disposable derived image.
  await flights.get(token)?.catch(()=>{});
  ready.delete(token);await FS.deleteAsync(destination(frame,photo),{idempotent:true}).catch(()=>{});
}
subscribeSessionIdentity(()=>{ready.clear();flights.clear();});
