import {useCallback,useRef,useSyncExternalStore} from 'react';
import {getBurrowSnapshot,subscribeBurrowSnapshot} from './burrow-store';
import {attentionRevision,attentionViewKey,burrowAttentionCounts,subscribeAttention} from './burrow-attention';

const subscribe=(listener:()=>void)=>{
  const state=subscribeBurrowSnapshot(listener),ready=subscribeAttention(listener);
  return()=>{state();ready();};
};
/** Read the latest data even when a changed revision is not ready yet. Keeping
 * an old data closure here would miss its subsequent readiness notification.
 * Only the visible badge counts can invalidate the footer's React tree. */
export function useBurrowTabAttention(){
  const cached=useRef<{data:ReturnType<typeof getBurrowSnapshot>['data'];revision:string;
    value:ReturnType<typeof burrowAttentionCounts>;key:string}|null>(null);
  const read=useCallback(()=>{
    const data=getBurrowSnapshot().data,revision=attentionRevision(),before=cached.current;
    if(before&&before.data===data&&before.revision===revision)return before;
    const value=burrowAttentionCounts(data),key=attentionViewKey(value,'tabs');
    return cached.current={data,revision,value,key};
  },[]);
  const key=useCallback(()=>read().key,[read]);
  useSyncExternalStore(subscribe,key,key);
  return read().value;
}
