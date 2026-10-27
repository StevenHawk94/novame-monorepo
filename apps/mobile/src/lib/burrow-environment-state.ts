import {burrowMapEnvironment} from './burrow-map-model';
import {HOME_BACKGROUND_FLOOR,HOME_SEASON_BACKGROUNDS,HOME_WINDOW_LANDSCAPES} from './burrow-art-assets';
import {BURROW_MAP_ART} from './burrow-map-assets';
import {prepareBurrowImages,preparedBurrowImage,retainEnvironmentImages} from './prepared-burrow-images';

export type BurrowEnvironment=ReturnType<typeof burrowMapEnvironment>;
export type EnvironmentContext={owner:string;timeZone?:string|null;country?:string};
type Snapshot={context:EnvironmentContext|null;key:string|null;environment:BurrowEnvironment|null;pending:boolean;failed:boolean};
let snapshot:Snapshot={context:null,key:null,environment:null,pending:false,failed:false};
let generation=0,flight:{key:string;promise:Promise<void>}|null=null;
const listeners=new Set<()=>void>();
export const getBurrowEnvironment=()=>snapshot;
export const subscribeBurrowEnvironment=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function publish(next:Snapshot){snapshot=next;listeners.forEach(listener=>listener());}
export const burrowEnvironmentKey=(context:EnvironmentContext,environment:BurrowEnvironment)=>JSON.stringify([context.owner,context.timeZone??'',context.country??'',environment.banner]);
export function burrowEnvironmentSources(environment:BurrowEnvironment){
  const art=HOME_SEASON_BACKGROUNDS[environment.season];
  return [HOME_BACKGROUND_FLOOR.source,art.source,art.nightSource!,
    HOME_WINDOW_LANDSCAPES[environment.season].day,HOME_WINDOW_LANDSCAPES[environment.season].night,
    BURROW_MAP_ART.banners[`${environment.season}-day`],BURROW_MAP_ART.banners[`${environment.season}-night`]];
}
export function burrowEnvironmentIsReady(context:EnvironmentContext,now=Date.now()){
  const environment=burrowMapEnvironment(now,context.timeZone??undefined,context.country);
  return snapshot.key===burrowEnvironmentKey(context,environment)&&!snapshot.pending&&!snapshot.failed
    &&burrowEnvironmentSources(environment).every(source=>!!preparedBurrowImage(source));
}
/** Commit Home AND map together only after both periods have native refs.
 * Epoch/calendar time is visual only; reward/settlement clocks are untouched. */
export function prepareBurrowEnvironment(context:EnvironmentContext):Promise<void>{
  const prior=snapshot.context;
  if(!prior||prior.owner!==context.owner||prior.timeZone!==context.timeZone||prior.country!==context.country){
    generation++;flight=null;
    publish({...snapshot,context,pending:true,failed:false});
  }
  return refreshBurrowEnvironment();
}
export function refreshBurrowEnvironment():Promise<void>{
  const context=snapshot.context;if(!context)return Promise.resolve();
  const environment=burrowMapEnvironment(Date.now(),context.timeZone??undefined,context.country);
  const key=burrowEnvironmentKey(context,environment),sources=burrowEnvironmentSources(environment);
  // Keep the complete outgoing scene resident while the next season decodes.
  // Otherwise a thumbnail warmup could evict a still-visible map/header and
  // make it fall back to an asynchronous asset read during this handoff.
  retainEnvironmentImages([...(snapshot.environment?burrowEnvironmentSources(snapshot.environment):[]),...sources]);
  if(sources.every(source=>!!preparedBurrowImage(source))){
    // Even when a decode for a different period is resolving, a current cached
    // period wins synchronously. No old response may restore a stale scene.
    generation++;flight=null;
    if(snapshot.key!==key||snapshot.pending||snapshot.failed)publish({context,key,environment,pending:false,failed:false});
    retainEnvironmentImages(sources);
    return Promise.resolve();
  }
  if(flight?.key===key)return flight.promise;
  const token=++generation;
  publish({...snapshot,context,pending:true,failed:false});
  const task=prepareBurrowImages(sources).then(()=>{
    if(token!==generation){
      if(snapshot.key===key&&!snapshot.pending&&!snapshot.failed)return;
      throw Error('environment_superseded');
    }
    // Midnight/season or daylight can cross while decoding. Never release an
    // entry cover with the scene that was correct only when the read started.
    if(burrowMapEnvironment(Date.now(),context.timeZone??undefined,context.country).banner!==environment.banner){
      flight=null;return refreshBurrowEnvironment();
    }
    publish({context,key,environment,pending:false,failed:false});
    retainEnvironmentImages(sources);
  }).catch(error=>{
    if(token===generation)publish({...snapshot,pending:true,failed:true});
    throw error;
  }).finally(()=>{if(flight?.promise===task)flight=null;});
  flight={key,promise:task};return task;
}
