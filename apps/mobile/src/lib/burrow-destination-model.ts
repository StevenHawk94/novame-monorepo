import type {MajorUpdateBootstrap} from './app-major-update-api';

/** Parameterized tasks/deep links retain their original navigation lifetime. */
export function burrowDestinationId({params}:{params?:Record<string,unknown>}){
  const section=String(params?.section??'');
  if(!['affection','adventure','memories_room'].includes(section)||
    Object.keys(params??{}).some(key=>key!=='section'))return undefined;
  return `prepared:${section}`;
}
export function burrowPreloadDestinations(data:MajorUpdateBootstrap,source:string){
  if(source==='burrow')return ['memories_room'];
  if(source!=='home')return [];
  // Ready records have a removal guard; settlements have reward effects.
  return ['affection',...(!data.readyRecordId&&!data.dailyAdventureUsed&&
    (!data.activeAdventure||data.activeAdventure.status==='in_progress')?['adventure']:[])];
}
