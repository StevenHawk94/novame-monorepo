import { useEffect, useLayoutEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { createBurrowSync } from '@/lib/burrow-sync-controller';
import { burrowClock, invalidateBurrowPair, getBurrowSnapshot, refreshBurrowAfterCurrent, useBurrowSnapshot } from '@/lib/burrow-store';
import { recoverMemoryJobs, readMemoryLocal, subscribeMemoryLocal, subscribeMemoryRetry } from '@/lib/burrow-memory-local';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { fetchFriends, fetchPairing, getCachedFriends, getCachedPairing, invalidatePairingCache, subscribePairingStatus } from '@/lib/friends-api';
import { configureAvatarPairRole } from '@/lib/avatar';
import { releaseRoomScope } from '@/lib/release-room-api';
import { afterUiSettles } from '@/lib/ui-idle';
import { notifyGameRoomChanged } from '@/lib/burrow-game-room-cache';
import { prewarmBurrowPages } from '@/lib/burrow-foreground-prewarm';
import { useHomeEntry } from '@/lib/use-home-entry';
import { notifySurpriseChanged } from '@/lib/surprise-inbox';
import { friendVisitLocal, warmFriendVisit } from '@/lib/friend-visit-local';
import { prepareBurrowNotifications } from '@/lib/burrow-notification-preparation';
import { notificationReadiness } from '@/lib/notification-readiness';
import { notificationContentVersion, notificationScope } from '@/lib/notification-content-version';
import {observeBunnyIdentity,syncBunnyIdentity} from '@/lib/bunny-identity';
import {pauseAdventureNudges,resumeAdventureNudges} from '@/lib/adventure-nudge';
import {notifyPlushieTouchSignal} from '@/lib/plushie-touch-signals';

export function BurrowSyncGate() {
  const enabled=useMajorUpdateEnabled();
  const {data}=useBurrowSnapshot();
  const {pending:entering}=useHomeEntry();
  const scope=data?releaseRoomScope(data):'';
  useLayoutEffect(()=>{if(enabled&&data?.bunnyIdentity)observeBunnyIdentity(data.bunnyIdentity);},[enabled,data?.bunnyIdentity]);
  useEffect(()=>{
    if(!enabled||!data?.profile.id)return;
    const sync=()=>{if(AppState.currentState==='active')void syncBunnyIdentity(true).catch(()=>{});};
    sync();const app=AppState.addEventListener('change',sync);return()=>app.remove();
  },[enabled,data?.profile.id]);
  useLayoutEffect(()=>{
    if(!enabled||!data)return;
    const sync=(status:ReturnType<typeof getCachedPairing>)=>configureAvatarPairRole(data.profile.id,data.partner?.id,
      status?.paired&&status.partner?.userId===data.partner?.id?status.initiatorId:null);
    sync(getCachedPairing());
    return subscribePairingStatus(sync);
  },[enabled,scope]);
  const visit=data?.friendVisit?.version===2?data.friendVisit:null;
  const contentVersion=useMemo(()=>data?JSON.stringify((['games','journal','letters','moments','visits','adventure','gifts'] as const).map(kind=>notificationContentVersion(data,kind))):'',
    [data?.attention,data?.moments,data?.memoryEntries,data?.localDate,data?.profile.timezone_name,data?.friendVisit,data?.activeAdventure,data?.adventureResult,data?.adventurePlan,data?.gifts,data?.catalog,data?.giftCatalog,data?.partner?.display_name]);
  useEffect(()=>{
    if(!enabled||!data){notificationReadiness.reset();return;}
    const ownerScope=notificationScope(data);
    // Essential notification I/O starts ahead of optional artwork/catalogue
    // jobs. No screen needs to mount and no click waits on this scheduler.
    const warm=()=>{const latest=getBurrowSnapshot().data;
      if(AppState.currentState==='active'&&latest&&notificationScope(latest)===ownerScope)void prepareBurrowNotifications(latest);
    };
    let retry:ReturnType<typeof setInterval>|undefined;
    const activate=(state:string)=>{if(retry)clearInterval(retry);retry=undefined;
      if(state==='active'){warm();retry=setInterval(warm,3000);}
    };
    activate(AppState.currentState);
    const app=AppState.addEventListener('change',activate);
    const identity=subscribeSessionIdentity(()=>notificationReadiness.reset());
    // Registry backoff bounds failed reads; ready revisions are no-ops.
    return()=>{clearInterval(retry);app.remove();identity();};
  },[enabled,scope,contentVersion,data?.pairAccessVerified]);
  useEffect(()=>{
    if(!enabled||!data||entering)return;
    const warm=()=>{void friendVisitLocal.resume();if(visit)void warmFriendVisit(data).catch(()=>{});};
    if(AppState.currentState==='active')warm();
    const app=AppState.addEventListener('change',state=>{if(state==='active')warm();else friendVisitLocal.pause();});
    return()=>app.remove();
  },[enabled,entering,scope,visit?.id,visit?.myCompleted,visit?.partnerCompleted,data?.pairAccessVerified]);
  useEffect(()=>{
    if(!enabled||entering||!data?.catalogComplete)return;
    let cancel=prewarmBurrowPages();
    const app=AppState.addEventListener('change',state=>{cancel();if(state==='active')cancel=prewarmBurrowPages();});
    return()=>{cancel();app.remove();};
  },[enabled,entering,scope,data?.localDate,data?.hasPlus,data?.catalogComplete,data?.catalog]);
  useEffect(()=>{
    if(!enabled||!data)return;
    return afterUiSettles(()=>{
      if(!getCachedFriends().inviteCode)void fetchFriends().catch(()=>{});
    },{delayMs:400});
  },[enabled,scope,data?.localDate,data?.hasPlus,data?.catalogComplete]);
  useEffect(()=>{
    if(!enabled)return;
    let live=true;
    const controller=createBurrowSync({
      now:burrowClock,
      session:async()=>{const {data}=await supabase.auth.getSession();return data.session?{userId:data.session.user.id,token:data.session.access_token}:null;},
      connect:async(session,onChange,onStatus)=>{
        await supabase.realtime.setAuth(session.token);
        const channel=supabase.channel(`burrow:${session.userId}`,{config:{private:true}})
          .on('broadcast',{event:'burrow_changed'},()=>{notifyGameRoomChanged(session.userId);onChange(false);})
          .on('broadcast',{event:'pair_changed'},()=>onChange(true))
          .on('broadcast',{event:'bunny_changed'},()=>onChange(false))
          .on('broadcast',{event:'adventure_changed'},()=>onChange(false))
          .on('broadcast',{event:'surprise_changed'},()=>notifySurpriseChanged())
          .on('broadcast',{event:'plushie_touch_changed'},()=>notifyPlushieTouchSignal(session.userId))
          .subscribe(status=>{if(status==='SUBSCRIBED'){onStatus(true);notifyPlushieTouchSignal(session.userId);}else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))onStatus(false);});
        return {close:async()=>{await supabase.removeChannel(channel);}};
      },
      invalidatePair:()=>{invalidateBurrowPair({retainSolo:true});invalidatePairingCache();},
      refresh:async after=>{
        const epoch=sessionEpoch();
        const previous=getBurrowSnapshot().data;
        const previouslyPaired=!!getBurrowSnapshot().data?.partner||!!getCachedPairing()?.paired;
        await refreshBurrowAfterCurrent({after});
        if(!live||AppState.currentState!=='active'||epoch!==sessionEpoch())return true;
        const snap=getBurrowSnapshot();
        const syncError = snap.syncError ?? snap.error;
        if(syncError){
          if(previouslyPaired&&syncError==='not_paired')invalidatePairingCache();
          return ['not_paired','feature_disabled'].includes(syncError);
        }
        // Foreground/reconnect reads recover notifications missed while the
        // partner's device was offline. Clear the legacy date/TTL cache too.
        if(!snap.data?.partner){if(snap.data&&previouslyPaired)invalidatePairingCache();return true;}
        if(previous&&(previous.partner?.id!==snap.data.partner.id||previous.pairVersion!==snap.data.pairVersion)){
          invalidatePairingCache();
          void fetchPairing({force:true}).catch(()=>{}); // refresh Menu date, never block room entry
        }
        const scope={userId:snap.data.profile.id,partnerId:snap.data.partner.id,pairVersion:snap.data.pairVersion};
        const count=readMemoryLocal(scope).jobs.filter(j=>!j.blocked).length;
        const ok=await recoverMemoryJobs(scope);
        if(count&&live&&epoch===sessionEpoch())await refreshBurrowAfterCurrent({ after: burrowClock() });
        return ok;
      },
    });
    if(AppState.currentState==='active'){controller.start();void resumeAdventureNudges();}
    const app=AppState.addEventListener('change',state=>{if(state==='active'){controller.start();void resumeAdventureNudges();}else{controller.stop();pauseAdventureNudges();}});
    // Only queue count changes request a drain; keystrokes stay local.
    let pending='';
    const local=subscribeMemoryLocal(()=>{
      const data=getBurrowSnapshot().data;if(!data?.partner)return;
      try{const next=readMemoryLocal({userId:data.profile.id,partnerId:data.partner.id,pairVersion:data.pairVersion}).jobs.filter(j=>!j.blocked).map(j=>j.id).join(',');
        if(next!==pending){pending=next;if(next)controller.request(0);}}catch{}
    });
    // Store identity handling already drops old state and restores only the
    // new owner's snapshot. Do not erase that restored cache a second time.
    const identity=subscribeSessionIdentity(()=>{controller.stop();setTimeout(()=>{if(live&&AppState.currentState==='active')controller.start();},0);});
    const retry=subscribeMemoryRetry(()=>controller.request(0));
    const auth=supabase.auth.onAuthStateChange(event=>{if(event==='TOKEN_REFRESHED')setTimeout(()=>{if(live&&AppState.currentState==='active')controller.start();},0);});
    return()=>{live=false;controller.stop();app.remove();local();retry();identity();auth.data.subscription.unsubscribe();};
  },[enabled]);
  return null;
}
