import { useSyncExternalStore } from 'react';
import { createAudioPlayer } from 'expo-audio';
import { loadSurpriseMedia, type Surprise } from './surprise-api';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { prepareBurrowImages } from './prepared-burrow-images';
import { SURPRISE_FRAME_OPTIONS } from './surprise-frame-assets';
import { clearSurpriseMediaScope, invalidateSurpriseMedia, pinSurpriseMedia, rememberSurprisePortrait, type SurpriseMedia } from './surprise-media-cache';
import { renderSurprisePortrait } from './surprise-portrait-renderer';

export const SURPRISE_STARTUP_WINDOW_MS=5000;
type NativePlayer=ReturnType<typeof createAudioPlayer>;
type WarmAudio={player:NativePlayer;users:number;retired:boolean};
type Prepared={item:Surprise;media:SurpriseMedia;audio?:WarmAudio};
const ready=new Map<string,Prepared>(),flights=new Map<string,Promise<Prepared>>();
const listeners=new Set<()=>void>();let scope='',generation=0,revision=0;
const emit=()=>{revision++;listeners.forEach(fn=>fn());};
function retire(audio:WarmAudio|undefined){if(!audio)return;audio.retired=true;try{audio.player.pause();}catch{}if(!audio.users)try{audio.player.remove();}catch{}}
/** A leased player survives cache eviction until its view unsubscribes. It is
 * already loaded at Receive, rather than throwing away the validation player
 * and making the route construct/decode the same clip again. */
export function acquirePreparedSurpriseAudio(expected:string,id:string){
  const audio=preparedSurprise(expected,id)?.audio;if(!audio||audio.retired)return undefined;
  audio.users++;let released=false;
  return{player:audio.player,release(){if(released)return;released=true;audio.users--;
    if(!audio.users){try{audio.player.pause();}catch{}if(audio.retired)try{audio.player.remove();}catch{}}
  }};
}
export function useSurprisePreparation(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>revision,()=>revision);}
export function setSurprisePreparationScope(next:string){
  if(next===scope)return;
  const previous=scope;scope=next;generation++;for(const row of ready.values())retire(row.audio);ready.clear();emit();
  if(previous){const [user,,pair]=previous.split(':');void clearSurpriseMediaScope(user,pair).catch(()=>{});}
}
export const preparedSurprise=(expected:string,id:string)=>scope===expected?ready.get(id):undefined;
/** Decode without playing or stealing audio focus. A truncated/unplayable file
 * must never produce a Receive prompt followed by an empty surprise. */
export async function inspectSurpriseAudio(uri:string):Promise<number>{
  const player=createAudioPlayer(uri,{keepAudioSessionActive:false});
  try{return await audioDuration(player);}finally{try{player.remove();}catch{}}
}
async function audioDuration(player:NativePlayer):Promise<number>{
    return await new Promise<number>((resolve,reject)=>{
      let listener:{remove:()=>void}|undefined,settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);listener?.remove();error?reject(error):resolve(Math.round(player.duration*1000));};
      const timer=setTimeout(()=>finish(Error('audio_not_ready')),4000);
      listener=player.addListener('playbackStatusUpdate',status=>{
        if(status.playbackState==='error')finish(Error('audio_invalid'));
        else if(status.isLoaded&&status.duration>0)finish();
      });
      if(player.isLoaded&&player.duration>0)finish();
    });
}
export function prepareSurprise(expected:string,item:Surprise):Promise<Prepared>{
  if(expected!==scope)return Promise.reject(Error('pair_changed'));
  const cached=ready.get(item.id);if(cached?.audio&&!cached.audio.retired)return Promise.resolve(cached);
  const token=`${expected}:${item.id}`;const pending=flights.get(token);if(pending)return pending;
  const [user,,pair]=expected.split(':'),own=generation,epoch=sessionEpoch();
  const unpin=pinSurpriseMedia(user,pair,item.id);
  const task=(async()=>{
    const media=cached?.media??await loadSurpriseMedia(user,pair,item.id);
    const frame=SURPRISE_FRAME_OPTIONS.find(f=>f.id===item.frame);
    let portraitUri:string|undefined;const audio:WarmAudio={player:createAudioPlayer(media.audioUrl,{updateInterval:100,keepAudioSessionActive:false}),users:0,retired:false};
    let retained=false;
    try{
      [portraitUri]=await Promise.all([media.portraitUri??renderSurprisePortrait(item.frame,media.photoUrl,()=>own===generation),audioDuration(audio.player)]);
      if(frame&&!portraitUri)throw Error('portrait_not_ready');
      await prepareBurrowImages(portraitUri?[{uri:portraitUri}]:[{uri:media.photoUrl},...(frame?[frame.source]:[])],512);
    if(own!==generation||epoch!==sessionEpoch()||scope!==expected)throw Error('pair_changed');
    if(portraitUri){media.portraitUri=portraitUri;void rememberSurprisePortrait(user,pair,item.id).catch(()=>{});}
    const result={item,media,audio};ready.delete(item.id);ready.set(item.id,result);retained=true;
    // Native decoded images already have their own bounded shared cache.
    while(ready.size>12){const oldest=ready.keys().next().value!;retire(ready.get(oldest)?.audio);ready.delete(oldest);}
    let idle=[...ready.values()].filter(row=>row.audio&&!row.audio.users)
      .sort((a,b)=>Number(a.item.recipient_id===user&&!a.item.opened_at)-Number(b.item.recipient_id===user&&!b.item.opened_at));
    while(idle.length>3){const row=idle.shift()!;retire(row.audio);row.audio=undefined;}
    emit();return result;
    }finally{if(!retained)retire(audio);}
  })().catch(async error=>{
    if(['audio_invalid','audio_not_ready'].includes(error?.message)&&own===generation)await invalidateSurpriseMedia(user,pair,item.id).catch(()=>{});
    throw error;
  }).finally(()=>{unpin();if(flights.get(token)===task)flights.delete(token);});
  flights.set(token,task);return task;
}
subscribeSessionIdentity(()=>{scope='';generation++;for(const row of ready.values())retire(row.audio);ready.clear();flights.clear();emit();});
