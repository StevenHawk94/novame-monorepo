import {useEffect} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useBurrowSelector} from './burrow-store';
import {prefetchAdventureTeam} from './adventure-team-prefetch';

/** Only the visible entry/log owns refreshes, never a retained hidden page or
 * the ongoing animation. One request on entry, then at most every 30 seconds. */
export function useAdventureTeamPrefetch(enabled=true){
 const focused=useIsFocused();
 const scope=useBurrowSelector(s=>s.data?`${s.data.profile.id}:${s.data.partner?.id??''}:${s.data.pairVersion??''}:${s.data.activeAdventure?.id??''}`:'');
 useEffect(()=>{
  if(!enabled||!focused)return;
  let timer:ReturnType<typeof setInterval>|undefined;
  const resume=()=>{
   clearInterval(timer);
   if(AppState.currentState!=='active')return;
   void prefetchAdventureTeam();timer=setInterval(()=>{void prefetchAdventureTeam();},30000);
  };
  resume();const sub=AppState.addEventListener('change',resume);
  return()=>{clearInterval(timer);sub.remove();};
 },[enabled,focused,scope]);
}
