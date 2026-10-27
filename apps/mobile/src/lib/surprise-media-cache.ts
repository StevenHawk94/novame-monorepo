import * as FS from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { storage } from './storage';
import { kSurpriseMedia } from '@/shared/storage/keys';
import { SURPRISE_MEDIA_DIRECTORY, SURPRISE_LEGACY_MEDIA_DIRECTORY, waitForSurpriseCleanup } from '@/shared/storage/artifacts';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { withDeadline } from './async-lifecycle';

export type SurpriseMedia = { photoUrl: string; audioUrl: string; portraitUri?: string };
type Entry = { bytes: number; usedAt: number };
const flights = new Map<string, Promise<SurpriseMedia>>();
const pinned = new Map<string,number>();
const downloads=new Map<string,Set<{cancelAsync:()=>Promise<void>}>>();
const evictions=new Map<string,Promise<void>>();
const revoked = new Set<string>();
const BUDGET = 128 * 1024 * 1024;
const valid = (user:string, pair:string, id:string) => /^[a-f0-9-]{36}$/.test(user)
  && /^[a-f0-9]{32}$/.test(pair) && /^[a-f0-9-]{36}$/.test(id);
const key = (user:string,pair:string) => kSurpriseMedia.keyFor(`${user}:${pair}`);
function index(user:string,pair:string): Record<string,Entry> {
  try { const value=JSON.parse(storage.getString(key(user,pair)) || '{}');
    return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter((entry):entry is [string,Entry]=>{
      const [id,row]=entry;return valid(user,pair,id)&&!!row&&typeof row==='object'&&Number.isFinite((row as Entry).bytes)&&Number.isFinite((row as Entry).usedAt);
    })):{};
  } catch { return {}; }
}
const allowed=(user:string,pair:string,epoch:number)=>epoch===sessionEpoch()&&!revoked.has(`${user}:${pair}`);
function paths(user:string,pair:string,id:string, directory=SURPRISE_MEDIA_DIRECTORY): SurpriseMedia {
  const prefix=`${directory}${user}-${pair}-${id}`;
  return {photoUrl:`${prefix}.jpg`,audioUrl:`${prefix}.m4a`};
}
export function cachedSurpriseMedia(user:string,pair:string,id:string): SurpriseMedia|null {
  return valid(user,pair,id)&&SURPRISE_MEDIA_DIRECTORY&&index(user,pair)[id] ? paths(user,pair,id) : null;
}
export function pinSurpriseMedia(user:string,pair:string,id:string) {
  const token=`${user}:${pair}:${id}`,epoch=sessionEpoch();pinned.set(token,(pinned.get(token)??0)+1);return()=>{if(epoch!==sessionEpoch())return;const count=(pinned.get(token)??1)-1;if(count>0)pinned.set(token,count);else pinned.delete(token);};
}
async function complete(media:SurpriseMedia) {
  const infos=await Promise.all([media.photoUrl,media.audioUrl,portraitPath(media.photoUrl)].map(uri=>FS.getInfoAsync(uri)));
  return infos.slice(0,2).every(info=>info.exists && !info.isDirectory && info.size>0)
    ? infos.reduce((sum,info)=>sum+(info.exists&&!info.isDirectory?info.size:0),0) : 0;
}
async function remember(user:string,pair:string,id:string,bytes:number,epoch:number) {
  if(!allowed(user,pair,epoch))throw Error('session_changed');
  const entries=index(user,pair);entries[id]={bytes,usedAt:Date.now()};
  // Evict whole pairs by actual access time; never an in-use/opening message.
  let total=Object.values(entries).reduce((sum,row)=>sum+(Number(row.bytes)||0),0);
  const removing:string[]=[];
  for(const [old,row] of Object.entries(entries).sort((a,b)=>a[1].usedAt-b[1].usedAt)) {
    if(total<=BUDGET)break;
    if(old===id||pinned.has(`${user}:${pair}:${old}`))continue;
    removing.push(old);delete entries[old];total-=row.bytes;
  }
  // Publish index changes synchronously before filesystem awaits, so concurrent
  // downloads/portrait preparation cannot overwrite each other's entries.
  storage.set(key(user,pair),JSON.stringify(entries));
  await Promise.all(removing.map(old=>{
    const file=paths(user,pair,old),token=`${user}:${pair}:${old}`;
    const task=Promise.all([file.photoUrl,file.audioUrl,portraitPath(file.photoUrl)].map(uri=>FS.deleteAsync(uri,{idempotent:true})))
      .then(()=>{}).finally(()=>{if(evictions.get(token)===task)evictions.delete(token);});
    evictions.set(token,task);return task;
  }));
}
/** A complete local pair takes the fast path before any network authorization.
 * Callers must hold the current, verified relationship scope. Downloads still
 * authorize on the server; no signed link is persisted. */
export function resolveSurpriseMedia(user:string,pair:string,id:string,links:()=>Promise<SurpriseMedia>):Promise<SurpriseMedia> {
  if(!valid(user,pair,id))return Promise.reject(Error('invalid_request'));
  const token=`${user}:${pair}:${id}`;const active=flights.get(token);if(active)return active;
  const epoch=sessionEpoch();const unpin=pinSurpriseMedia(user,pair,id);
  const task=(async()=>{
    if(!SURPRISE_MEDIA_DIRECTORY)return links();
    await waitForSurpriseCleanup();
    await evictions.get(token);
    if(!allowed(user,pair,epoch))throw Error('session_changed');
    await FS.makeDirectoryAsync(SURPRISE_MEDIA_DIRECTORY,{intermediates:true});
    const local=paths(user,pair,id);let bytes=await complete(local);
    if(!bytes&&SURPRISE_LEGACY_MEDIA_DIRECTORY){
      const old=paths(user,pair,id,SURPRISE_LEGACY_MEDIA_DIRECTORY);
      if(await complete(old))await Promise.all([[old.photoUrl,local.photoUrl],[old.audioUrl,local.audioUrl]].map(([from,to])=>FS.copyAsync({from,to})));
      bytes=await complete(local);
    }
    if(!bytes){
      const signed=await links();
      await Promise.all([[signed.photoUrl,local.photoUrl],[signed.audioUrl,local.audioUrl]].map(async([url,to])=>{
        const temporary=`${to}.${randomUUID()}.part`;let accepting=true;
        const downloadTask=FS.createDownloadResumable(url,temporary,{sessionType:FS.FileSystemSessionType.BACKGROUND});
        const scopeKey=`${user}:${pair}`,active=downloads.get(scopeKey)??new Set();active.add(downloadTask);downloads.set(scopeKey,active);
        try{
          const download=downloadTask.downloadAsync().then(result=>{
            if(!accepting||!allowed(user,pair,epoch))void FS.deleteAsync(temporary,{idempotent:true}).catch(()=>{});
            return result;
          });
          const result=await withDeadline(download,60_000);
          if(result?.status!==200||!allowed(user,pair,epoch))throw Error('media_unavailable');
          await FS.deleteAsync(to,{idempotent:true});await FS.moveAsync({from:temporary,to});
          if(!allowed(user,pair,epoch)){await FS.deleteAsync(to,{idempotent:true});throw Error('session_changed');}
        } finally { accepting=false;active.delete(downloadTask);if(!active.size)downloads.delete(scopeKey);void downloadTask.cancelAsync().catch(()=>{});void FS.deleteAsync(temporary,{idempotent:true}).catch(()=>{}); }
      }));
      bytes=await complete(local);if(!bytes)throw Error('media_unavailable');
    }
    await remember(user,pair,id,bytes,epoch);return local;
  })().finally(()=>{unpin();if(flights.get(token)===task)flights.delete(token);});
  flights.set(token,task);return task;
}
/** Promote the sender's already-local originals; never re-download a sent gift. */
export async function keepSentSurpriseMedia(user:string,pair:string,id:string,photo:string,audio:string) {
  if(!SURPRISE_MEDIA_DIRECTORY||!valid(user,pair,id))return;
  const epoch=sessionEpoch();await waitForSurpriseCleanup();if(!allowed(user,pair,epoch))throw Error('session_changed');
  await evictions.get(`${user}:${pair}:${id}`);if(!allowed(user,pair,epoch))throw Error('session_changed');
  await FS.makeDirectoryAsync(SURPRISE_MEDIA_DIRECTORY,{intermediates:true});
  const local=paths(user,pair,id);
  await Promise.all([[photo,local.photoUrl],[audio,local.audioUrl]].map(([from,to])=>FS.copyAsync({from,to})));
  if(!allowed(user,pair,epoch)){await Promise.all([local.photoUrl,local.audioUrl].map(uri=>FS.deleteAsync(uri,{idempotent:true})));throw Error('session_changed');}
  const bytes=await complete(local);if(!bytes)throw Error('media_unavailable');
  await remember(user,pair,id,bytes,epoch);
}
export async function clearSurpriseMediaScope(user:string,pair:string) {
  if(!/^[a-f0-9-]{36}$/.test(user)||!/^[a-f0-9]{32}$/.test(pair))return;
  revoked.add(`${user}:${pair}`);
  for(const task of downloads.get(`${user}:${pair}`)??[])void task.cancelAsync().catch(()=>{});
  storage.remove(key(user,pair));
  if(!SURPRISE_MEDIA_DIRECTORY)return;
  const prefix=`${user}-${pair}-`;
  const names=await FS.readDirectoryAsync(SURPRISE_MEDIA_DIRECTORY).catch(()=>[]);
  await Promise.all(names.filter(name=>name.startsWith(prefix)&&/^[a-z0-9.-]+$/.test(name)).map(name=>FS.deleteAsync(`${SURPRISE_MEDIA_DIRECTORY}${name}`,{idempotent:true})));
}
export async function invalidateSurpriseMedia(user:string,pair:string,id:string){
  if(!valid(user,pair,id)||!SURPRISE_MEDIA_DIRECTORY)return;
  const entries=index(user,pair);delete entries[id];storage.set(key(user,pair),JSON.stringify(entries));
  const files=paths(user,pair,id);await Promise.all([files.photoUrl,files.audioUrl,portraitPath(files.photoUrl)].map(uri=>FS.deleteAsync(uri,{idempotent:true})));
}
export const portraitPath=(photo:string)=>photo.replace(/\.jpg$/,'.portrait.png');
export async function rememberSurprisePortrait(user:string,pair:string,id:string){
  const epoch=sessionEpoch();const bytes=await complete(paths(user,pair,id));if(bytes)await remember(user,pair,id,bytes,epoch);
}
subscribeSessionIdentity(()=>{for(const tasks of downloads.values())for(const task of tasks)void task.cancelAsync().catch(()=>{});downloads.clear();revoked.clear();flights.clear();pinned.clear();});
