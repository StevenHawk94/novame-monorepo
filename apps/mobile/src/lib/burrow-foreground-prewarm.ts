import { AppState } from 'react-native';
import { getBurrowSnapshot } from './burrow-store';
import { sessionEpoch } from './session-lifecycle';
import { stageForegroundJobs } from './ui-idle';
import { warmBurrowGameOverview } from './burrow-page-entry';
import { fetchReleaseRoom, releaseRoomScope } from './release-room-api';
import { warmBurrowPageArt, type PreparedPage } from './burrow-page-art';
import { burrowRouteModuleJobs } from './burrow-route-modules';

/** Start in separate idle slices; hidden apps never begin the remaining jobs. */
export function prewarmBurrowPages() {
  const initial=getBurrowSnapshot().data;if(!initial?.catalogComplete)return()=>{};
  const epoch=sessionEpoch(),scope=releaseRoomScope(initial);
  const jobs:PreparedPage[]=['affection','adventure','shop','game','surprise','release'];
  const current=()=>{const data=getBurrowSnapshot().data;return AppState.currentState==='active'&&epoch===sessionEpoch()&&!!data&&releaseRoomScope(data)===scope;};
  const modules=stageForegroundJobs(burrowRouteModuleJobs(current));
  const artwork=stageForegroundJobs(jobs.map((kind,index)=>({delayMs:1200+index*500,run:()=>{
    const data=getBurrowSnapshot().data;
    if(AppState.currentState!=='active'||epoch!==sessionEpoch()||!data||releaseRoomScope(data)!==scope)return;
    // Notification preparation/realtime invalidation own freshness. Optional
    // catalogue warming must not force another read of an already-ready lobby.
    if(kind==='game')void warmBurrowGameOverview().catch(()=>{});
    if(kind==='release')void fetchReleaseRoom(data).catch(()=>{});
    return warmBurrowPageArt(kind,data,{retain:false});
  }})));
  return()=>{modules();artwork();};
}
