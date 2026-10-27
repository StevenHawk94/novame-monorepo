import {apiClient} from './api';
import {withDeadline} from './async-lifecycle';
import {burrowClock,getBurrowSnapshot} from './burrow-store';
import {sessionEpoch,sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import type {AdventureTeamState} from './cooperative-adventure';

type Read={state:AdventureTeamState;serverNow:number;receivedAt:number;epoch:number;scope:string};
let prepared:Read|undefined;
let flight:{scope:string;epoch:number;promise:Promise<void>}|undefined;
const FRESH_MS=60000;
function context(){
 const data=getBurrowSnapshot().data,owner=sessionUserId();
 return data&&owner===data.profile.id?{data,epoch:sessionEpoch(),scope:`${owner}:${data.partner?.id??'solo'}:${data.pairVersion??''}`}:null;
}
function matches(state:AdventureTeamState,data:NonNullable<ReturnType<typeof context>>['data']){
 return state?.userId===data.profile.id&&(state.partnerId??null)===(data.partner?.id??null)
  &&(state.pairVersion??null)===(data.pairVersion??null);
}
/** Bounded, single-flight narrow read. It never blocks navigation, publishes a
 * Home snapshot, marks unread, or changes an already accepted Start intent. */
export function prefetchAdventureTeam():Promise<void>{
 const ctx=context();if(!ctx||!ctx.data.partner||ctx.data.activeAdventure)return Promise.resolve();
 if(flight?.scope===ctx.scope&&flight.epoch===ctx.epoch)return flight.promise;
 if(prepared?.scope===ctx.scope&&prepared.epoch===ctx.epoch&&burrowClock()-prepared.receivedAt<15000)return Promise.resolve();
 const request={scope:ctx.scope,epoch:ctx.epoch,promise:Promise.resolve()};
 request.promise=withDeadline(apiClient.get<{success:boolean;serverNow:string;adventureTeam:AdventureTeamState}>(
  '/api/vnext/adventure?coordination=1'),5000).then(value=>{
   const latest=context();
   if(!latest||latest.scope!==ctx.scope||latest.epoch!==ctx.epoch||!value.success
    ||!Number.isFinite(Date.parse(value.serverNow))||!matches(value.adventureTeam,latest.data))return;
   prepared={state:value.adventureTeam,serverNow:Date.parse(value.serverNow),receivedAt:burrowClock(),epoch:ctx.epoch,scope:ctx.scope};
  }).catch(()=>{/* Optional hint: offline/old API cannot reject a local Start. */}).finally(()=>{if(flight===request)flight=undefined;});
 flight=request;return request.promise;
}
export function preparedAdventureTeam(){
 const ctx=context(),snap=getBurrowSnapshot(),now=burrowClock();if(!ctx)return undefined;
 // A fresher Bootstrap/signal wins over the entry read, including a negative
 // eligibility result. Never resurrect a stale positive from another scope.
 const cached=prepared?.scope===ctx.scope&&prepared.epoch===ctx.epoch?prepared:undefined;
 if(ctx.data.adventureTeam&&matches(ctx.data.adventureTeam,ctx.data)
  &&(!cached||snap.receivedAt>cached.receivedAt)&&now-snap.receivedAt<=FRESH_MS)
  return {state:ctx.data.adventureTeam,now:Date.parse(ctx.data.serverNow)+Math.max(0,now-snap.receivedAt)};
 return cached&&now-cached.receivedAt<=FRESH_MS?{state:cached.state,now:cached.serverNow+Math.max(0,now-cached.receivedAt)}:undefined;
}
subscribeSessionIdentity(()=>{prepared=undefined;flight=undefined;});
