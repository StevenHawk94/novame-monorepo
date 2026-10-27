import {AppState} from 'react-native';
import {apiClient} from './api';
import {withDeadline} from './async-lifecycle';
import {storage} from './storage';
import {kCoinOperations} from '../shared/storage/keys';
import {sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {beginCoinReward,settleCoinReward,failCoinReward,coinRewardDefinitelyRejected,commandCoinRewardPlan,type CoinResponse} from './coin-reward-store';
import {createCoinOperationQueue,type CoinOperation} from './coin-operation-queue';
import {captureQuestFact,currentQuestData,guardQuestClaim,questProgress,subscribeQuestProgress} from './quest-progress-store';
import {questScope} from './quest-progress-model';
import {showBurrowToast} from './burrow-toast';
import {recordRatingMilestone} from './official-rating-milestones';
const isClaim=(row:CoinOperation)=>['claim_daily_quest','claim_special_quest'].includes(String(row.payload.action));
function projectQuest(row:CoinOperation,status:'pending'|'confirmed'|'rejected'){
 if(!row.quest)return;
 if(isClaim(row))questProgress.claim(row.id,row.quest,status);
 else questProgress.fact(row.id,row.quest,status);
}
const tickets=new Map<string,ReturnType<typeof beginCoinReward>>();
export const coinOperations=createCoinOperationQueue({
 owner:sessionUserId,active:()=>AppState.currentState==='active',
 load:()=>JSON.parse(storage.getString(kCoinOperations.name)??'[]'),save:rows=>storage.set(kCoinOperations.name,JSON.stringify(rows)),
 project:(row,quiet)=>{projectQuest(row,'pending');if(!tickets.has(row.id))tickets.set(row.id,beginCoinReward(row.id,row.key,row.amount,row.deferred&&!quiet,quiet));},
 send:async row=>{
  // A Claim is already presented locally. Its wire request must wait for the
  // prerequisite command/photo/journal receipt, never race the completion.
  if(row.quest&&isClaim(row))guardQuestClaim(row.quest);
  else if(row.quest){
   const data=currentQuestData();
   if(!data)throw Error('quest_sync_pending');
   if(questScope(data).scope!==row.quest.scope)throw Error('pair_changed');
  }
  const result=await withDeadline(apiClient.post<CoinResponse&{error?:string;status?:{partnerId:string|null;pairVersion:string|null};dailyPlusBonus?:{claimed:boolean;key:string;localDate:string}}>(row.path,row.payload),20000);
  if(result.error)throw Error(result.error);
  if(row.payload.action==='claim_daily_plus_bonus'&&(!result.coinState?.wallet||!result.dailyPlusBonus?.claimed
   ||result.dailyPlusBonus.key!==row.key||result.dailyPlusBonus.localDate!==row.payload.localDate))throw Error('bonus_receipt_missing');
  if(row.path==='/api/vnext/release-room'&&(!result.status||result.status.partnerId!==row.payload.partnerId||result.status.pairVersion!==row.payload.pairVersion))throw Error('pair_changed');
  return result;},
 confirm:(row,result)=>{projectQuest(row,'confirmed');const ticket=tickets.get(row.id);if(ticket)settleCoinReward(ticket,result);tickets.delete(row.id);
  // Done may already have closed the optimistic Sent page. Count only the
  // verified receipt, even on a later retry/relaunch; the rating gate still
  // permits inline presentation only on that exact, settled Sent screen.
  if(row.payload.action==='complete_affection'&&typeof row.payload.idempotencyKey==='string')
   recordRatingMilestone(row.owner,'affection',row.payload.idempotencyKey);},
 reject:(row,error)=>{projectQuest(row,'rejected');const ticket=tickets.get(row.id);if(ticket)failCoinReward(ticket);tickets.delete(row.id);
  if(isClaim(row))showBurrowToast('This reward could not be verified. Your coins have been corrected.');},
 definitive:coinRewardDefinitelyRejected,schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
// A completed photo/journal/game receipt releases waiting Claims promptly;
// do not make an invisible dependency wait for the next network backoff tick.
let questWake:ReturnType<typeof setTimeout>|undefined;
subscribeQuestProgress(()=>{
 if(questWake===undefined)questWake=setTimeout(()=>{questWake=undefined;coinOperations.wake(isClaim);},0);
});
subscribeSessionIdentity(()=>{if(questWake!==undefined)clearTimeout(questWake);questWake=undefined;tickets.clear();coinOperations.reset();});
AppState.addEventListener('change',state=>{if(state==='active')coinOperations.resume();});
/** Reserve presentation for an already durable local intent. This does not
 * enqueue a request or authorize spending; its eventual command reuses it. */
export function stageCoinOperationReward(id:string,key:string|null,amount:number,quiet=false){
 if(!sessionUserId()||tickets.has(id))return;
 tickets.set(id,beginCoinReward(id,key,amount,!quiet,quiet));
}
export function cancelStagedCoinOperationReward(id:string){
 // An ambiguous in-flight command still owns its ticket and must reconcile
 // its receipt; only a presentation-only reservation can be cancelled here.
 if(coinOperations.has(id))return;
 const ticket=tickets.get(id);if(ticket)failCoinReward(ticket);tickets.delete(id);
}
export function submitCoinOperation<T>(operation:Omit<CoinOperation,'owner'>,quiet=false):Promise<T>{
 const owner=sessionUserId();if(!owner)return Promise.reject(Error('session_changed'));
 return coinOperations.submit({...operation,owner},quiet) as Promise<T>;
}
/** Throws if the intent could not be persisted; the returned promise is only
 * the background receipt, never a prerequisite for optimistic completion UI. */
export function enqueueCoinOperation<T>(operation:Omit<CoinOperation,'owner'>,quiet=false):Promise<T>{
 const owner=sessionUserId();if(!owner)throw Error('session_changed');
 return coinOperations.enqueue({...operation,owner},quiet) as Promise<T>;
}
export function submitCoinCommand<T>(action:string,payload:Record<string,unknown>):Promise<T>{
 const operation=coinCommandOperation(action,payload);
 return submitCoinOperation<T>(operation);
}
/** The local durable commit, not a network promise, owns Affection's UI flow.
 * Settlement observers still receive a late receipt or definitive rejection. */
export function enqueueAffectionCommand(affectionType:string,gestureMetrics:Record<string,number>,idempotencyKey:string){
 const operation=coinCommandOperation('complete_affection',{affectionType,gestureMetrics,idempotencyKey});
 if(!operation.quest)throw Error('quest_sync_pending');
 void enqueueCoinOperation(operation).catch(()=>{/* Unknown outcomes remain in the durable retry queue. */});
 return operation.id;
}
function coinCommandOperation(action:string,payload:Record<string,unknown>):Omit<CoinOperation,'owner'>{
 const data=currentQuestData();
 const quest=action==='claim_daily_quest'&&data?questProgress.captureClaim(data,String(payload.assignmentId))
  :action==='claim_special_quest'&&data?{...questScope(data),questId:String(payload.questId),stage:Number(payload.stage),verified:true}
  :action==='complete_affection'?captureQuestFact('send_affection')
  :action==='refill_room_need'?captureQuestFact(payload.need==='water'?'water_partner_flower':'feed_partner_bunny'):undefined;
 return {...commandCoinRewardPlan(action,payload),path:'/api/vnext/command',payload:{action,...payload},...(quest?{quest}:{})};
}
/** Local commit and coin presentation happen before returning. The background
 * queue retains unknown failures; only definitive rejection rolls back. */
export function claimQuestOptimistically(action:'claim_daily_quest'|'claim_special_quest',payload:Record<string,unknown>){
 const operation=coinCommandOperation(action,payload);
 if(!operation.quest)throw Error('quest_sync_pending');
 if(action==='claim_special_quest'){
  const q=currentQuestData()?.specialQuests.find(q=>q.questId===payload.questId&&q.stage===payload.stage);
  if(!q||q.progress<q.target)throw Error('not_completed');
 }
 void enqueueCoinOperation(operation).catch(()=>{/* The durable queue owns retry and final rejection. */});
 return operation.amount;
}
