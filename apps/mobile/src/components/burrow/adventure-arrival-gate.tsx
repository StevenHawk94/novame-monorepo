import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { burrowClock, cacheAdventureDisplay, projectBurrowAdventureArrival, refreshBurrowAfterCurrent, useBurrowSnapshot } from '@/lib/burrow-store';
import { fetchAdventureDisplay, settleAdventure } from '@/lib/app-major-update-api';
import { pauseAdventureJournalJobs, resumeAdventureJournalJobs, restoreAdventureJournalProjection } from '@/lib/adventure-journal-jobs';
import { pauseAdventureDelivery, resumeAdventureDelivery } from '@/lib/adventure-delivery';
import { warmAdventureCompletion } from '@/lib/adventure-prefetch';
import { sessionEpoch } from '@/lib/session-lifecycle';

/** Refresh arrivals in the background; the Home badge is the only entry intent. */
export function AdventureArrivalGate() {
  const enabled=useMajorUpdateEnabled();
  const {data,receivedAt}=useBurrowSnapshot();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  useEffect(()=>{
    if(!enabled)return;
    let backgrounded=AppState.currentState!=='active';
    if(!backgrounded)void refreshBurrowAfterCurrent();
    const app=AppState.addEventListener('change',state=>{
      setForeground(state==='active');
      if(state==='background'){backgrounded=true;pauseAdventureDelivery();pauseAdventureJournalJobs();}
      else if(state==='active'&&backgrounded){backgrounded=false;void refreshBurrowAfterCurrent({after:burrowClock()});}
    });
    return()=>app.remove();
  },[enabled]);
  useEffect(() => {
    if (enabled && foreground && data) { void warmAdventureCompletion(data).catch(()=>{}); void resumeAdventureDelivery();
      restoreAdventureJournalProjection(); void resumeAdventureJournalJobs(); }
  }, [enabled, foreground, data?.profile.id, data?.partner?.id, data?.pairVersion, data?.localDate, data?.activeAdventure?.id, data?.adventureResult?.id,
    data?.adventureResult?.metadata?.encounterV2, data?.adventureResult?.metadata?.treasureSnapshot?.stable_id, data?.adventureResult?.metadata?.treasureCoins, data?.adventurePlan?.version]);
  useEffect(() => {
    const a = data?.activeAdventure;
    if (!enabled || !foreground || a?.status !== 'in_progress' || a.id.startsWith('pending:')
      || data?.adventurePlan?.adventureId === a.id || data?.adventureResult?.metadata?.encounterV2) return;
    let live = true, timer: ReturnType<typeof setTimeout>, attempt = 0;
    const epoch = sessionEpoch();
    const prepare = async () => {
      try {
        const display = await fetchAdventureDisplay(a.id);
        if (live && epoch === sessionEpoch()) cacheAdventureDisplay(display);
      } catch { /* Retry only this small personal plan, not the whole catalogue. */ }
      if (live && epoch === sessionEpoch()) timer = setTimeout(() => { void prepare(); }, Math.min(15_000, 1_000 * 2 ** Math.min(attempt++, 4)));
    };
    void prepare();
    return () => { live = false; clearTimeout(timer); };
  }, [enabled, foreground, data?.profile.id, data?.partner?.id, data?.pairVersion,
    data?.activeAdventure?.id, data?.activeAdventure?.status, data?.adventurePlan?.adventureId, data?.adventureResult?.metadata?.encounterV2]);
  useEffect(()=>{
    const adventure=data?.activeAdventure;
    if(!enabled||!foreground||adventure?.status!=='in_progress'||adventure.localStartPending||adventure.id.startsWith('pending:'))return;
    const serverNow=Date.parse(data!.serverNow)+Math.max(0,burrowClock()-receivedAt);
    const delay=Date.parse(adventure.ends_at)-serverNow;
    if(!Number.isFinite(delay))return;
    let live=true, timer:ReturnType<typeof setTimeout>;
    const arrive=async()=>{
      if(!live)return;
      const epoch=sessionEpoch();
      projectBurrowAdventureArrival(adventure.id);
      try { await settleAdventure(adventure.id); } catch { /* Bootstrap also settles; retry silently if offline. */ }
      if(epoch!==sessionEpoch())return;
      await refreshBurrowAfterCurrent({silent:true,after:burrowClock()});
      if(live)timer=setTimeout(()=>{void arrive();},2000);
    };
    timer=setTimeout(()=>{void arrive();},Math.max(0,Math.min(delay,2_147_483_647)));
    return()=>{live=false;clearTimeout(timer);};
  },[enabled,foreground,data?.activeAdventure?.id,data?.activeAdventure?.status,data?.activeAdventure?.ends_at,data?.activeAdventure?.localStartPending,receivedAt]);
  return null;
}
