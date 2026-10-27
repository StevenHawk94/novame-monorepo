import { AppState } from 'react-native';
import { storage } from './storage';
import { kFriendVisitLocal } from '../shared/storage/keys';
import { getBurrowSnapshot, scheduleBurrowRefresh, projectFriendVisitAnswerLocally, refreshBurrowAfterCurrent } from './burrow-store';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { prepareFriendVisit, answerPreparedFriendVisit, type MajorUpdateBootstrap } from './app-major-update-api';
import { createFriendVisitLocalState, type LocalFriendVisit } from './friend-visit-local-state';
import { prepareBurrowImages, preparedBurrowImage } from './prepared-burrow-images';
import { BURROW_BACKGROUNDS } from './burrow-art-assets';
import { burrowFriendArt } from './burrow-ui-assets';
import { releaseCoinReward } from './coin-reward-store';

const tickets=new Map<string,boolean>();
const presentations=new Map<string,'ready'|'dismissed'>();
const ticketKey=(row:LocalFriendVisit)=>`${row.scope}:${row.visitId}`;
const localState:ReturnType<typeof createFriendVisitLocalState>=createFriendVisitLocalState({
  context:()=>{const data=getBurrowSnapshot().data,owner=sessionUserId();
    return data&&owner===data.profile.id&&data.partner&&data.pairVersion&&data.pairAccessVerified
      ?{owner,scope:`${owner}:${data.partner.id}:${data.pairVersion}`}:null;},
  load:()=>{try{return JSON.parse(storage.getString(kFriendVisitLocal.name)??'[]');}catch{return[];}},
  // Never evict unsent answers. Bound old display caches rather than rewriting
  // an ever-growing dialogue history on every local tap.
  save:rows=>storage.set(kFriendVisitLocal.name,JSON.stringify([
    ...rows.filter(row=>row.status==='pending'),...rows.filter(row=>row.status!=='pending').slice(-32),
  ])),active:()=>AppState.currentState==='active',
  // Journal/project immediately, but let the first rendered reply release
  // the shared wallet animation. The request never owns the dialogue cursor.
  prepare:prepareFriendVisit,submit:(conversation,choice)=>{
    const result=answerPreparedFriendVisit(conversation,choice,false,true);
    const row=localState.read(conversation.visitId),presentation=row&&presentations.get(ticketKey(row));
    // A local disk/queue failure may retry after the reveal or after exit.
    // Release the newly-created ticket at the already-recorded visual state.
    if(presentation)releaseCoinReward(`friend-visit:${conversation.visitId}`,presentation==='dismissed');
    return result;
  },
  project:(row,restored)=>{const key=ticketKey(row);if(tickets.has(key))return;
    tickets.set(key,restored);
    if(restored)presentations.set(key,'dismissed');
    projectFriendVisitAnswerLocally(row.visitId,'pending');},
  confirm:row=>{tickets.delete(ticketKey(row));projectFriendVisitAnswerLocally(row.visitId,'confirmed');},
  reject:row=>{tickets.delete(ticketKey(row));projectFriendVisitAnswerLocally(row.visitId,'rejected');},
  settled:scheduleBurrowRefresh,schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
function releaseVisitReward(id:string,quiet=false,owner=sessionUserId()){
  if(owner!==sessionUserId())return;
  // Blur/unpair can invalidate the local row before cleanup runs. Consume
  // any already-held same-account ticket anyway; never strand visible money.
  if(quiet&&id)releaseCoinReward(`friend-visit:${id}`,true);
  const row=localState.read(id);if(!row?.choiceId)return;
  const key=ticketKey(row);
  if(!quiet&&presentations.get(key)==='dismissed')return;
  presentations.set(key,quiet?'dismissed':'ready');
  if(!quiet)releaseCoinReward(`friend-visit:${id}`);
}
export const friendVisitLocal=Object.assign(localState,{
  rewardReady:(id:string,owner?:string)=>releaseVisitReward(id,false,owner),
  dismissReward:(id:string,owner?:string)=>releaseVisitReward(id,true,owner),
});
subscribeSessionIdentity(()=>{tickets.clear();presentations.clear();friendVisitLocal.reset();});
function visitArt(data:MajorUpdateBootstrap) {
  const name=data.friends.find(f=>f.stable_id===data.friendVisit?.friend_id)?.name;
  return [BURROW_BACKGROUNDS.friendsRoom,burrowFriendArt(name),burrowFriendArt(name,true)].filter((s):s is number=>typeof s==='number');
}
export function friendVisitReady(data:MajorUpdateBootstrap,includeArt=true) {
  const visit=data.friendVisit;
  return (visit?.version!==2||visit.myCompleted||!!friendVisitLocal.read(visit.id))&&(!includeArt||visitArt(data).every(source=>!!preparedBurrowImage(source)));
}
export async function warmFriendVisit(data:MajorUpdateBootstrap,includeArt=true) {
  const latest=getBurrowSnapshot().data;
  if(!latest||sessionUserId()!==data.profile.id||latest.profile.id!==data.profile.id
    ||latest.partner?.id!==data.partner?.id||latest.pairVersion!==data.pairVersion)return;
  const scope=`${data.profile.id}:${data.partner?.id}:${data.pairVersion}:`;
  for(const key of tickets.keys())if(!key.startsWith(scope))tickets.delete(key);
  for(const key of presentations.keys())if(!key.startsWith(scope))presentations.delete(key);
  const visit=data.friendVisit;
  await Promise.all([
    visit?.version===2&&!visit.myCompleted?friendVisitLocal.prepare(visit.id,visit.pairVersion,visit.partnerCompleted).catch(async error=>{
      const code=error?.body?.error??error?.message;
      // Another device may have just finished, or the waiting window expired.
      // Reconcile the source instead of opening an error/empty conversation.
      if(['already_completed','visit_expired','not_found'].includes(code)){await refreshBurrowAfterCurrent();return;}
      throw error;
    }):null,
    includeArt?prepareBurrowImages(visitArt(data),1200):null,
  ]);
}
