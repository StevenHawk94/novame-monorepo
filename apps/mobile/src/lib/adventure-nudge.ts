import {useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {apiClient} from './api';
import {storage} from './storage';
import {kAdventureNudges} from '../shared/storage/keys';
import {sessionEpoch,sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {getBurrowSnapshot} from './burrow-store';
import {showBurrowToast} from './burrow-toast';
type Job={owner:string;partner:string;pair:string;party:string;key:string;state:'queued'|'sent'|'blocked'};
let owner:string|null=null,jobs:Job[]=[],flight:Promise<void>|null=null,timer:ReturnType<typeof setTimeout>|undefined,retries=0;
const listeners=new Set<()=>void>();
function load(){const next=sessionUserId()??null;if(owner===next)return;owner=next;jobs=[];
 try{const rows=JSON.parse(storage.getString(kAdventureNudges.name)??'[]');if(Array.isArray(rows))jobs=rows.filter(j=>j?.owner===owner&&typeof j.key==='string');}catch{}}
function save(next:Job[]){storage.set(kAdventureNudges.name,JSON.stringify(next));jobs=next;for(const fn of listeners)try{fn();}catch{}}
function current(job:Job){const data=getBurrowSnapshot().data;return job.owner===sessionUserId()&&data?.profile.id===job.owner&&data.partner?.id===job.partner&&data.pairVersion===job.pair;}
export function useAdventureNudge(party:string|undefined):Job['state']|'idle'{return useSyncExternalStore<Job['state']|'idle'>(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>{load();return jobs.find(j=>j.party===party&&current(j))?.state??'idle';},()=> 'idle');}
export function queueAdventureNudge(party:string){
 load();const data=getBurrowSnapshot().data;
 if(!data?.partner||!data.pairVersion||data.profile.id!==sessionUserId())throw Error('pair_changed');
 const known=jobs.find(j=>j.party===party&&current(j));if(known&&known.state!=='blocked')return;
 const job:Job={owner:data.profile.id,partner:data.partner.id,pair:data.pairVersion,party,key:randomUUID(),state:'queued'};
 save([...jobs.filter(j=>j!==known),job].slice(-30));void resumeAdventureNudges();
}
export function pauseAdventureNudges(){if(timer)clearTimeout(timer);timer=undefined;}
export function resumeAdventureNudges():Promise<void>{
 if(flight)return flight;load();pauseAdventureNudges();const epoch=sessionEpoch();
 const task=(async()=>{
  for(const job of jobs.filter(j=>j.state==='queued')){
   if(epoch!==sessionEpoch()||AppState.currentState!=='active')return;
   if(!current(job))continue;
   try{
    await apiClient.post('/api/vnext/command',{action:'nudge_adventure',partyId:job.party,idempotencyKey:job.key});
    if(epoch!==sessionEpoch()||!current(job))return;
    save(jobs.map(j=>j.key===job.key?{...j,state:'sent'}:j));retries=0;
   }catch(error){
    if(epoch!==sessionEpoch()||!current(job))return;
    const code=(error as {body?:{error?:string}})?.body?.error;
    if(['not_found','pair_changed','adventure_invite_unavailable','invalid_request','idempotency_conflict'].includes(code??'')){
     save(jobs.map(j=>j.key===job.key?{...j,state:'blocked'}:j));
     // One definitive transition, not a toast on every rerender/recovery.
     showBurrowToast('We couldn’t submit this reminder. Please try again.');
    }
    else {timer=setTimeout(()=>void resumeAdventureNudges(),Math.min(60000,2000*2**Math.min(retries++,5)));return;}
   }
  }
 })().finally(()=>{if(flight===task)flight=null;});flight=task;return task;
}
subscribeSessionIdentity(()=>{pauseAdventureNudges();owner=null;jobs=[];flight=null;retries=0;for(const fn of listeners)try{fn();}catch{}});
