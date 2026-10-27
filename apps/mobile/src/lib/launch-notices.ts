import {checkForceUpdate, type ForceUpdateResult} from './force-update';
import {prepareUnreadAnnouncement, type Announcement} from './announcements-api';
import {getCurrentSession} from './auth';
import {hasSeenIntro} from './onboarding';
import {clearOnboardingAnnouncementPending} from './onboarding-announcement-entry';

export type LaunchNotices={update:ForceUpdateResult;announcement:Announcement|null;userId:string|null};
/** Deadlines bound the whole operation, including adapters which ignore AbortSignal.
 * Late work may populate caches, but can never inject a popup into an active app. */
export async function launchDeadline<T>(work:Promise<T>,ms:number,fallback:T):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work.catch(()=>fallback),new Promise<T>(resolve=>{timer=setTimeout(()=>resolve(fallback),ms);})]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function prepareLaunchNotices():Promise<LaunchNotices>{
 const update=await launchDeadline(checkForceUpdate(),4200,{required:false,message:null});
 // Never fetch/display/acknowledge announcements for a blocked install.
 if(update.required)return {update,announcement:null,userId:null};
 const session=await launchDeadline(getCurrentSession(),1200,null);
 const userId=session?.user?.id??null;
 const eligible=!!userId&&(!(session?.user as {is_anonymous?:boolean})?.is_anonymous||hasSeenIntro());
 // A restored completed onboarding uses this cold-start check, not a second
 // first-Home query. Blocked installs leave the handoff flag untouched.
 if(eligible)clearOnboardingAnnouncementPending();
 const announcement=eligible?await launchDeadline(prepareUnreadAnnouncement(userId!),2500,null):null;
 return {update,announcement,userId};
}
