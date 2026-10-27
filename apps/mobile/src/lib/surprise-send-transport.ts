import * as FS from 'expo-file-system/legacy';
import { ApiError } from '@novame/api-client';
import { supabase } from './supabase';
import { SURPRISE_DRAFT_DIRECTORY, waitForSurpriseCleanup } from '@/shared/storage/artifacts';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { withDeadline } from './async-lifecycle';
import { randomUUID } from 'expo-crypto';
import type { CoinWalletState } from './coin-reward-ledger';
import { BUNDLED_SHOP_RELEASE } from './generated/shop-catalog-version';

/** Native file-body upload continues across navigation and iOS suspension.
 * The JSON format preserves the existing bounded, validated server transaction.
 * A process restart recovers its receipt with the SAME key before replaying. */
export async function uploadSurpriseInBackground(body:unknown,key:string) {
  if(!SURPRISE_DRAFT_DIRECTORY||!/^[a-f0-9-]{36}$/.test(key))throw Error('invalid_request');
  const epoch=sessionEpoch();await waitForSurpriseCleanup();
  const {data,error}=await withDeadline(supabase.auth.getSession());
  if(error||!data.session?.access_token)throw Error('auth_refresh_failed');
  if(epoch!==sessionEpoch())throw Error('session_changed');
  await FS.makeDirectoryAsync(SURPRISE_DRAFT_DIRECTORY,{intermediates:true});
  const uri=`${SURPRISE_DRAFT_DIRECTORY}${key}.${randomUUID()}.upload.json`;
  let task:ReturnType<typeof FS.createUploadTask>|undefined,unsubscribe=()=>{};
  try{
    await FS.writeAsStringAsync(uri,JSON.stringify(body));
    if(epoch!==sessionEpoch())throw Error('session_changed');
    task=FS.createUploadTask(`${process.env.EXPO_PUBLIC_API_URL}/api/vnext/surprise`,uri,{
      httpMethod:'POST',uploadType:FS.FileSystemUploadType.BINARY_CONTENT,
      sessionType:FS.FileSystemSessionType.BACKGROUND,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`,'X-Burrow-Catalog':BUNDLED_SHOP_RELEASE},
    });
    unsubscribe=subscribeSessionIdentity(()=>{void task?.cancelAsync().catch(()=>{});});
    const result=await withDeadline(task.uploadAsync(),90_000);
    if(!result)throw Error('send_result_unknown');
    let parsed;try{parsed=JSON.parse(result.body);}catch{throw Error('send_result_unknown');}
    if(result.status<200||result.status>=300)throw new ApiError({kind:'http',status:result.status,message:'surprise_send_failed',body:parsed});
    if(typeof parsed.id!=='string')throw Error('send_result_unknown');
    return parsed as {id:string;sentAt?:string;wallet?:{balance:number;version:number};coinState?:CoinWalletState};
  }finally{unsubscribe();void task?.cancelAsync().catch(()=>{});void FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});}
}
/** Restart may lose a native Promise, not its send receipt. Reclaim only that
 * confirmed job's spool files; unrelated queued photos/audio remain untouched. */
export async function clearConfirmedSurpriseUploads(key:string){
  if(!SURPRISE_DRAFT_DIRECTORY||!/^[a-f0-9-]{36}$/.test(key))return;
  const names=await FS.readDirectoryAsync(SURPRISE_DRAFT_DIRECTORY).catch(()=>[]);
  await Promise.all(names.filter(name=>name.startsWith(`${key}.`)&&/^[a-f0-9.-]+\.upload\.json$/.test(name))
    .map(name=>FS.deleteAsync(`${SURPRISE_DRAFT_DIRECTORY}${name}`,{idempotent:true}).catch(()=>{})));
}
