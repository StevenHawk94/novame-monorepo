import {gameHistory} from './burrow-game-room-api';
import {cacheGameHistory,gameHistoryNeedsRefresh,getCachedGameHistory} from './burrow-game-room-cache';
import {listSurpriseHistory} from './surprise-api';
import {cachedSurpriseHistory,saveSurpriseHistoryPage,surpriseHistoryRevision} from './surprise-history-cache';
import {sessionEpoch,sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {getBurrowSnapshot} from './burrow-store';
import {gameResultViewed} from './burrow-game-local';
const flights=new Map<string,Promise<boolean>>(),checked=new Map<string,number>();
subscribeSessionIdentity(()=>{flights.clear();checked.clear();});
const valid=(scope:string,epoch:number)=>{
 const data=getBurrowSnapshot().data;
 return !!data&&`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`===scope
  &&scope.split(':')[0]===sessionUserId()&&epoch===sessionEpoch();
};
export async function prepareGameHistoryEntry(scope:string):Promise<boolean>{
 if(!valid(scope,sessionEpoch()))throw Error('session_changed');
 const cached=getCachedGameHistory(scope);
 const archived=(r:NonNullable<typeof cached>['rounds'][number])=>!!r.result&&(!!r.resultViewedAt||gameResultViewed(r.id,scope));
 if(cached?.rounds.some(archived))return true;
 if(cached&&!gameHistoryNeedsRefresh(Date.now(),scope))return false;
 const key=`games:${scope}`,previous=flights.get(key);if(previous)return previous;
 const epoch=sessionEpoch();
 const work=gameHistory().then(next=>{
  if(!valid(scope,epoch))throw Error('session_changed');
  const current=getCachedGameHistory(scope);
  const rounds=Array.from(new Map([...(current?.rounds??[]),...next.rounds].map(r=>[r.id,r])).values())
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  cacheGameHistory({...next,rounds},Date.now(),scope);
  return rounds.some(archived);
 }).finally(()=>{if(flights.get(key)===work)flights.delete(key);});
 flights.set(key,work);return work;
}
export async function prepareSurpriseHistoryEntry(scope:string):Promise<boolean>{
 if(!valid(scope,sessionEpoch()))throw Error('session_changed');
 const key=`surprise:${scope}`,pages=()=>['received','sent'].some(direction=>cachedSurpriseHistory(scope,direction as 'received'|'sent').items.length>0);
 if(Date.now()-(checked.get(key)??0)<60000)return pages();
 const previous=flights.get(key);if(previous)return previous;
 const epoch=sessionEpoch(),revision=surpriseHistoryRevision();
 const work=Promise.all([listSurpriseHistory('received'),listSurpriseHistory('sent')]).then(([received,sent])=>{
  if(!valid(scope,epoch))throw Error('session_changed');
  saveSurpriseHistoryPage(scope,'received',received,false,revision);saveSurpriseHistoryPage(scope,'sent',sent,false,revision);
  checked.set(key,Date.now());return pages();
 }).finally(()=>{if(flights.get(key)===work)flights.delete(key);});
 flights.set(key,work);return work;
}
