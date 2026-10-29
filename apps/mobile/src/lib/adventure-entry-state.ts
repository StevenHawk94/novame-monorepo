import type {MajorUpdateBootstrap} from './app-major-update-api';
import type {AdventureDelivery} from './adventure-delivery-queue';
import {burrowLocalDay} from './burrow-local-day';

export const adventureScope=(data:MajorUpdateBootstrap)=>`${data.profile.id}:${data.partner?.id??'solo'}:${data.pairVersion??''}`;
/** Only the server-anchored clock and fixed economic timezone define this day.
 * This is an Adventure presentation/intent date, never a reset of other quotas. */
export function adventureDay(data:MajorUpdateBootstrap,now:number){
  try{return burrowLocalDay(now,data.economicTimezone??data.profile.timezone_name);}catch{return data.localDate;}
}
export function adventureJourneyDay(data:MajorUpdateBootstrap){
  const a=data.activeAdventure;
  if(!a)return undefined;
  return a.local_date??adventureDay(data,Date.parse(a.started_at));
}
export function adventureEntryState(data:MajorUpdateBootstrap|null|undefined,now:number,rows:readonly AdventureDelivery[]=[]){
  if(!data)return {kind:'unavailable' as const,day:''};
  const day=adventureDay(data,now),scope=adventureScope(data);
  const own=rows.filter(row=>row.owner===data.profile.id&&row.scope===scope);
  const a=data.activeAdventure,job=a?own.find(row=>row.id===a.id):undefined;
  const complete=!!job?.finish&&!job.failed;
  if(a&&!complete){
    if(['result_ready','interaction_required'].includes(a.status)||a.status==='in_progress'&&Date.parse(a.ends_at)<=now)
      return {kind:'settlement' as const,day,adventureId:a.id};
    if(a.status==='in_progress')return {kind:'ongoing' as const,day,adventureId:a.id};
  }
  if(!a&&data.adventureResult&&data.adventureResult.claim_status!=='claimed'
    &&!own.some(row=>row.id===data.adventureResult!.adventure_id&&row.finish&&!row.failed))
    return {kind:'settlement' as const,day,adventureId:data.adventureResult.id};
  const used=data.localDate===day&&data.dailyAdventureUsed
    ||!!a&&adventureJourneyDay(data)===day
    ||own.some(row=>row.journeyDay===day&&(row.finish||row.treasure||row.choiceId));
  if(used)return {kind:'napping' as const,day};
  if(data.readyRecordId&&(data.readyRecordLocalDate??data.localDate)===day)
    return {kind:'ready' as const,day,recordId:data.readyRecordId};
  return {kind:'log' as const,day};
}
