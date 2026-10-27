import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useBurrowSnapshot } from '@/lib/burrow-store';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { useSurpriseInbox, refreshSurpriseInbox, subscribeSurpriseRefresh } from '@/lib/surprise-inbox';
import { type Surprise } from '@/lib/surprise-api';
import { withDeadline } from '@/lib/async-lifecycle';
import { prepareSurprise, preparedSurprise, setSurprisePreparationScope, useSurprisePreparation, SURPRISE_STARTUP_WINDOW_MS } from '@/lib/surprise-preparation';
import { setSurpriseDeliveryContext, resumeSurpriseOutbox } from '@/lib/surprise-send-queue';
import { useHomeEntry } from '@/lib/use-home-entry';
import { registerOverlay, useOverlayPresent } from '@/lib/overlay-presence';
import { useMajorUpdateEnabled } from '@/lib/use-major-update';
import { SurpriseAction, SurpriseCard, SurpriseGiftbox } from './surprise-composer-ui';
const oldestFirst=(a:Surprise,b:Surprise)=>Date.parse(a.sent_at)-Date.parse(b.sent_at)||a.id.localeCompare(b.id);

/** Start under the launch cover. Five seconds is a soft warmup budget, never
 * an extra Home readiness condition or a cancellation of background downloads. */
export function SurpriseArrivalGate(){
  const enabled=useMajorUpdateEnabled();const {data,busy}=useBurrowSnapshot();const entry=useHomeEntry();
  const segments=useSegments();const overlay=useOverlayPresent();const items=useSurpriseInbox();
  const [prompt,setPrompt]=useState<Surprise|null>(null);const [active,setActive]=useState(AppState.currentState==='active');
  const preparationVersion=useSurprisePreparation();
  const dismissed=useRef(new Set<string>());const owner=useRef({});const dismissalScope=useRef('');
  const opening=useRef(false);
  const scope=data?.partner&&data?.pairVersion?`${data.profile.id}:${data.partner.id}:${data.pairVersion}`:'';
  const tabIndex=segments.findIndex(segment=>segment==='(tabs)');
  const onHome=tabIndex>=0&&(!segments[tabIndex+1]||String(segments[tabIndex+1])==='index');
  const verified=!!data?.pairAccessVerified;
  const visible=!!prompt&&!!preparedSurprise(scope,prompt.id)&&active&&onHome&&!entry.pending&&verified;
  useEffect(()=>{if(dismissalScope.current!==scope){dismissalScope.current=scope;dismissed.current.clear();}setPrompt(null);
    setActive(AppState.currentState==='active');
    // A temporary verification refresh must not revoke/delete this same pair's
    // archive. Network work and presentation still require verified access.
    setSurprisePreparationScope(enabled?scope:'');
    setSurpriseDeliveryContext(enabled&&data?.partner&&data.pairVersion?{userId:data.profile.id,partnerId:data.partner.id,pairVersion:data.pairVersion,verified}:null);
    if(!enabled||!scope||!verified)return;
    let live=true,failures=0,retry:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{if(live&&AppState.currentState==='active'){
      if(retry)clearTimeout(retry);retry=undefined;
      void resumeSurpriseOutbox();
      void refreshSurpriseInbox(scope).then(()=>{failures=0;},()=>{
        if(!live||AppState.currentState!=='active')return;
        if(retry)clearTimeout(retry);
        retry=setTimeout(refresh,Math.min(30000,2000*2**Math.min(failures++,4)));
      });
    }};refresh();
    // The main Burrow channel forwards these invalidations without a duplicate socket.
    const notified=subscribeSurpriseRefresh(refresh);
    const sub=AppState.addEventListener('change',state=>{setActive(state==='active');if(state==='active')refresh();});
    const timer=setInterval(refresh,60000);return()=>{live=false;if(retry)clearTimeout(retry);sub.remove();notified();clearInterval(timer);};
  },[enabled,scope,verified]);
  useLayoutEffect(()=>visible?registerOverlay(owner.current):undefined,[visible]);
  useEffect(()=>{
    if(!enabled||!scope||!verified||!active)return;
    let live=true;
    const warm=async()=>{
      const unopened=items.filter(x=>x.recipient_id===data.profile.id&&!x.opened_at&&!dismissed.current.has(x.id)).sort(oldestFirst).slice(0,3);
      const recent=items.filter(x=>!unopened.some(row=>row.id===x.id)).slice(0,2);
      // Bound concurrency, but do not let one slow/corrupt gift prevent a
      // different already-downloadable gift from becoming ready in this window.
      await Promise.all(unopened.map(item=>prepareSurprise(scope,item).catch(()=>{})));
      for(const item of recent){if(!live)return;await prepareSurprise(scope,item).catch(()=>{});}
    };
    // The Promise continues after this soft deadline. Home never awaits it.
    void withDeadline(warm(),SURPRISE_STARTUP_WINDOW_MS).catch(()=>{});
    const retry=setInterval(()=>void warm(),15000);
    return()=>{live=false;clearInterval(retry);};
  },[enabled,scope,verified,active,items,prompt?.id]);
  useEffect(()=>{
    if(!onHome)opening.current=false;
    if(prompt||opening.current||!enabled||!scope||!verified||!data?.catalogComplete||!active||!onHome||entry.pending||overlay||busy)return;
    const next=[...items].sort(oldestFirst).find(item=>item.recipient_id===data?.profile.id&&!item.opened_at&&!dismissed.current.has(item.id)&&!!preparedSurprise(scope,item.id));
    if(next){opening.current=false;setPrompt(next);}
  },[prompt,enabled,scope,verified,data?.catalogComplete,active,onHome,entry.pending,overlay,busy,items,preparationVersion]);
  const close=()=>{if(prompt)dismissed.current.add(prompt.id);setPrompt(null);};
  return <ScreenOverlay visible={visible} transparent onRequestClose={()=>{}}>
    <SurpriseCard title="Surprise Received!" copy={`${data?.partner?.display_name||'Your person'} has something special for you ✨`}>
      <View style={s.art}><SurpriseGiftbox size={140}/></View>
      <SurpriseAction dark title="Open" onPress={()=>{const id=prompt?.id;
        if(opening.current||!id||!preparedSurprise(scope,id))return;
        opening.current=true;
        close();router.push({pathname:'/(main)/surprise-room',params:{id,receive:'1'}});
      }}/>
    </SurpriseCard>
  </ScreenOverlay>;
}
const s=StyleSheet.create({art:{height:160,justifyContent:'center',alignItems:'center'}});
