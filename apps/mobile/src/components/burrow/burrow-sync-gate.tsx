import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { createBurrowSync } from '@/lib/burrow-sync-controller';
import { invalidateBurrowPair, getBurrowSnapshot, refreshBurrowAfterCurrent } from '@/lib/burrow-store';
import { recoverMemoryJobs, readMemoryLocal, subscribeMemoryLocal, subscribeMemoryRetry } from '@/lib/burrow-memory-local';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';

export function BurrowSyncGate() {
  const enabled=useMajorUpdateEnabled();
  useEffect(()=>{
    if(!enabled)return;
    let live=true;
    const controller=createBurrowSync({
      session:async()=>{const {data}=await supabase.auth.getSession();return data.session?{userId:data.session.user.id,token:data.session.access_token}:null;},
      connect:async(session,onChange,onStatus)=>{
        await supabase.realtime.setAuth(session.token);
        const channel=supabase.channel(`burrow:${session.userId}`,{config:{private:true}})
          .on('broadcast',{event:'burrow_changed'},()=>onChange(false))
          .on('broadcast',{event:'pair_changed'},()=>onChange(true))
          .subscribe(status=>{if(status==='SUBSCRIBED')onStatus(true);else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))onStatus(false);});
        return {close:async()=>{await supabase.removeChannel(channel);}};
      },
      invalidatePair:invalidateBurrowPair,
      refresh:async()=>{
        const epoch=sessionEpoch();
        await refreshBurrowAfterCurrent();
        if(!live||AppState.currentState!=='active'||epoch!==sessionEpoch())return true;
        const snap=getBurrowSnapshot();
        if(snap.error)return ['not_paired','feature_disabled'].includes(snap.error);
        if(!snap.data?.partner)return true;
        const scope={userId:snap.data.profile.id,partnerId:snap.data.partner.id};
        const count=readMemoryLocal(scope).jobs.filter(j=>!j.blocked).length;
        const ok=await recoverMemoryJobs(scope);
        if(count&&live&&epoch===sessionEpoch())await refreshBurrowAfterCurrent();
        return ok;
      },
    });
    if(AppState.currentState==='active')controller.start();
    const app=AppState.addEventListener('change',state=>{if(state==='active')controller.start();else controller.stop();});
    // Only queue count changes request a drain; keystrokes stay local.
    let pending='';
    const local=subscribeMemoryLocal(()=>{
      const data=getBurrowSnapshot().data;if(!data?.partner)return;
      try{const next=readMemoryLocal({userId:data.profile.id,partnerId:data.partner.id}).jobs.filter(j=>!j.blocked).map(j=>j.id).join(',');
        if(next!==pending){pending=next;if(next)controller.request(0);}}catch{}
    });
    const identity=subscribeSessionIdentity(()=>{controller.stop();invalidateBurrowPair();});
    const retry=subscribeMemoryRetry(()=>controller.request(0));
    const auth=supabase.auth.onAuthStateChange(event=>{if(event==='TOKEN_REFRESHED')setTimeout(()=>{if(live&&AppState.currentState==='active')controller.start();},0);});
    return()=>{live=false;controller.stop();app.remove();local();retry();identity();auth.data.subscription.unsubscribe();};
  },[enabled]);
  return null;
}
