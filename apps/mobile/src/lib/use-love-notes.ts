import {useCallback,useEffect,useRef,useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import type {MajorUpdateBootstrap} from './app-major-update-api';
import {attentionScope} from './burrow-attention';
import {fetchBurrowHistory,type HistoryCursor} from './burrow-history';
import {mergeLoveNotes,loveNoteKey,type LoveNote} from './love-note-model';
import {sessionEpoch,sessionUserId,subscribeSessionIdentity} from './session-lifecycle';

// Navigation shares fetched bodies in memory only. Never put private note text
// in route params or a second persistent cache. Account/pair changes invalidate it.
type CachedNotes={scope:string;rows:LoveNote[];next:HistoryCursor;loaded:boolean};
let cache:CachedNotes|null=null;
const listeners=new Set<()=>void>(),reads=new Map<string,Promise<void>>();
const emit=()=>listeners.forEach(fn=>fn());
export function loveNotesReady(data:MajorUpdateBootstrap){
  return cache?.scope===attentionScope(data)&&cache.loaded&&(data.attention?.letters??[]).every(item=>cache!.rows.some(row=>loveNoteKey(row)===item.id));
}
subscribeSessionIdentity(()=>{cache=null;reads.clear();emit();});
/** Shared foreground prefetch. Do not paginate every diary page: stop as soon
 * as the notification's exact note revisions are available. */
export function prepareLoveNotes(data:MajorUpdateBootstrap,current:()=>boolean=()=>true,more=false):Promise<void>{
  const scope=attentionScope(data),epoch=sessionEpoch(),key=`${epoch}:${scope}:${more?'more':'head'}`;
  const existing=reads.get(key);if(existing)return existing;
  const task=(async()=>{
    const valid=()=>epoch===sessionEpoch()&&data.profile.id===sessionUserId()&&current();
    let cursor=more&&cache?.scope===scope?cache.next:null;
    let rows=mergeLoveNotes(data,cache?.scope===scope?cache.rows:[],data.memoryEntries),loaded=false;
    const required=data.attention?.letters??[];
    const cursors=new Set<string>();
    do{
      const page=await fetchBurrowHistory('memories',data.partner?.id,cursor,'');if(!valid())return;
      const entries=page.rows.filter((row):row is LoveNote&{localDate:string}=>'author_id' in row);
      rows=mergeLoveNotes(data,rows,entries);cursor=page.next;loaded=true;
      const keys=new Set(rows.map(loveNoteKey));
      if(more||required.every(item=>keys.has(item.id))||!page.hasMore||!cursor)break;
      const token=JSON.stringify(cursor);if(cursors.has(token))throw Error('history_cursor_repeated');cursors.add(token);
    }while(cursor);
    if(!valid())return;
    // Pagination may finish after a newer head refresh. Merge the latest
    // shared rows again so a late page cannot erase newly arrived notes.
    rows=mergeLoveNotes(data,cache?.scope===scope?cache.rows:[],rows);
    if(required.some(item=>!rows.some(row=>loveNoteKey(row)===item.id)))throw Error('letter_revision_not_ready');
    cache={scope,rows,next:cursor,loaded};emit();
  })().finally(()=>{if(reads.get(key)===task)reads.delete(key);});
  reads.set(key,task);return task;
}
export function useLoveNotes(data:MajorUpdateBootstrap,{enabled=true}:{enabled?:boolean}={}){
  const scope=attentionScope(data),focused=useIsFocused();
  const [history,setHistory]=useState<CachedNotes>(()=>cache?.scope===scope?cache:{scope,rows:[],next:null,loaded:false});
  const [loading,setLoading]=useState(enabled&&focused&&data.profile.id===sessionUserId()),[failed,setFailed]=useState(false);
  const active=useRef({scope,focused,data,enabled});active.current={scope,focused,data,enabled};
  const token=useRef(0),inFlight=useRef(false);
  const load=useCallback(async(more=false)=>{
    if(inFlight.current||!active.current.enabled||!active.current.focused||data.profile.id!==sessionUserId())return;
    inFlight.current=true;setLoading(true);setFailed(false);
    const operation=++token.current,epoch=sessionEpoch();
    const valid=()=>operation===token.current&&epoch===sessionEpoch()&&active.current.scope===scope&&active.current.focused&&active.current.enabled;
    try{
      await prepareLoveNotes(active.current.data,()=>active.current.scope===scope&&epoch===sessionEpoch(),more);
      if(valid()&&cache?.scope===scope)setHistory(cache);
    }catch{if(valid())setFailed(true);}
    finally{if(operation===token.current){inFlight.current=false;setLoading(false);}}
  },[scope,data.partner?.id,history.next]);
  useEffect(()=>{
    const update=()=>{if(cache?.scope===scope&&data.profile.id===sessionUserId())setHistory(cache);};
    listeners.add(update);update();return()=>{listeners.delete(update);};
  },[scope]);
  useEffect(()=>{
    token.current++;inFlight.current=false;setLoading(false);setFailed(false);
    if(enabled&&focused&&!(cache?.scope===scope&&cache.loaded))void load();
    return()=>{token.current++;inFlight.current=false;};
  },[focused,scope,enabled]);
  const rows=data.profile.id===sessionUserId()?mergeLoveNotes(data,history.scope===scope?history.rows:[],data.memoryEntries):[];
  return {rows,focused,loading,failed,loaded:history.scope===scope&&history.loaded,hasMore:history.scope===scope&&!!history.next,load};
}
