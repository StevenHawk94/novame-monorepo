import {ROOM_CARE_ACTIONS,roomCareAction,type RoomCareAction} from '@novame/domain';
import type {MajorUpdateBootstrap} from './app-major-update-api';
export {roomCareAction};
export function currentRoomCare(data:MajorUpdateBootstrap){
 const care=data.roomCare;
 return care?.version===2&&care.actorId===data.profile.id&&care.partnerId===(data.partner?.id??null)
  &&care.pairVersion===(data.pairVersion??null)?care:null;
}
/** Completed care is monotonic within one verified identity/relationship. An
 * older in-flight bootstrap must not reopen a just-completed action. */
export function mergeRoomCare(previous:MajorUpdateBootstrap|null,next:MajorUpdateBootstrap){
 const before=previous&&currentRoomCare(previous),after=currentRoomCare(next);
 if(!before||!after||before.actorId!==after.actorId||before.partnerId!==after.partnerId||before.pairVersion!==after.pairVersion)return next;
 let care=after;
 for(const side of ['own','partner'] as const){
  const oldRoom=before[side],newRoom=after[side];if(!oldRoom||!newRoom)continue;
  for(const kind of ROOM_CARE_ACTIONS){
   const old=oldRoom[kind],fresh=newRoom[kind];
   if(old.lastAt&&Date.parse(old.lastAt)>(Date.parse(fresh.lastAt??'')||0))
    care={...care,[side]:{...care[side],[kind]:old}};
  }
 }
 return care===after?next:{...next,roomCare:care};
}
export function roomCarePayload(data:MajorUpdateBootstrap,ownerId:string,need:'food'|'water',idempotencyKey:string){
 if(!currentRoomCare(data))throw Error('care_unavailable');
 if(ownerId!==data.profile.id&&ownerId!==data.partner?.id)throw Error('care_target_not_allowed');
 return {actorId:data.profile.id,ownerId,careAction:roomCareAction(need,ownerId!==data.profile.id),
  partnerId:data.partner?.id??null,pairVersion:data.pairVersion??null,localDate:data.localDate,idempotencyKey};
}
export function roomCareTitle(action:RoomCareAction,name:string){
 return {carrot:'Feed your bunny',water:'Water your flower',leaf:`Feed ${name}'s bunny some greens`,fertilizer:`Fertilize ${name}'s flower`}[action];
}
