import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { MajorUpdateBootstrap } from './app-major-update-api';
import { storage } from './storage';
import { kBurrowAttention } from '../shared/storage/keys';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { momentKind } from './burrow-moments-model';
import { notificationReadiness, type NotificationDestination } from './notification-readiness';
import { notificationContentVersion } from './notification-content-version';
import { preparedShopGiftIds } from './shop-gift-preparation';
import {adventureEntryState} from './adventure-entry-state';
import {readAdventureDeliveryRows,subscribeAdventureDelivery} from './adventure-delivery-state';

export type AttentionChannel = 'moments' | 'letters' | 'games' | 'journal' | 'visits' | 'quests';
export type AttentionItem = { id: string; at: string; pageId?:string;answerId?:string;revision?:string;kind?:'page'|'answer' };
export type BurrowAttentionSnapshot = { scope: string; localDate: string; moments: AttentionItem[]; letters: AttentionItem[]; games: AttentionItem[]; journal: AttentionItem[] };
const channels: AttentionChannel[] = ['moments','letters','games','journal','visits','quests'];
type SeenChannel = AttentionChannel | 'letterReminders' | 'adventureReminders' | 'journalReminders';
type Seen = Partial<Record<SeenChannel,string[]>>;
const cache = new Map<string,Seen>(), pending = new Map<string,Set<string>>(), listeners = new Set<()=>void>();
let revision=0;
const publish=()=>{revision++;listeners.forEach(fn=>fn());};
subscribeAdventureDelivery(publish);
subscribeSessionIdentity(()=>{cache.clear();pending.clear();publish();});
export const attentionScope=(data:MajorUpdateBootstrap)=>`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`;
export const notificationContentReady=(data:MajorUpdateBootstrap,kind:NotificationDestination)=>
  (!data.partner||data.pairAccessVerified===true)&&(kind==='gifts'?preparedShopGiftIds(data).length>0:notificationReadiness.ready(attentionScope(data),kind,notificationContentVersion(data,kind)));
export function useNotificationContentReady(data:MajorUpdateBootstrap|null|undefined,kind:NotificationDestination){
  const read=()=>!!data&&notificationContentReady(data,kind);
  return useSyncExternalStore(notificationReadiness.subscribe,read,read);
}
export function badgeLabel(count:number){const value=Math.floor(count);return value>9?'9+':value>0?String(value):null;}
function seen(scope:string):Seen {
  if(cache.has(scope))return cache.get(scope)!;
  let value:Seen={};
  if(scope.split(':')[0]===sessionUserId())try{
    const record=JSON.parse(storage.getString(kBurrowAttention.keyFor(scope))??'null');
    if(record?.scope===scope)for(const channel of [...channels,'letterReminders','adventureReminders','journalReminders'] as SeenChannel[]){
      if(Array.isArray(record.seen?.[channel]))value[channel]=record.seen[channel].filter((id:unknown)=>typeof id==='string').slice(-800);
    }
  }catch{}
  cache.set(scope,value);return value;
}
function sources(data:MajorUpdateBootstrap,now=Date.parse(data.serverNow)){
  const scope=attentionScope(data),remote=data.attention?.scope===scope?data.attention:null;
  const moments=remote?.moments??(data.moments??[]).filter(row=>row.actor_id===data.partner?.id&&momentKind({...row,localDate:data.localDate})).map(row=>({id:`${row.id}:${row.created_at}`,at:row.created_at}));
  const letters=remote?.letters??(data.memoryEntries??[]).filter(row=>row.author_id===data.partner?.id&&row.body.startsWith('💌 ')).map(row=>({id:`${row.id}:${row.updated_at}`,at:row.updated_at}));
  const visit=data.friendVisit;
  return {moments:remote?.moments??moments,letters:remote?.letters??letters,games:remote?.games??[],journal:remote?.journal?.some(item=>item.pageId)||remote?.localDate===data.localDate?remote?.journal??[]:[],
    visits:visit&&(visit.version===2?!visit.myCompleted&&(!visit.expiresAt||Date.parse(visit.expiresAt)>now):!visit.completed_at&&!visit.declined_at)?[{id:visit.id,at:visit.visit_date}]:[]};
}
/** Acknowledge only rendered metadata, never a future timestamp. */
export function unreadBurrowUpdateIds(data:MajorUpdateBootstrap,channel:Exclude<AttentionChannel,'quests'>):string[]{
  if(data.profile.id!==sessionUserId())return [];
  const read=new Set(channel==='visits'&&data.friendVisitsVersion===2?[]:seen(attentionScope(data))[channel]??[]);
  return [...new Set(sources(data)[channel].filter(item=>!read.has(item.id)).map(item=>item.id))];
}
export function markBurrowUpdatesSeen(data:MajorUpdateBootstrap,channel:Exclude<AttentionChannel,'quests'>,renderedIds?:readonly string[]){
  const scope=attentionScope(data);if(data.profile.id!==sessionUserId())return;
  // Metadata is not a read receipt. A destination may only acknowledge the
  // current revision after its actual content has reached the shared cache.
  if(!renderedIds&&!notificationContentReady(data,channel))return;
  const ids=renderedIds??sources(data)[channel].map(item=>item.id);if(!ids.length)return;
  rememberSeenIds(scope,channel,ids);
}
export function dismissJournalHistoryReminder(data:MajorUpdateBootstrap,pageIds:readonly string[]){
  if(data.profile.id!==sessionUserId())return;
  rememberSeenIds(attentionScope(data),'journalReminders',sources(data).journal.filter(item=>item.pageId&&pageIds.includes(item.pageId)).map(item=>item.id));
}
export function hasJournalHistoryReminder(data:MajorUpdateBootstrap,pageIds:readonly string[]){
  const read=seen(attentionScope(data)),hidden=new Set([...(read.journal??[]),...(read.journalReminders??[])]);
  return data.profile.id===sessionUserId()&&sources(data).journal.some(item=>item.pageId&&pageIds.includes(item.pageId)&&!hidden.has(item.id));
}
export function journalRenderedAttentionIds(data:MajorUpdateBootstrap,page:{id:string;answers:{id:string;updatedAt:string}[]}){
  return sources(data).journal.filter(item=>item.kind==='page'?item.pageId===page.id:
    item.answerId?page.answers.some(a=>a.id===item.answerId&&a.updatedAt===item.revision):
    page.answers.some(a=>`${a.id}:${a.updatedAt}`===item.id)).map(item=>item.id);
}
/** Opening the envelope dismisses its reminder, not the unread reading queue.
 * Keep revisions rather than timestamps so a newly arriving note still alerts. */
export function dismissHomeLetterReminder(data:MajorUpdateBootstrap){
  if(data.profile.id!==sessionUserId())return;
  rememberSeenIds(attentionScope(data),'letterReminders',sources(data).letters.map(item=>item.id));
}
/** Legacy entry compatibility. Opening is not a final collection receipt. */
export function dismissAdventureReminder(data:MajorUpdateBootstrap,now=Date.parse(data.serverNow)){
  // Compatibility for old entry callers. Merely entering is NOT collection.
  // Old persisted arrival-dismissal IDs no longer hide incomplete rewards.
}
function rememberSeenIds(scope:string,channel:SeenChannel,ids:readonly string[]){
  if(!ids.length)return;
  const previous=seen(scope);
  if(ids.every(id=>(previous[channel]??[]).includes(id)))return;
  const next={...previous,[channel]:[...new Set([...(previous[channel]??[]),...ids])].slice(-800)};
  cache.set(scope,next);try{storage.set(kBurrowAttention.keyFor(scope),JSON.stringify({scope,seen:next}));}catch{}
  publish();
}
/** Hide a tapped claim immediately; failure restores it, success is durable. */
export function beginQuestAttentionClaim(data:MajorUpdateBootstrap,key:string){
  const scope=attentionScope(data),set=pending.get(scope)??new Set<string>();pending.set(scope,set);set.add(key);publish();
  return(success:boolean)=>{
    set.delete(key);if(data.profile.id!==sessionUserId()||pending.get(scope)!==set)return;
    if(success){const previous=seen(scope),next={...previous,quests:[...new Set([...(previous.quests??[]),key])].slice(-800)};
      cache.set(scope,next);try{storage.set(kBurrowAttention.keyFor(scope),JSON.stringify({scope,seen:next}));}catch{}}
    publish();
  };
}
export function burrowAttentionCounts(data:MajorUpdateBootstrap|null|undefined,now?:number){
  const empty={letter:0,affection:0,adventure:0,rooms:{game_room:0,memories_room:0,friends_room:0},tabs:{index:0,burrow:0,quests:0,shop:0,friends:0}};
  if(!data||data.profile.id!==sessionUserId())return empty;
  const scope=attentionScope(data),read=seen(scope),items=sources(data,now),hidden=new Set([...(read.quests??[]),...(pending.get(scope)??[])]);
  const unread=(channel:keyof typeof items)=>{const ids=new Set(channel==='visits'&&data.friendVisitsVersion===2?[]:read[channel]??[]);return new Set(items[channel].filter(item=>!ids.has(item.id)).map(item=>item.id)).size;};
  const daily=(data.quests?.quests??[]).filter(q=>!q.claimedAt&&!!q.completedAt&&!hidden.has(`daily:${q.assignmentId}`)).length;
  const special=(data.specialQuests??[]).filter(q=>q.progress>=q.target&&!hidden.has(`special:${q.questId}:${q.stage}`)).length;
  const reminded=new Set([...(read.letters??[]),...(read.letterReminders??[])]);
  const letter=notificationContentReady(data,'letters')?new Set(items.letters.filter(item=>!reminded.has(item.id)).map(item=>item.id)).size:0;
  const affection=Math.min(data.unread?.affection??0,(data.affectionInbox??[]).length),adventure=notificationContentReady(data,'adventure')
    &&adventureEntryState(data,now??Date.parse(data.serverNow),readAdventureDeliveryRows()).kind==='settlement'?1:0;
  const journalRead=new Set([...(read.journal??[]),...(read.journalReminders??[])]);
  const rooms={game_room:notificationContentReady(data,'games')?unread('games'):0,memories_room:notificationContentReady(data,'journal')?items.journal.filter(item=>!journalRead.has(item.id)).length:0,friends_room:notificationContentReady(data,'visits')?unread('visits'):0};
  const gifts=data.pairAccessVerified===true?preparedShopGiftIds(data).length:0;
  return {letter,affection,adventure,rooms,tabs:{index:letter+affection+adventure,burrow:Object.values(rooms).reduce((a,b)=>a+b,0),quests:daily+special,shop:gifts,friends:notificationContentReady(data,'moments')?unread('moments'):0}};
}
export type AttentionView='all'|'home'|'rooms'|'tabs'|'affection'|'none';
export function attentionViewKey(value:ReturnType<typeof burrowAttentionCounts>,view:AttentionView){
  if(view==='none')return '';
  if(view==='affection')return String(value.affection);
  if(view==='home')return `${value.letter}:${value.affection}:${value.adventure}`;
  if(view==='rooms')return Object.values(value.rooms).join(':');
  if(view==='tabs')return Object.values(value.tabs).join(':');
  return `${value.letter}:${value.affection}:${value.adventure}:${Object.values(value.rooms).join(':')}:${Object.values(value.tabs).join(':')}`;
}
export const subscribeAttention=(listener:()=>void)=>{
  listeners.add(listener);const release=notificationReadiness.subscribe(listener);
  return()=>{listeners.delete(listener);release();};
};
export const attentionRevision=()=>`${revision}:${notificationReadiness.revision()}`;
const noAttention={letter:0,affection:0,adventure:0,rooms:{game_room:0,memories_room:0,friends_room:0},tabs:{index:0,burrow:0,quests:0,shop:0,friends:0}};
export function useBurrowAttention(data:MajorUpdateBootstrap|null|undefined,now?:number,view:AttentionView='all'){
  const cached=useRef<{data:typeof data;now:typeof now;revision:number;ready:number;value:ReturnType<typeof burrowAttentionCounts>}|null>(null);
  const read=useCallback(()=>{
    if(view==='none')return noAttention;
    const ready=notificationReadiness.revision(),before=cached.current;
    if(before&&before.data===data&&before.now===now&&before.revision===revision&&before.ready===ready)return before.value;
    const value=burrowAttentionCounts(data,now);
    cached.current={data,now,revision,ready,value};return value;
  },[data,now,view]);
  const selected=useCallback(()=>attentionViewKey(read(),view),[read,view]);
  // React checks a stable primitive, not the registry's global revision. A
  // different channel can become ready without repainting this entire room.
  useSyncExternalStore(subscribeAttention,selected,selected);
  return read();
}
