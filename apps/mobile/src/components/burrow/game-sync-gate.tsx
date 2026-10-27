import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useBurrowSnapshot } from '@/lib/burrow-store';
import { pauseLocalGames,resumeLocalGames } from '@/lib/burrow-game-local';
/** The delivery queue outlives Game Room; background uploads never own navigation. */
export function GameSyncGate(){
  const {data}=useBurrowSnapshot();
  const scope=data?`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`:'';
  useEffect(()=>{
    void resumeLocalGames();
    const sub=AppState.addEventListener('change',state=>{if(state==='active')void resumeLocalGames();else pauseLocalGames();});
    return()=>{sub.remove();pauseLocalGames();};
  },[scope]);return null;
}
