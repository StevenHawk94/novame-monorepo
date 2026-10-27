import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { storage } from './storage';
import { kSurpriseDraft } from '@/shared/storage/keys';
import { SURPRISE_DRAFT_DIRECTORY, waitForSurpriseCleanup } from '@/shared/storage/artifacts';
import { sessionEpoch } from './session-lifecycle';
import { syncCoinWallet } from './coin-reward-store';
import type { CoinWalletState } from './coin-reward-ledger';
import { cachedSurpriseHistory, rememberSurprises } from './surprise-history-cache';
import { resolveSurpriseMedia, keepSentSurpriseMedia } from './surprise-media-cache';
export const SURPRISE_FRAMES = ["pumpkin","santa","birthday","ghost","good_night","witch_cauldron","bat","spicy_mood","christmas_ornament","snow_globe","christmas_elf","christmas_stocking","christmas_wreath","snowman","gingerbread_man","champagne","nightcap","alarm_clock","four_leaf_clover","heart","ice_cream","coffee_mug","gold_trophy","easter","popcorn","pizza","game_controller","lollipop","love_polaroid","fried_egg","wrapped_gift","party_hat","birthday_balloons","olive_branch","white_flag","rainbow"] as const;
export type SurpriseFrame = typeof SURPRISE_FRAMES[number];
// Stored history may contain retired IDs; they are never valid for a new draft.
export type Surprise = { id:string; sender_id:string; recipient_id:string; frame:string; duration_ms:number; sent_at:string; opened_at:string|null };
export type SurpriseDraft = { userId:string; partnerId:string; pairVersion:string; key:string; frame:SurpriseFrame; photoUri?:string; audioUri?:string; durationMs?:number; locked?:boolean; sentId?:string; expectedPrice?:number; deliveryVersion?:1 };
export const surpriseTime = (ms:number) => `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export function readSurpriseDraft(userId:string,partnerId:string,pairVersion:string):SurpriseDraft|null {
  try { const draft=JSON.parse(storage.getString(kSurpriseDraft.name)||'null');
    return draft?.userId===userId&&draft.partnerId===partnerId&&draft.pairVersion===pairVersion&&SURPRISE_FRAMES.includes(draft.frame)?draft:null;
  } catch { return null; }
}
export function saveSurpriseDraft(draft:SurpriseDraft) { storage.set(kSurpriseDraft.name,JSON.stringify(draft)); }
export function clearSurpriseDraft() { storage.remove(kSurpriseDraft.name); }
export async function releaseSurpriseFile(uri:string|undefined) {
  if(uri&&SURPRISE_DRAFT_DIRECTORY&&uri.startsWith(SURPRISE_DRAFT_DIRECTORY))await FileSystem.deleteAsync(uri,{idempotent:true}).catch(()=>{});
}
export async function keepSurpriseFile(uri:string,kind:'photo'|'audio') {
  if (!SURPRISE_DRAFT_DIRECTORY) throw Error('Native photo and recording required');
  const epoch=sessionEpoch(); await waitForSurpriseCleanup();
  await FileSystem.makeDirectoryAsync(SURPRISE_DRAFT_DIRECTORY,{intermediates:true});
  const path=`${SURPRISE_DRAFT_DIRECTORY}${randomUUID()}.${kind==='photo'?'jpg':'m4a'}`;
  await FileSystem.copyAsync({from:uri,to:path});
  if(epoch!==sessionEpoch()){await FileSystem.deleteAsync(path,{idempotent:true});throw Error('session_changed');}
  return path;
}
export type SurpriseReceipt={id:string;sentAt?:string;wallet?:{balance:number;version:number};coinState?:CoinWalletState};
export async function sendSurprise(draft:SurpriseDraft, transport?: (body:unknown,key:string)=>Promise<SurpriseReceipt>, onPaid?:(receipt:SurpriseReceipt)=>void, alreadyPaid=false) {
  if(!SURPRISE_FRAMES.includes(draft.frame))throw Error('This frame is no longer available. Choose another frame.');
  if (!draft.photoUri||!draft.audioUri||!draft.durationMs) throw Error('Finish your photo and recording first.');
  const epoch=sessionEpoch();
  if(draft.deliveryVersion===1){
    const files=await Promise.all([draft.photoUri,draft.audioUri].map(uri=>FileSystem.getInfoAsync(uri)));
    if(files.some(file=>!file.exists))throw Object.assign(Error('local_media_missing'),{status:400,body:{error:'invalid_request',reason:'local_media_missing'}});
  }
  const [photo,audio]=await Promise.all([draft.photoUri,draft.audioUri].map(uri=>FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64})));
  if(epoch!==sessionEpoch())throw Error('session_changed');
  const body={action:draft.deliveryVersion===1?'deliver_paid':'send',key:draft.key,partnerId:draft.partnerId,pairVersion:draft.pairVersion,frame:draft.frame,durationMs:draft.durationMs,photo,audio,expectedPrice:draft.expectedPrice};
  if(draft.deliveryVersion===1&&!alreadyPaid){
    const digest=await digestStringAsync(CryptoDigestAlgorithm.SHA256,JSON.stringify([draft.frame,draft.durationMs,photo,audio]));
    if(epoch!==sessionEpoch())throw Error('session_changed');
    const paid=await withDeadline(apiClient.post<SurpriseReceipt>('/api/vnext/surprise',{action:'pay',key:draft.key,partnerId:draft.partnerId,
      pairVersion:draft.pairVersion,frame:draft.frame,durationMs:draft.durationMs,expectedPrice:draft.expectedPrice,digest}));
    if(epoch!==sessionEpoch())throw Error('session_changed');
    onPaid?.(paid);
  }
  const result=transport ? await transport(body,draft.key) : await withDeadline(apiClient.post<{id:string;sentAt?:string;wallet?:{balance:number;version:number};coinState?:CoinWalletState}>('/api/vnext/surprise',body),60000);
  if(epoch!==sessionEpoch())throw Error('session_changed');
  // The outbox owns scoped publication for background sends. Return the raw
  // receipt so a late response from a retired pair cannot reactivate its history
  // or copy files before the worker verifies the current relationship again.
  if(transport)return result;
  if(result.wallet)syncCoinWallet(result.wallet,result.coinState);
  const scope = `${draft.userId}:${draft.partnerId}:${draft.pairVersion}`;
  const previous = cachedSurpriseHistory(scope, 'sent').items.find(item => item.id === result.id);
  rememberSurprises(scope, [{ id: result.id, sender_id: draft.userId, recipient_id: draft.partnerId,
    frame: draft.frame, duration_ms: draft.durationMs, sent_at: result.sentAt ?? previous?.sent_at ?? new Date().toISOString(), opened_at: previous?.opened_at ?? null }]);
  // A failed disk copy must never turn a confirmed paid receipt into a failure.
  await keepSentSurpriseMedia(draft.userId,draft.pairVersion,result.id,draft.photoUri,draft.audioUri).catch(()=>{});
  return result;
}
export const listSurprises=()=>withDeadline(apiClient.get<{items:Surprise[]}>('/api/vnext/surprise'));
export type SurpriseHistoryCursor={sentAt:string;id:string};
export type SurpriseHistoryPage={items:Surprise[];nextCursor:SurpriseHistoryCursor|null};
export const listSurpriseHistory=(direction:'received'|'sent',cursor?:SurpriseHistoryCursor|null)=>withDeadline(apiClient.get<SurpriseHistoryPage>(
  `/api/vnext/surprise?history=${direction}${cursor?`&before=${encodeURIComponent(cursor.sentAt)}&beforeId=${encodeURIComponent(cursor.id)}`:''}`));
export const surpriseMedia=(id:string)=>withDeadline(apiClient.get<{photoUrl:string;audioUrl:string}>(`/api/vnext/surprise?id=${encodeURIComponent(id)}`));
/** History thumbnail fallback; the arrival card now uses fully prepared local media. */
export const surpriseThumbnail=(id:string)=>withDeadline(apiClient.get<{photoUrl:string}>(`/api/vnext/surprise?id=${encodeURIComponent(id)}&photoOnly=1`));
/** Current verified-pair callers replay complete local files without networking. */
export async function loadSurpriseMedia(userId:string,pairVersion:string,id:string){
  return resolveSurpriseMedia(userId,pairVersion,id,()=>surpriseMedia(id));
}
export const openSurprise=(id:string)=>withDeadline(apiClient.post('/api/vnext/surprise',{action:'open',id}));
