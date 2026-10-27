import {useSyncExternalStore} from 'react';
import {storage} from './storage';
import {kOnboardingAnnouncementPending} from '../shared/storage/keys';
import {prepareUnreadAnnouncement,type Announcement} from './announcements-api';
import {sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {registerOverlay} from './overlay-presence';
import {homeEntryRemainingMs} from './home-entry-readiness';

type Entry={phase:'idle'|'checking'|'ready';userId:string|null;announcement:Announcement|null};
const idle:Entry={phase:'idle',userId:null,announcement:null};
let state=idle,generation=0,release:(()=>void)|undefined;
const listeners=new Set<()=>void>();
function publish(next:Entry){state=next;listeners.forEach(fn=>fn());}
export function clearOnboardingAnnouncementPending(){storage.remove(kOnboardingAnnouncementPending.name);}
export function closeOnboardingAnnouncement(){
 generation++;const old=release;release=undefined;publish(idle);
 // Cover disappears before another automatic popup can acquire presentation.
 requestAnimationFrame(()=>old?.());
}
subscribeSessionIdentity(()=>{if(state.userId&&state.userId!==sessionUserId())closeOnboardingAnnouncement();});
/** Called only when the first Home is mounted, after purchased-account linking
 * and onboarding auth handoffs. Never cover the camera/paywall/connect steps. */
export function beginOnboardingAnnouncement(){
 const userId=sessionUserId();
 if(!userId||state.phase!=='idle'||storage.getString(kOnboardingAnnouncementPending.name)!=='true')return;
 const epoch=++generation;
 release=registerOverlay({});publish({phase:'checking',userId,announcement:null});
 let timer:ReturnType<typeof setTimeout>|undefined;
 void (async()=>{
  let announcement:Announcement|null=null;
  try{
   clearOnboardingAnnouncementPending();
   announcement=await Promise.race([prepareUnreadAnnouncement(userId).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),Math.min(2500,homeEntryRemainingMs()));})]);
  }catch{/* Remote/local failure cannot trap first Home or expose a late popup. */}
  finally{if(timer!==undefined)clearTimeout(timer);}
  if(epoch!==generation||sessionUserId()!==userId)return;
  if(announcement)publish({phase:'ready',userId,announcement});else closeOnboardingAnnouncement();
 })();
}
export function useOnboardingAnnouncementEntry(){
 return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>state,()=>idle);
}
