import type {CoupleFriendVisit} from './app-major-update-api';
/** A missing local conversation is not the same fact as an empty room. */
export function friendVisitPresentation(visit:CoupleFriendVisit|null,serverNow:string,expiredId:string,
  local:{choiceId?:string;done?:boolean;status?:string}|undefined,reading:boolean) {
  const deadline=visit?.expiresAt?Date.parse(visit.expiresAt):NaN;
  const active=!!visit&&visit.id!==expiredId&&!(Number.isFinite(deadline)&&deadline<=Date.parse(serverNow));
  if(reading)return 'conversation' as const;
  if(!active||visit.partnerCompleted&&(visit.myCompleted||local?.done&&local.status==='confirmed'))return 'empty' as const;
  if(visit.myCompleted)return 'waiting' as const;
  if(local?.choiceId&&local.done&&local.status!=='rejected')return local.status==='confirmed'?'waiting' as const:'syncing' as const;
  return 'prepare' as const;
}
