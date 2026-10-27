import type { MajorUpdateBootstrap } from './app-major-update-api';
import type { NotificationDestination } from './notification-readiness';

export const notificationScope=(data:MajorUpdateBootstrap)=>`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`;
// Published snapshots are immutable and structurally shared. Keep one entry
// per channel (bounded), so wallet/clock updates do not rescan whole histories
// or stringify gift artwork on every registry retry and badge read.
const versions=new Map<NotificationDestination,{dependencies:unknown[];value:string}>();
/** Business versions only: wallet ticks/clock changes cannot invalidate a ready
 * journal or invite. Include timezone/day to prevent a stale daily page. */
export function notificationContentVersion(data:MajorUpdateBootstrap,kind:NotificationDestination):string{
  const attention=data.attention?.scope===notificationScope(data)?data.attention:null;
  const meta=data.adventureResult?.metadata??data.adventurePlan?.result.metadata;
  const dependencies=kind==='gifts'?[data.gifts,data.gifts?.length,data.partner?.display_name,data.catalog,data.catalog?.length,data.giftCatalog,data.giftCatalog?.length]
    :kind==='games'?[attention?.games,attention?.games?.length]
    :kind==='journal'?[data.localDate,data.profile.timezone_name,attention?.journal,attention?.journal?.length,data.moments,data.moments?.length]
    :kind==='letters'?[attention?.letters,attention?.letters?.length,data.memoryEntries,data.memoryEntries?.length]
    :kind==='moments'?[data.profile.timezone_name,attention?.moments,attention?.moments?.length,data.moments,data.moments?.length]
    :kind==='visits'?[data.friendVisit?.id,data.friendVisit?.version,data.friendVisit?.version===2?data.friendVisit.partnerCompleted:false]
    :[data.activeAdventure?.id,meta?.encounterV2,meta?.treasureSnapshot?.stable_id,meta?.treasureCoins,meta?.giftSnapshot?.stable_id,meta?.friendSnapshot?.stable_id];
  const before=versions.get(kind);
  if(before&&dependencies.length===before.dependencies.length&&dependencies.every((value,index)=>Object.is(value,before.dependencies[index])))return before.value;
  const value=contentVersion(data,kind,attention);
  versions.set(kind,{dependencies,value});return value;
}
function contentVersion(data:MajorUpdateBootstrap,kind:NotificationDestination,attention:MajorUpdateBootstrap['attention']|null|undefined):string{
  if(kind==='gifts')return JSON.stringify([(data.gifts??[]).map(gift=>[gift.id,gift.item_id,gift.sender_id,gift.created_at]),
    data.partner?.display_name,(data.gifts??[]).map(gift=>[...(data.catalog??[]),...(data.giftCatalog??[])].find(item=>item.stable_id===gift.item_id))]);
  if(kind==='games')return JSON.stringify(attention?.games??[]);
  if(kind==='journal')return JSON.stringify([data.localDate,data.profile.timezone_name,attention?.journal??[],
    (data.moments??[]).filter(row=>row.event_type==='memory_created'||row.event_type==='couple_journal_answered').map(row=>[row.id,row.created_at])]);
  if(kind==='letters')return JSON.stringify([attention?.letters??[],(data.memoryEntries??[]).filter(row=>row.body.startsWith('💌 ')).map(row=>[row.id,row.updated_at])]);
  if(kind==='moments')return JSON.stringify([data.profile.timezone_name,attention?.moments??[],(data.moments??[]).map(row=>[row.id,row.created_at])]);
  if(kind==='visits')return JSON.stringify([data.friendVisit?.id,data.friendVisit?.version===2?data.friendVisit.partnerCompleted:false]);
  const meta=data.adventureResult?.metadata??data.adventurePlan?.result.metadata;
  return JSON.stringify([data.activeAdventure?.id,meta?.encounterV2,meta?.treasureSnapshot?.stable_id,meta?.treasureCoins,meta?.giftSnapshot?.stable_id,meta?.friendSnapshot?.stable_id]);
}
