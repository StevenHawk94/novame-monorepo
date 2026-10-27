import {useLayoutEffect,useEffect} from 'react';
import {AppState} from 'react-native';
import {useBurrowSelector} from '@/lib/burrow-store';
import {subscribePlushieTouchSignal} from '@/lib/plushie-touch-signals';
import {refreshPlushieTouch,resumePlushieTouch,pausePlushieTouch,setPlushieTouchScope} from '@/lib/plushie-touch-store';
/** Own event subscription, not a second owner of the SDK's shared channel. */
export function PlushieTouchSyncGate(){
 const scope=useBurrowSelector(s=>!s.pairInvalidated&&s.data?.partner&&s.data.pairVersion?`${s.data.profile.id}:${s.data.partner.id}:${s.data.pairVersion}`:'');
 const [user,partner,pair]=scope.split(':');
 useLayoutEffect(()=>{setPlushieTouchScope(user&&partner&&pair?{user,partner,pair}:null);},[user,partner,pair]);
 useEffect(()=>{
  if(!user||!partner||!pair)return;
  let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{if(live&&AppState.currentState==='active'){void resumePlushieTouch();void refreshPlushieTouch();}};
  const queue=()=>{if(timer)clearTimeout(timer);timer=setTimeout(refresh,120);};
  const unsubscribe=subscribePlushieTouchSignal(user,queue);
  refresh();const app=AppState.addEventListener('change',s=>{if(s==='active')refresh();else pausePlushieTouch();});
  return()=>{live=false;if(timer)clearTimeout(timer);app.remove();pausePlushieTouch();unsubscribe();};
 },[user,partner,pair]);return null;
}
