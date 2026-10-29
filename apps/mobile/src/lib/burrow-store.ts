import { useCallback, useRef, useSyncExternalStore } from 'react';
import { coinPresentationTiming } from './burrow-motion';
import {mergeRoomCare} from './room-care-model';
import { adventureDurationMs } from './adventure-duration';
import { accountProfileRevision, projectAccountProfile, subscribeAccountProfile } from './account-profile-local';
import {configureAvatarPair} from './avatar';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { AppState, InteractionManager } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { fetchMajorUpdateBootstrap, type AdventureDisplay, type MajorUpdateBootstrap } from './app-major-update-api';
import { mergeAdventureArrival } from './adventure-arrival';
import { withDeadline, HOME_BOOTSTRAP_TIMEOUT_MS } from './async-lifecycle';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { clearBurrowSnapshot, persistBurrowSnapshot, persistBurrowWallet, readBurrowSnapshot, persistBurrowActionKeys, readBurrowActionKeys } from './burrow-cache';
import { syncCoinWallet, useCoinBalance, setCoinRewardReconciler, subscribeCoinWallet, getConfirmedCoinWallet, getCoinRewardSnapshot } from './coin-reward-store';
import type { DailyPlusBonusState } from './daily-plus-bonus';
import { createRoomEditQueue, sameRoomScope } from './room-edit-queue';
import { roomDesignIds, roomEditScope, withRoomDesign, isCurrentRoomItem } from './room-edit-design';
import { projectCoinSpend, settleCoinSpend, rejectCoinSpend } from './coin-reward-store';
import { apiClient } from './api';
import { storage } from './storage';
import { kPersonalRoomEdits as kBurrowRoomEdits, kShopPurchases } from '../shared/storage/keys';
import { coinRewardDefinitelyRejected, type CoinResponse } from './coin-reward-store';
import { showCoinPurchaseNotice, showCoinPurchaseSuccess } from './coin-purchase-prompt';
import { trackItemPurchaseForRating } from './official-rating-milestones';
import { afterUiSettles, yieldToUi } from './ui-idle';
import { shareSnapshotWhenIdle } from './idle-snapshot-sharing';
import { gameReads } from './game-read-coordinator';
import { retainedPageChanged, type RetainedPage } from './retained-page-model';
import { uiWorkPriority } from './ui-work-priority';
import { createShopGiftQueue } from './shop-gift-queue';
import { projectShopGift, shopGiftItem } from './shop-gift-model';
import { kShopGiftClaims } from '../shared/storage/keys';
import { notificationScope } from './notification-content-version';
import { createPlushiePhotoOutbox, type PlushiePhotoJob } from './plushie-photo-outbox';
import { adoptRoomPhotoPreview, invalidateRoomPhotoCache, keepRoomPhotoPreview } from './burrow-room-photo-cache';
import { saveRoomPhoto } from './app-major-update-api';
import { kPlushiePhotoOutbox, kFramePhotoOutbox } from '../shared/storage/keys';
import { showBurrowToast } from './burrow-toast';
import { configureQuestProgress, questProgress } from './quest-progress-store';
import { burrowLocalDay } from './burrow-local-day';
import {adventureDay} from './adventure-entry-state';
import {readAdventureDeliveryRows} from './adventure-delivery-state';
import { coinOperations, enqueueAffectionCommand } from './coin-command-outbox';
import { freeAffectionUsedToday } from './burrow-daily-entry';
import { questScope } from './quest-progress-model';
import type { AffectionType } from '@novame/domain';
import { createCoinOperationQueue } from './coin-operation-queue';
import { createLoveNoteOutbox } from './love-note-outbox';
import { configureJournal,observeJournalAppState } from './couple-journal';
import { kLoveNoteOutbox } from '../shared/storage/keys';
import { LOVE_NOTE_PREFIX } from './love-note-model';

type State = { data: MajorUpdateBootstrap | null; loading: boolean; busy: boolean; error: string | null; syncError: string | null; receivedAt: number; pairInvalidated: boolean };
let state: State = { data: null, loading: false, busy: false, error: null, syncError: null, receivedAt: 0, pairInvalidated: false };
let pendingPersistence: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
let persistNotBefore = 0;
function cancelPersistence() {
  pendingPersistence?.cancel(); pendingPersistence = null;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = null; persistNotBefore = 0;
}
function persistWhenIdle(notBefore = 0) {
  persistNotBefore = Math.max(persistNotBefore, notBefore);
  pendingPersistence?.cancel();pendingPersistence=null;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = null;
  const epoch=sessionEpoch();
  const write=()=>{
    pendingPersistence=null;
    if (epoch !== sessionEpoch()) return;
    // Reanimated doesn't register an InteractionManager handle. Reserve the
    // reward beat explicitly, and coalesce full-cache serialization after it.
    const wait = Math.max(persistNotBefore - burrowClock(),uiWorkPriority.delay());
    if (wait > 0) {
      persistenceTimer = setTimeout(() => { persistenceTimer = null; if (epoch === sessionEpoch()) persistWhenIdle(); }, wait);
      return;
    }
    // Persist the latest state, not a captured pre-purchase/pre-photo snapshot.
    if(epoch===sessionEpoch()&&state.data)persistBurrowSnapshot(state.data,burrowClock()-state.receivedAt);
  };
  if(InteractionManager?.runAfterInteractions)pendingPersistence=InteractionManager.runAfterInteractions(write);
  else write();
}
const listeners = new Set<() => void>();
const pendingKeys = new Map<string, string>();
const confirmedPhotos = new Map<string, { photo: MajorUpdateBootstrap['roomPhotos'][number]; after: number; usage?:MajorUpdateBootstrap['photoUsage'] }>();
const confirmedInventory = new Map<string, { row: MajorUpdateBootstrap['inventory'][number]; after: number }>();
const confirmedLoadouts = new Map<string, { rows: MajorUpdateBootstrap['loadouts']; ownerId: string; outfit: boolean; after: number }>();
const confirmedShelfGifts = new Map<string, { itemId: string; after: number }>();
const confirmedAdventures = new Map<string, number>();
const confirmedAdventureInteractions = new Map<string, { after: number; treasureClaimed: boolean }>();
const localVisitAnswers = new Map<string,{scope:string;confirmedAt?:number}>();
const receivedAffections = new Map<string,{scope:string;confirmedAt?:number}>();
let confirmedAffection: { senderId: string; at: string; after: number;usage?:MajorUpdateBootstrap['affectionUsage'] } | null = null;
let musicSelection: { id: string | null; token: number; after: number } | null = null;
let musicToken = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const subscribeBurrowSnapshot=subscribe;
const publish = (patch: Partial<State>) => {
  if(patch.data){
    patch.data = { ...patch.data, profile: projectAccountProfile(patch.data.profile) };
    patch.data = questProgress.project(patch.data);
    patch.data = projectPendingShopPurchases(patch.data);
    const receivedData=patch.data,receivedScope=notificationScope(receivedData);
    const hidden=new Set([...receivedAffections].filter(([,row])=>row.scope===receivedScope).map(([id])=>id));
    if(hidden.size){
      const known=new Set([...(receivedData.affectionInbox??[]).map(row=>row.id),...(receivedData.affectionInboxGroups??[]).flatMap(row=>row.ids)]);
      const removed=[...hidden].filter(id=>known.has(id)).length;
      if(removed)patch.data={...receivedData,affectionInbox:receivedData.affectionInbox.filter(row=>!hidden.has(row.id)),
        ...(receivedData.affectionInboxGroups?{affectionInboxGroups:receivedData.affectionInboxGroups.map(g=>({...g,ids:g.ids.filter(id=>!hidden.has(id))})).filter(g=>g.ids.length)}:{}),
        unread:{...receivedData.unread,affection:Math.max(0,receivedData.unread.affection-removed)}};
    }
    const affectionData=patch.data;
    const pendingAffection=coinOperations.pending().filter(row=>row.payload.action==='complete_affection'
      &&row.quest?.scope===questScope(affectionData).scope&&row.quest.day===affectionData.localDate
      &&!affectionData.affectionUsage?.keys?.includes(String(row.payload.idempotencyKey))).length;
    if(affectionData.affectionUsage)patch.data={...affectionData,affectionUsage:{...affectionData.affectionUsage,pending:pendingAffection}};
    try{photoOutbox.receive({userId:patch.data.profile.id,partnerId:patch.data.partner?.id??'',pairVersion:patch.data.pairVersion??''});
      patch={...patch,data:photoOutbox.project(patch.data)};
    }catch{console.warn('[plushie-photo/local]','outbox_unavailable');}
    try{framePhotoOutbox.receive({userId:patch.data!.profile.id,partnerId:patch.data!.partner?.id??'',pairVersion:patch.data!.pairVersion??''});
      patch={...patch,data:framePhotoOutbox.project(patch.data!)};
    }catch{console.warn('[frame-photo/local]','outbox_unavailable');}
    try{loveNoteOutbox.receive({userId:patch.data!.profile.id,partnerId:patch.data!.partner?.id??'',pairVersion:patch.data!.pairVersion??''});}
    catch{console.warn('[love-note/local]','outbox_unavailable');}
    try{configureJournal(patch.data!);}catch{console.warn('[journal/local]','outbox_unavailable');}
    // Final sharing follows every optimistic projection. Silent remote reads
    // already shared their unchanged large branches in interruptible slices;
    // those references are O(1) here. Local intents never wait on that work.
    patch.data=shareBurrowSnapshot(state.data,patch.data)!;
  }
  if (Object.entries(patch).every(([key,value]) => Object.is(state[key as keyof State],value))) return;
  state = { ...state, ...patch };
  if('data' in patch)configureAvatarPair(state.data?.profile??null,state.data?.partner??null);
  listeners.forEach(listener => { try { listener(); } catch { console.warn('[burrow/observer]', 'notification_failed'); } });
};
configureQuestProgress(() => {
  const data=state.data;if(!data||state.pairInvalidated)return null;
  // A stale pre-midnight assignment cannot be projected into a new day. The
  // existing background read supplies that day's real server assignments.
  const now=Date.parse(data.serverNow)+Math.max(0,burrowClock()-state.receivedAt);
  return Number.isFinite(now)&&burrowLocalDay(now,data.economicTimezone ?? data.profile.timezone_name)===data.localDate?data:null;
}, () => {
  if (state.data) publish({ data: questProgress.project(state.data) });
});
subscribeAccountProfile(() => {
  if (state.data && state.data.profile.id === sessionUserId()) {
    publish({ data: { ...state.data, profile: projectAccountProfile(state.data.profile, -1) } });
    persistWhenIdle();
  }
});
const photoOutbox=createPlushiePhotoOutbox({
  owner:sessionUserId,active:()=>AppState.currentState==='active',
  load:owner=>JSON.parse(storage.getString(kPlushiePhotoOutbox.keyFor(owner))??'null'),
  save:(owner,jobs)=>storage.set(kPlushiePhotoOutbox.keyFor(owner),JSON.stringify(jobs)),
  send:async job=>{
    if(catalogPurchases.pending().some(row=>row.payload.itemId===job.toyId&&row.payload.recipientId===job.ownerId)
      ||job.ownerId===job.userId&&roomEdits.pending().some(edit=>edit.purchased.includes(job.toyId)))
      throw Error('purchase_sync_pending');
    const saved=await saveRoomPhoto(job.ownerId,'doll',job.base64,job.key,job.userId,job.partnerId,job.toyId);
    let photo=saved.photo;
    if(!photo){
      await refreshBurrowAfterCurrent({after:burrowClock()});
      const candidate=photoOutbox.serverPhoto(job);
      if(candidate&&candidate.id===saved.photoId&&candidate.updatedAt!==job.previous?.updatedAt)photo=candidate;
    }
    if(!photo)throw Error('photo_receipt_unavailable');
    return {photo,photoUsage:saved.photoUsage};
  },
  changed:()=>{if(state.data){publish({data:photoOutbox.project(state.data)});persistWhenIdle();}},
  confirmed:(job,receipt)=>{
    try{adoptRoomPhotoPreview(receipt.photo,job.preview);}catch{console.warn('[plushie-photo/cache]','adoption_failed');}
    setBurrowPhotoLocally(receipt.photo,receipt.photoUsage);scheduleBurrowRefresh();
  },
  rejected:(_job,code)=>{
    showBurrowToast(code==='upload_limit'?'You’ve uploaded too many photos. Please try again later.'
      :'Your photo could not be synced. Your previous photo has been restored. Please try again.');
    scheduleBurrowRefresh();
  },
  retire:invalidateRoomPhotoCache,code:errorCode,schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
export const plushiePhotoSyncState=(photoId:string)=>photoOutbox.photoSyncState(photoId);
const loveNoteOutbox=createLoveNoteOutbox({
  owner:sessionUserId,active:()=>AppState.currentState==='active',
  load:owner=>JSON.parse(storage.getString(kLoveNoteOutbox.keyFor(owner))??'null'),
  save:(owner,jobs)=>storage.set(kLoveNoteOutbox.keyFor(owner),JSON.stringify(jobs)),
  send:async job=>{
    const data=state.data;
    if(!data||data.profile.id!==job.userId||(data.partner?.id??'')!==job.partnerId||(data.pairVersion??'')!==job.pairVersion)throw Error('pair_changed');
    // The existing paired endpoint checks the pair generation atomically.
    // Preserve the existing solo Save route when there is no recipient.
    const payload=job.partnerId?{action:'save_memory_durable',actorId:job.userId,partnerId:job.partnerId,pairVersion:job.pairVersion,
      entryId:null,body:LOVE_NOTE_PREFIX+job.body,promptId:null,expectedUpdatedAt:null,idempotencyKey:job.key}
      :{action:'save_memory',entryId:null,body:LOVE_NOTE_PREFIX+job.body,promptId:null,idempotencyKey:job.key};
    const controller=new AbortController();
    const cancelIfChanged=()=>{const now=state.data;if(sessionUserId()!==job.userId||!now||(now.partner?.id??'')!==job.partnerId
      ||(now.pairVersion??'')!==job.pairVersion)controller.abort();};
    const identity=subscribeSessionIdentity(()=>controller.abort()),unwatch=subscribe(cancelIfChanged);
    try{
      const receipt=await withDeadline(apiClient.post<{success?:boolean;error?:string}>('/api/vnext/command',payload,{signal:controller.signal}),20000);
      if(receipt.error)throw Error(receipt.error);
      if(!receipt.success)throw Error('note_receipt_unavailable');
    }finally{controller.abort();identity();unwatch();}
  },
  confirmed:scheduleBurrowRefresh,
  rejected:()=>{showBurrowToast('Your Love Note could not be sent. Your words are kept on this device. Open Love Note to try again.');scheduleBurrowRefresh();},
  code:errorCode,schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
const loveNoteScope=(data:MajorUpdateBootstrap)=>({userId:data.profile.id,partnerId:data.partner?.id??'',pairVersion:data.pairVersion??''});
export function recoverLoveNote(data:MajorUpdateBootstrap){
  try{loveNoteOutbox.receive(loveNoteScope(data));return loveNoteOutbox.recover();}catch{return undefined;}
}
export function enqueueLoveNote(data:MajorUpdateBootstrap,body:string,key:string){
  const current=state.data;
  if(!current||state.pairInvalidated||data.profile.id!==sessionUserId()||current.profile.id!==data.profile.id
    ||(current.partner?.id??'')!==(data.partner?.id??'')||current.pairVersion!==data.pairVersion)throw Error('session_changed');
  const scope=loveNoteScope(data);loveNoteOutbox.receive(scope);
  // If legacy draft cleanup failed after a recovery send, its newer composer
  // key is still an alias of the original immutable receipt, not another note.
  const pending=loveNoteOutbox.pending().find(job=>job.key===key||job.draftKey===key);
  if(pending){if(pending.body!==body.trim())throw Error('idempotency_conflict');return;}
  const recovered=loveNoteOutbox.recover();
  loveNoteOutbox.enqueue({...scope,key:recovered?.body===body.trim()?recovered.key:key,draftKey:key,body:body.trim(),createdAt:new Date().toISOString()});
}
// Independent journal: frame replacements must not block a Plushie's photo.
// Multiple selections upload in order, while projection keeps the latest visible.
const framePhotoOutbox=createPlushiePhotoOutbox({
  kind:'frame',owner:sessionUserId,active:()=>AppState.currentState==='active',
  load:owner=>JSON.parse(storage.getString(kFramePhotoOutbox.keyFor(owner))??'null'),
  save:(owner,jobs)=>storage.set(kFramePhotoOutbox.keyFor(owner),JSON.stringify(jobs)),
  send:async job=>{
    const saved=await saveRoomPhoto(job.ownerId,'frame',job.base64,job.key,job.userId,job.partnerId);
    let photo=saved.photo;
    if(!photo){
      await refreshBurrowAfterCurrent({after:burrowClock()});
      const candidate=framePhotoOutbox.serverPhoto(job);
      if(candidate&&candidate.id===saved.photoId&&candidate.updatedAt!==job.previous?.updatedAt)photo=candidate;
    }
    if(!photo)throw Error('photo_receipt_unavailable');
    return {photo,photoUsage:saved.photoUsage};
  },
  changed:()=>{if(state.data){publish({data:framePhotoOutbox.project(state.data)});persistWhenIdle();}},
  confirmed:(job,receipt)=>{
    try{adoptRoomPhotoPreview(receipt.photo,job.preview);}catch{console.warn('[frame-photo/cache]','adoption_failed');}
    setBurrowPhotoLocally(receipt.photo,receipt.photoUsage);scheduleBurrowRefresh();
  },
  rejected:(_job,code)=>{
    showBurrowToast(code==='daily_limit_reached'?'Today’s photo limit reached. Your previous photo has been restored.'
      :'Your frame photo could not be synced. Your previous photo has been restored. Please try again.');
    scheduleBurrowRefresh();
  },
  retire:invalidateRoomPhotoCache,code:errorCode,schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
/** Close the cropper after durable local acceptance, never after a network call. */
export async function enqueueFramePhoto(data:MajorUpdateBootstrap,ownerId:string,base64:string,key:string){
  const epoch=sessionEpoch();
  const matches=()=>!!state.data&&epoch===sessionEpoch()&&data.profile.id===sessionUserId()
    &&state.data.profile.id===data.profile.id&&(state.data.partner?.id??'')===(data.partner?.id??'')&&state.data.pairVersion===data.pairVersion;
  if(!matches()||ownerId!==data.profile.id)throw Error('photo_session_changed');
  if(!base64||base64.length>1_400_000)throw Error('invalid_request');
  const scope={userId:data.profile.id,partnerId:data.partner?.id??'',pairVersion:data.pairVersion??''};
  framePhotoOutbox.receive(scope);
  const pending=framePhotoOutbox.pending();
  const replay=pending.find(job=>job.key===key);
  if(replay){if(replay.base64!==base64)throw Error('idempotency_conflict');return;}
  const preview={id:`local-frame-${key}`,ownerId,kind:'frame' as const,updatedAt:new Date().toISOString()};
  await keepRoomPhotoPreview(preview,`data:image/jpeg;base64,${base64}`);
  if(!matches()){invalidateRoomPhotoCache(preview);throw Error('photo_session_changed');}
  const current=state.data!.roomPhotos.find(p=>p.ownerId===ownerId&&p.kind==='frame');
  const previous=current&&!current.id.startsWith('local-frame-')?current:
    pending.map(job=>framePhotoOutbox.serverPhoto(job)??job.previous).find(Boolean);
  try{framePhotoOutbox.enqueue({...scope,key,ownerId,toyId:'',base64,preview,previous});}
  catch(error){invalidateRoomPhotoCache(preview);throw error;}
}
/** Only app-private disk work is on the capture/crop critical path. A pending
 * target is locked until acknowledgement; its server ticket survives relaunch. */
export async function enqueuePlushiePhoto(data:MajorUpdateBootstrap,ownerId:string,toyId:string,base64:string,key:string) {
  const epoch=sessionEpoch();
  const matches=()=>!!state.data&&epoch===sessionEpoch()&&data.profile.id===sessionUserId()
    &&state.data.profile.id===data.profile.id&&(state.data.partner?.id??'')===(data.partner?.id??'')&&state.data.pairVersion===data.pairVersion;
  if(!matches()||![data.profile.id,data.partner?.id].includes(ownerId))throw Error('photo_session_changed');
  if(!base64||base64.length>1_400_000||!toyId)throw Error('invalid_request');
  const pending=photoOutbox.pending().find(j=>j.ownerId===ownerId&&j.toyId===toyId);
  if(pending){if(pending.key===key)return;throw Error('photo_sync_pending');}
  const preview={id:`local-plushie-${key}`,ownerId,kind:'doll' as const,toyId,updatedAt:new Date().toISOString()};
  // Write from immutable encoded bytes, never Expo's disposable picker URI.
  await keepRoomPhotoPreview(preview,`data:image/jpeg;base64,${base64}`);
  if(!matches()){invalidateRoomPhotoCache(preview);throw Error('photo_session_changed');}
  const job:PlushiePhotoJob={userId:data.profile.id,partnerId:data.partner?.id??'',pairVersion:data.pairVersion??'',
    key,ownerId,toyId,base64,preview,previous:state.data!.roomPhotos.find(p=>p.ownerId===ownerId&&p.kind==='doll'&&p.toyId===toyId)};
  photoOutbox.receive(job);
  try{photoOutbox.enqueue(job);}catch(error){invalidateRoomPhotoCache(preview);throw error;}
}
const giftClaims=createShopGiftQueue({
  owner:sessionUserId,active:()=>AppState.currentState==='active',
  load:owner=>JSON.parse(storage.getString(kShopGiftClaims.keyFor(owner))??'null'),
  save:(owner,value)=>storage.set(kShopGiftClaims.keyFor(owner),JSON.stringify(value)),
  send:async(job,scope)=>{
    const data=state.data;
    if(!data||notificationScope(data)!==scope||data.pairAccessVerified!==true)throw Error('pair_changed');
    const receipt=await withDeadline(apiClient.post<{error?:string;giftId?:string;itemId?:string;success?:boolean}>(
      '/api/vnext/command',{action:'claim_shop_gift',giftId:job.gift.id,replace:job.replace,pairVersion:data.pairVersion}),20000);
    if(receipt.error)throw Error(receipt.error);
    if(!receipt.success||receipt.giftId!==job.gift.id||receipt.itemId!==job.itemId)throw Error('gift_receipt_missing');
  },
  definitive:error=>['not_found','not_claimable','not_paired','pair_changed','invalid_item','invalid_loadout'].includes(errorCode(error)),
  changed:()=>{if(state.data){publish({data:giftClaims.project(state.data)});persistWhenIdle();}},
  rejected:(job)=>{
    if(state.data)publish({data:projectShopGift(state.data,job,true)});
    showCoinPurchaseNotice('Could not claim this gift. Please try again. Your room has been restored.');
  },
  confirmed:()=>scheduleBurrowRefresh(),schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
/** Save intent before advancing the UI. Duplicate taps share the gift's ID. */
export function claimShopGiftLocally(giftId:string,replace=false) {
  const data=state.data;
  if(!data||data.profile.id!==sessionUserId()||!data.partner||data.pairAccessVerified!==true)throw Error('gift_not_ready');
  const gift=data.gifts.find(row=>row.id===giftId&&row.sender_id===data.partner!.id);
  if(!gift)return;
  const item=shopGiftItem(data,gift.item_id);if(!item)throw Error('gift_not_ready');
  const slot=['decor','outfit'].includes(item.item_type)?item.metadata.slot??null:null;
  const previousItemId=slot?roomDesignIds(data)[slot]??null:null;
  giftClaims.receive(data);
  giftClaims.enqueue({gift,itemId:item.stable_id,slot,replace:replace&&!!slot,previousItemId});
}
let shopAuthorized=false;
function projectPendingShopPurchases(data:MajorUpdateBootstrap):MajorUpdateBootstrap {
  if(!Array.isArray(data.inventory))return data;
  const pending=catalogPurchases.pending();
  if(!pending.length&&!data.inventory.some(row=>row.source==='purchase-preview'))return data;
  const inventory=data.inventory.filter(row=>row.source!=='purchase-preview');
  for(const row of pending){
    const p=row.payload;
    if(p.recipientId!==data.profile.id||p.partnerId!==(data.partner?.id??null)||p.pairVersion!==(data.pairVersion??null))continue;
    if(!inventory.some(item=>item.owner_id===data.profile.id&&item.item_id===p.itemId))
      inventory.push({id:`purchase-preview:${row.id}`,owner_id:data.profile.id,item_id:String(p.itemId),source:'purchase-preview'});
  }
  return {...data,inventory};
}
const catalogPurchases=createCoinOperationQueue({
  allowPurchases:true,
  owner:sessionUserId,active:()=>shopAuthorized&&AppState.currentState==='active',
  load:()=>JSON.parse(storage.getString(kShopPurchases.name)??'[]'),
  save:rows=>storage.set(kShopPurchases.name,JSON.stringify(rows)),
  project:row=>projectCoinSpend(`shop-item:${row.id}`,Number(row.payload.expectedPrice)),
  send:async row=>{
    const data=state.data,p=row.payload;
    if(!data||data.profile.id!==row.owner||row.owner!==sessionUserId())throw Error('session_changed');
    // The scoped RPC checks the frozen relationship before any NEW debit,
    // but can still recover an already-committed receipt after a re-pair.
    const receipt=await withDeadline(apiClient.post<CoinResponse&{error?:string;success?:boolean;purchaseId?:string;checkoutId?:string}>('/api/vnext/command',p),20000);
    if(receipt.error)throw Error(receipt.error);
    if(!receipt.success||!receipt.purchaseId||receipt.checkoutId!==row.id)throw Error('purchase_receipt_missing');
    return receipt;
  },
  confirm:(row,receipt)=>{
    settleCoinSpend(`shop-item:${row.id}`,receipt.coinState?.wallet,receipt.coinState);
    if(row.payload.recipientId===sessionUserId())confirmBurrowPurchaseLocally(String(row.payload.itemId),row.owner,receipt.purchaseId);
    void trackItemPurchaseForRating(Promise.resolve(receipt),row.id,undefined,true);
    scheduleBurrowRefresh();
  },
  reject:(row,error)=>{
    rejectCoinSpend(`shop-item:${row.id}`);
    showCoinPurchaseNotice(errorCode(error)==='insufficient_balance'?'Not enough coins. Your purchase was not completed.'
      :errorCode(error)==='price_changed'?'The price changed. Review the price and try again.'
      :'Purchase could not be completed. Please try again later.');
    scheduleBurrowRefresh();
  },
  definitive:error=>coinRewardDefinitelyRejected(error)||['pair_changed','already_owned','not_for_sale','not_tradable','price_changed','plus_required','insufficient_balance','client_upgrade_required','idempotency_conflict'].includes(errorCode(error)),
  schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
catalogPurchases.subscribe(()=>{if(state.data){publish({data:state.data});persistWhenIdle();}});
catalogPurchases.subscribeSettled(()=>roomEdits.wake());
/** Durable acceptance and balance reservation are synchronous; the server is
 * still the only authority for debit, inventory and recipient delivery. */
export function enqueueBurrowPurchase(itemId:string,recipientId:string,expectedPrice:number,name:string){
  const data=state.data;if(!data||data.profile.id!==sessionUserId())throw Error('session_changed');
  if(!Number.isSafeInteger(expectedPrice)||expectedPrice<=0)throw Error('invalid_request');
  if(![data.profile.id,data.partner?.id].includes(recipientId))throw Error('pair_changed');
  if(catalogPurchases.pending().some(row=>row.payload.itemId===itemId&&row.payload.recipientId===recipientId))return;
  if(expectedPrice>(getCoinRewardSnapshot()?.balance??data.wallet.balance))throw Error('insufficient_balance');
  const id=randomUUID();
  const pending=catalogPurchases.enqueue({id,owner:data.profile.id,path:'/api/vnext/command',key:id,amount:0,deferred:true,
    payload:{action:'purchase_catalog_item',scoped:true,itemId,recipientId,expectedPrice,idempotencyKey:id,
      partnerId:data.partner?.id??null,pairVersion:data.pairVersion??null}});
  void pending.catch(()=>{});showCoinPurchaseSuccess(name);
}
const roomEdits=createRoomEditQueue({
  owner:sessionUserId,active:()=>AppState.currentState==='active',
  load:owner=>JSON.parse(storage.getString(kBurrowRoomEdits.keyFor(owner))??'null'),
  save:(owner,value)=>storage.set(kBurrowRoomEdits.keyFor(owner),JSON.stringify(value)),
  send:async(wire,scope,approvedTotal)=>{
    // The atomic server checkout validates scope, ownership and prices. Never
    // put two full Bootstrap reads in front of a purchase or a receipt replay.
    if(scope.owner!==sessionUserId())throw Error('session_changed');
    const data=state.data;
    if(!data||!sameRoomScope(roomEditScope(data),scope))throw Error('pair_changed');
    if(data.roomModel!=='personal-v2')throw Error('room_protocol_unavailable');
    const targets=[...Object.values(wire.slots),...(wire.outfitItemId?[wire.outfitItemId]:[])];
    if(targets.some(id=>data.inventory.some(row=>row.item_id===id&&['shop-gift-preview','purchase-preview'].includes(row.source))))
      throw Error('purchase_sync_pending');
    const receipt=await withDeadline(apiClient.post<CoinResponse&{error?:string;success?:boolean;total?:number;ownerId?:string;roomModel?:string;checkoutId?:string;appliedChanges?:Record<string,string>}>('/api/vnext/command',wire),20000);
    if(receipt.error)throw Error(receipt.error);
    if(!receipt.success||typeof receipt.total!=='number'||receipt.ownerId!==scope.owner||receipt.roomModel!=='personal-v2')throw Error('room_receipt_missing');
    if(wire.action==='purchase_room_changes'&&(receipt.checkoutId!==wire.idempotencyKey
      ||JSON.stringify(Object.entries(receipt.appliedChanges??{}).sort())!==JSON.stringify(Object.entries({...wire.slots,...(wire.outfitItemId?{outfit:wire.outfitItemId}:{})}).sort())
      ||receipt.total<0||receipt.total>approvedTotal))throw Error('room_receipt_missing');
    return receipt;
  },
  definitive:error=>coinRewardDefinitelyRejected(error)||['insufficient_balance','price_changed','price_confirmation_required',
    'invalid_loadout','invalid_outfit','not_for_sale','item_unavailable','already_owned'].includes(errorCode(error)),
  changed:()=>{
    for(const edit of roomEdits.pending())projectCoinSpend(`shop-room:${edit.id}`,edit.total);
    if(state.data&&roomEdits.scope()&&sameRoomScope(roomEditScope(state.data),roomEdits.scope()!)){
      publish({data:giftClaims.project(withRoomDesign(state.data,roomEdits.slots(),roomEdits.acquired()))});persistWhenIdle();
    }
  },
  confirmed:(edit,receipt)=>{
    settleCoinSpend(`shop-room:${edit.id}`,receipt.coinState?.wallet,receipt.coinState);
    if(receipt.coinState?.wallet)syncCoinWallet(receipt.coinState.wallet,receipt.coinState);
    void trackItemPurchaseForRating(Promise.resolve(receipt),edit.id,undefined,true);
    scheduleBurrowRefresh();
  },
  rejected:(edit,error)=>{
    rejectCoinSpend(`shop-room:${edit.id}`);
    const code=errorCode(error);
    showCoinPurchaseNotice(code==='price_changed'?'The price changed. Your purchase was not applied. Please review it again.'
      :code==='insufficient_balance'?'Not enough coins. The unconfirmed room changes have been restored.'
      :code==='client_upgrade_required'?'Please update the app to use this item. Your purchase was not applied.'
      :code==='pair_changed'?'Your connection changed. This room change was not applied.'
      :['invalid_loadout','invalid_outfit','not_for_sale','item_unavailable'].includes(code)?'This item is no longer available. Your purchase was not applied.'
      :'Could not apply this room change. Please try again.');
    scheduleBurrowRefresh();
  },
  schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
/** Local projection is durable BEFORE the page closes. Payment authority stays
 * server-side; the same atomic checkout is used for owned and new furniture. */
export function enqueueBurrowRoomEdit(target:Record<string,string>,purchased:string[],name:string,total:number) {
  const data=state.data;if(!data||data.profile.id!==sessionUserId())throw Error('session_changed');
  if(total>(getCoinRewardSnapshot?.()?.balance??data.wallet.balance))throw Error('insufficient_balance');
  target=Object.fromEntries(Object.entries(target).filter(([,id])=>data.catalog.some(item=>item.stable_id===id&&isCurrentRoomItem(item))));
  if(!roomEdits.scope())roomEdits.receive(roomEditScope(data),roomDesignIds(data));
  const shown=roomDesignIds(data);
  const changes=Object.fromEntries(Object.entries(target).filter(([slot,id])=>shown[slot]!==id));
  const id=roomEdits.enqueue({id:randomUUID(),changes,purchased,name,total,
    prices:Object.fromEntries(data.catalog.filter(item=>item.metadata.slot).map(item=>[item.stable_id,item.price??0]))});
  // Cached/offline hydration may project immediately but must revalidate the
  // relationship before replaying old financial intents.
  if(id&&total>0)showCoinPurchaseSuccess(name);
  // A restored/offline room needs one fresh authorization, not two reads.
  if(data.pairAccessVerified!==true&&AppState.currentState==='active')void refreshBurrow({silent:true});
  return id;
}
/** All Plushie purchase entrances share one room/inventory/wallet outbox. */
export function enqueueBurrowPlushie(itemId:string) {
  const data=state.data;if(!data||data.profile.id!==sessionUserId())throw Error('session_changed');
  const item=data.catalog.find(row=>row.stable_id===itemId&&row.category==='couple_dolls'&&row.metadata.slot==='couple_doll'&&isCurrentRoomItem(row));
  if(!item)throw Error('invalid_loadout');
  const owned=item.metadata.starter||data.inventory.some(row=>row.owner_id===data.profile.id&&row.item_id===itemId);
  if(!owned&&item.plus_only&&!data.hasPlus)throw Error('plus_required');
  if(!owned&&(!item.price||item.price<0))throw Error('not_for_sale');
  return enqueueBurrowRoomEdit({couple_doll:itemId},owned?[]:[itemId],item.title,owned?0:item.price!);
}
function roomEditSnapshot(data:MajorUpdateBootstrap,remote=false,readRevision?:number) {
  if(!Array.isArray(data.catalog)||!Array.isArray(data.loadouts)||!Array.isArray(data.inventory))return data;
  const previous=roomEdits.pending();
  const authorized=remote&&data.roomModel==='personal-v2'&&AppState.currentState==='active';
  roomEdits.receive(roomEditScope(data),roomDesignIds(data),authorized,readRevision);
  for(const edit of previous)if(!roomEdits.pending().some(row=>row.id===edit.id))rejectCoinSpend(`shop-room:${edit.id}`);
  if(authorized)shopAuthorized=true;
  for(const row of catalogPurchases.pending())projectCoinSpend(`shop-item:${row.id}`,Number(row.payload.expectedPrice));
  for(const edit of roomEdits.pending())projectCoinSpend(`shop-room:${edit.id}`,edit.total);
  return roomEdits.projecting()?withRoomDesign(data,roomEdits.slots(),roomEdits.acquired()):data;
}
/** Reuse unchanged JSON branches: a silent read must not rebuild every list. */
export function shareBurrowSnapshot<T>(previous: T, next: T): T {
  if (Object.is(previous,next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object'
    || Array.isArray(previous) !== Array.isArray(next)) return next;
  const old = previous as Record<string,unknown>, fresh = next as Record<string,unknown>;
  const keys = Object.keys(fresh);
  let unchanged = keys.length === Object.keys(old).length;
  let freshChildren=true;
  const result: Record<string,unknown> = Array.isArray(next) ? [] as unknown as Record<string,unknown> : {};
  for (const key of keys) {
    const value = shareBurrowSnapshot(old[key],fresh[key]);
    result[key] = value;
    if(value!==fresh[key])freshChildren=false;
    if (!Object.prototype.hasOwnProperty.call(old,key) || value !== old[key]) unchanged = false;
  }
  // Preserve a changed projection's own node when none of its children were
  // shared back to old nodes. Quest rollback/unprojection tracks those rows in
  // WeakMaps; cloning an already-correct new row would lose its provenance.
  return unchanged ? previous : freshChildren ? next : result as T;
}
// Native monotonic time ignores phone clock edits. Server timestamps still
// decide settlement/rewards; this is only a foreground display projection.
export const burrowClock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
export const getBurrowSnapshot = () => state;
/** Durable visit intent owns this display projection; only the server credits
 * coins. Keep the red badge/completion stable while an older read finishes. */
export function projectFriendVisitAnswerLocally(id:string,status:'pending'|'confirmed'|'rejected') {
  const data=state.data;if(!data||data.profile.id!==sessionUserId())return;
  if(status==='rejected'){
    localVisitAnswers.delete(id);
    publish({error:'visit_submission_rejected',...(data.friendVisit?.version===2&&data.friendVisit.id===id
      ?{data:{...data,friendVisit:{...data.friendVisit,myCompleted:false}}}:{})});return;
  }
  localVisitAnswers.set(id,{scope:`${data.profile.id}:${data.partner?.id}:${data.pairVersion}`,
    ...(status==='confirmed'?{confirmedAt:burrowClock()}:{})});
  if(data.friendVisit?.version===2&&data.friendVisit.id===id&&!data.friendVisit.myCompleted)
    publish({data:{...data,friendVisit:{...data.friendVisit,myCompleted:true}}});
}
type JournalProjection = { owner: string; scope: string; localDate: string; recordId: string;
  startedAt?: string; adventureId?: string; endsAt?: string; error?: string; after?: number;team?:import('./cooperative-adventure').AdventureTeam };
let journalProjection: JournalProjection | null = null;
function mergeJournalProjection(data: MajorUpdateBootstrap, readStartedAt?: number,serverTime?:number) {
  const p = journalProjection;
  if (!p) return data;
  const scope = `${data.profile.id}:${data.partner?.id ?? 'solo'}:${data.pairVersion ?? ''}`;
  const day=adventureDay(data,serverTime??(Date.parse(data.serverNow)+Math.max(0,burrowClock()-state.receivedAt)));
  if (p.owner !== data.profile.id || p.scope !== scope || p.localDate !== day) {
    journalProjection = null; return data;
  }
  // A real start receipt already owns an authoritative deadline. Its optional
  // display/large Bootstrap may arrive later, but must not hold the clock at
  // the local preview value in the meantime (including restored old jobs).
  const accepted = !!p.adventureId && !p.adventureId.startsWith('pending:') && Number.isFinite(Date.parse(p.endsAt ?? ''));
  const completed=readAdventureDeliveryRows().some(j=>j.owner===data.profile.id&&j.scope===scope&&j.id===data.activeAdventure?.id&&j.finish&&!j.failed);
  if(completed)data={...data,activeAdventure:null,adventureResult:null};
  if (data.activeAdventure && !data.activeAdventure.id.startsWith('pending:')) {
    if (accepted && data.activeAdventure.localStartPending && data.activeAdventure.id === p.adventureId) {
      const { localStartPending: _pending, ...journey } = data.activeAdventure;
      return { ...data, activeAdventure: { ...journey, ends_at: p.endsAt! },...(p.team?{adventureTeam:{userId:p.owner,partnerId:data.partner?.id??null,pairVersion:data.pairVersion??null,
        adventureId:p.adventureId!,team:p.team,joinable:null,nudgeAvailable:false,coordinationPending:true}}:{}) };
    }
    if (readStartedAt !== undefined && readStartedAt >= (p.after ?? 0)
      && (!p.adventureId || data.activeAdventure.id === p.adventureId)) journalProjection = null;
    return data;
  }
  if (!p.startedAt) return { ...data, readyRecordId: p.recordId,readyRecordLocalDate:p.localDate };
  return { ...data, readyRecordId: null, dailyAdventureUsed: true,
    ...(p.team?{adventureTeam:{userId:p.owner,partnerId:data.partner?.id??null,pairVersion:data.pairVersion??null,
      adventureId:p.adventureId??`pending:${p.recordId}`,team:p.team,joinable:null,nudgeAvailable:false,coordinationPending:true}}:{}),
    activeAdventure: { id: p.adventureId ?? `pending:${p.recordId}`, status: 'in_progress' as const,
      started_at: p.startedAt,local_date:p.localDate,ends_at: p.endsAt ?? new Date(Date.parse(p.startedAt) + adventureDurationMs(data.hasPlus)).toISOString(),
      ...(accepted ? {} : { localStartPending: true as const }) } };
}
/** Pending Save/Start is backed by the durable journal queue, not a network wait. */
export function projectAdventureJournalLocally(projection: JournalProjection) {
  if (!state.data || projection.owner !== sessionUserId()) return;
  journalProjection = { ...projection, after: burrowClock() };
  publish({ data: mergeJournalProjection(state.data) });
}
/** Reveal only an already-frozen server plan; this never awards an item locally. */
export function projectBurrowAdventureArrival(adventureId: string) {
  const data = state.data;
  if (!data || data.activeAdventure?.id !== adventureId || data.activeAdventure.status !== 'in_progress'
    || data.activeAdventure.localStartPending || adventureId.startsWith('pending:')) return;
  const now = Date.parse(data.serverNow) + Math.max(0, burrowClock() - state.receivedAt);
  const next = mergeAdventureArrival(data, data, now);
  if (next !== data) { publish({ data: next }); persistWhenIdle(); }
}
/** Apply the server's start receipt immediately, without waiting for Bootstrap.
 * Its scope is verified before any display data can enter the current session. */
export function cacheAdventureDisplay(display: AdventureDisplay) {
  const data = state.data;
  if (!data || data.profile.id !== sessionUserId() || display.userId !== data.profile.id
    || (display.partnerId ?? '') !== (data.partner?.id ?? '') || (display.pairVersion ?? '') !== (data.pairVersion ?? '')
    || !display.activeAdventure || !Number.isFinite(Date.parse(display.serverNow))) return;
  const current = data.activeAdventure;
  if (!current || confirmedAdventures.has(display.activeAdventure.id)
    || (!current.id.startsWith('pending:') && current.id !== display.activeAdventure.id)) return;
  // Replaying a durable start receipt must not reset the countdown's clock
  // anchor, replace a newer visit-adjusted plan or downgrade a settled result.
  if (!current.localStartPending && current.id === display.activeAdventure.id && (data.adventureResult
    || (data.adventurePlan && display.adventurePlan
      && Date.parse(data.adventurePlan.readAt) >= Date.parse(display.adventurePlan.readAt))
    || (!display.adventurePlan && !display.adventureResult && Date.parse(display.serverNow) <= Date.parse(data.serverNow)))) return;
  const next = mergeAdventureArrival(data, { ...data, ...{ activeAdventure: display.activeAdventure,
    adventureResult: display.adventureResult, adventurePlan: display.adventurePlan }, serverNow: display.serverNow }, Date.parse(display.serverNow));
  publish({ data: next, receivedAt: burrowClock() }); persistWhenIdle();
}
/** Only a server receipt marks the day claimed. A delayed read cannot undo it. */
export function confirmDailyPlusBonusLocally(userId: string, bonus: DailyPlusBonusState) {
  if (!state.data || state.data.profile.id !== userId || !bonus.claimed
    || state.data.localDate !== bonus.localDate) return;
  publish({ data: { ...state.data, dailyPlusBonus: bonus } });
  persistWhenIdle();
}
/** A successful send closes today's Free entry immediately, even before the
 * coalesced background read. Never call on tap or an uncertain timeout. */
export function confirmBurrowAffectionLocally(senderId: string,usage?:MajorUpdateBootstrap['affectionUsage']) {
  if (!state.data || state.data.profile.id !== senderId || senderId !== sessionUserId()) return;
  const after = burrowClock();
  const serverNow = Date.parse(state.data.serverNow) + Math.max(0, after - state.receivedAt);
  if (!Number.isFinite(serverNow)) return;
  const at = new Date(Math.max(serverNow, Date.parse(state.data.lastAffectionAt ?? '') || 0)).toISOString();
  const currentUsage=state.data.affectionUsage;
  if(currentUsage&&usage?.localDate===currentUsage.localDate&&usage.used<currentUsage.used)usage=currentUsage;
  confirmedAffection = { senderId, at, after,usage };
  publish({ data: { ...state.data, lastAffectionAt: at,...(usage?{affectionUsage:usage}:{}) } });
  persistWhenIdle();
}
/** Reserve the existing Free daily entry only while a durable send is pending.
 * Never stamp an uncertain send as a confirmed lastAffectionAt. */
export function enqueueBurrowAffection(type:AffectionType,metrics:Record<string,number>,key:string,scope:MajorUpdateBootstrap){
  const data=state.data;
  if(!data||data.profile.id!==sessionUserId()||state.pairInvalidated)throw Error('session_changed');
  if(!data.partner)throw Error('not_paired');
  if(questScope(data).scope!==questScope(scope).scope)throw Error('pair_changed');
  const now=Date.parse(data.serverNow)+Math.max(0,burrowClock()-state.receivedAt);
  const pending=coinOperations.pending().filter(row=>row.payload.action==='complete_affection'
    &&row.quest?.scope===questScope(data).scope&&row.quest.day===data.localDate
    &&!data.affectionUsage?.keys?.includes(String(row.payload.idempotencyKey))).length;
  if(freeAffectionUsedToday(data,now)||(data.affectionUsage?.used??0)+pending>=(data.hasPlus?6:1))throw Error('daily_limit_reached');
  const operation=enqueueAffectionCommand(type,metrics,key);
  publish({data:{...data}});return operation;
}
// Receipt handling outlives the originating page and the first failed attempt.
// Pair/session fences prevent an old send from consuming a new pair's entry.
coinOperations.subscribeSettled(({operation,receipt,error})=>{
  if(operation.payload.action==='complete_room_care_v2'){
    const data=state.data,p=operation.payload;
    if(!data||data.profile.id!==operation.owner||operation.owner!==sessionUserId()||state.pairInvalidated
      ||p.partnerId!==(data.partner?.id??null)||p.pairVersion!==(data.pairVersion??null))return;
    const result=receipt as {completedAt?:string}|undefined;
    if(result?.completedAt&&Number.isFinite(Date.parse(result.completedAt))&&data.roomCare?.version===2){
      const side=p.ownerId===data.profile.id?'own':'partner',room=data.roomCare[side];
      if(room){const lastAt=result.completedAt,nextAt=new Date(Date.parse(lastAt)+12*3600000).toISOString();
        publish({data:mergeRoomCare(data,{...data,roomCare:{...data.roomCare,[side]:{...room,[String(p.careAction)]:{lastAt,nextAt}}}})});}
    }
    if(error)showBurrowToast('This care could not be saved. Please try again.');
    scheduleBurrowRefresh();return;
  }
  if(operation.payload.action!=='complete_affection')return;
  const data=state.data;
  if(!data||data.profile.id!==operation.owner||data.profile.id!==sessionUserId()
    ||state.pairInvalidated||operation.quest?.scope!==questScope(data).scope)return;
  if(receipt)confirmBurrowAffectionLocally(operation.owner,(receipt as {affectionUsage?:MajorUpdateBootstrap['affectionUsage']}).affectionUsage);
  if(error)showBurrowToast('Your affection could not be sent. Please try again.');
  scheduleBurrowRefresh();
});
/** Only call after a successful server receipt, never on tap or network timeout. */
export function confirmBurrowAdventureClaimLocally(adventureId: string) {
  if (!state.data || state.data.activeAdventure?.id !== adventureId) return;
  const data={...state.data,activeAdventure:null,adventureResult:null};
  confirmedAdventures.set(adventureId,burrowClock());
  confirmedAdventureInteractions.delete(adventureId);
  publish({data,error:null});persistBurrowSnapshot(data,burrowClock()-state.receivedAt);
}
/** A legacy claim can succeed while requiring the next conversation. This is
 * a durable intermediate receipt, not a failed claim or a completed journey. */
export function confirmBurrowAdventureInteractionLocally(adventureId: string, treasureClaimed = false) {
  if (!state.data || state.data.activeAdventure?.id !== adventureId || !state.data.adventureResult) return;
  confirmedAdventureInteractions.set(adventureId, { after: burrowClock(), treasureClaimed });
  const data: MajorUpdateBootstrap = { ...state.data, activeAdventure: { ...state.data.activeAdventure, status: 'interaction_required' },
    adventureResult: { ...state.data.adventureResult, claim_status: 'interaction_required',
      metadata: { ...state.data.adventureResult.metadata, ...(treasureClaimed ? { treasureClaimed: true } : {}) } } };
  publish({ data, error: null }); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Confirmed self-purchases appear immediately, even while a stale read finishes. */
export function confirmBurrowPurchaseLocally(itemId: string, ownerId: string, purchaseId: string) {
  if (!state.data || state.data.profile.id !== ownerId ||
    state.data.inventory.some(row => row.owner_id === ownerId && row.item_id === itemId&&row.source!=='purchase-preview')) return;
  const row = { id: `purchase:${purchaseId}`, owner_id: ownerId, item_id: itemId, source: 'purchase' };
  confirmedInventory.set(`${ownerId}:${itemId}`, { row, after: burrowClock() });
  const data = { ...state.data, inventory: [...state.data.inventory.filter(i=>!(i.item_id===itemId&&i.owner_id===ownerId&&i.source==='purchase-preview')), row] };
  publish({ data }); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Only a verified command receipt may add an adventure reward to the cache. */
export function confirmBurrowAdventureItemLocally(adventureId: string, itemId?: string | null) {
  if (!itemId || !state.data || state.data.activeAdventure?.id !== adventureId) return;
  const ownerId = state.data.profile.id;
  if (state.data.inventory.some(row => row.owner_id === ownerId && row.item_id === itemId)) return;
  const row = { id: `adventure:${adventureId}:${itemId}`, owner_id: ownerId, item_id: itemId, source: 'adventure' };
  confirmedInventory.set(`${ownerId}:${itemId}`, { row, after: burrowClock() });
  const data = { ...state.data, inventory: [...state.data.inventory, row] };
  publish({ data }); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Apply a confirmed receipt without waiting for the next bootstrap. Plushie
 * editors have already closed on durable local acceptance, not this response. */
function markToyPhotoTargetUsed(data:MajorUpdateBootstrap,photo:MajorUpdateBootstrap['roomPhotos'][number]) {
  if(data.photoUsage)return;
  if(photo.kind!=='doll'||!photo.toyId)return;
  const existing=data.dollPhotoChangeTargetsUsed??(data.dollPhotoChangesUsed??[]).map(toyId=>({ownerId:data.profile.id,toyId}));
  data.dollPhotoChangeTargetsUsed=[...existing.filter(target=>target.ownerId!==photo.ownerId||target.toyId!==photo.toyId),{ownerId:photo.ownerId,toyId:photo.toyId}];
  if(photo.ownerId===data.profile.id)data.dollPhotoChangesUsed=[...new Set([...(data.dollPhotoChangesUsed??[]),photo.toyId])];
}
export function setBurrowPhotoLocally(photo: MajorUpdateBootstrap['roomPhotos'][number],photoUsage?:MajorUpdateBootstrap['photoUsage']) {
  if (!state.data || ![state.data.profile.id,state.data.partner?.id].includes(photo.ownerId)) return;
  const sameTarget = (row: MajorUpdateBootstrap['roomPhotos'][number]) => row.ownerId === photo.ownerId && row.kind === photo.kind && (row.toyId ?? '') === (photo.toyId ?? '');
  const data = { ...state.data, ...(photoUsage?{photoUsage}:{}), roomPhotos: [...state.data.roomPhotos.filter(row => !sameTarget(row)), photo] };
  markToyPhotoTargetUsed(data,photo);
  confirmedPhotos.set(`${photo.ownerId}:${photo.kind}:${photo.toyId ?? ''}`, { photo, after: burrowClock(),usage:photoUsage });
  publish({ data }); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Immediate local playback/selection; the next authoritative snapshot wins. */
export function selectBurrowMusicLocally(trackId: string | null) {
  const token = ++musicToken;
  musicSelection = { id: trackId, token, after: Infinity };
  if (state.data) publish({ data: { ...state.data, musicTrackId: trackId } });
  return token;
}
export function confirmBurrowMusicLocally(token: number, rollback?: string | null) {
  if (musicSelection?.token !== token) return;
  if (rollback !== undefined) {
    musicSelection = null;
    if (state.data) publish({ data: { ...state.data, musicTrackId: rollback } });
  } else musicSelection.after = burrowClock();
}
/** A received gesture disappears from the inbox immediately; sync corrects it if the request fails. */
export function receiveBurrowAffectionLocally(input: string|string[]) {
  const ids=new Set(Array.isArray(input)?input:[input]);
  if (!state.data) return;
  const known=new Set([...(state.data.affectionInbox??[]).map(row=>row.id),...(state.data.affectionInboxGroups??[]).flatMap(row=>row.ids)]);
  const count=[...ids].filter(id=>known.has(id)).length;if(!count)return;
  for(const id of ids)if(known.has(id))receivedAffections.set(id,{scope:notificationScope(state.data)});
  publish({ data: { ...state.data,
    affectionInbox: state.data.affectionInbox.filter(event => !ids.has(event.id)),
    ...(state.data.affectionInboxGroups?{affectionInboxGroups:state.data.affectionInboxGroups.map(g=>({...g,ids:g.ids.filter(id=>!ids.has(id))})).filter(g=>g.ids.length)}:{}),
    unread: { ...state.data.unread, affection: Math.max(0, state.data.unread.affection - count) },
  } });
}
export function confirmReceivedAffections(ids:string[],success:boolean){
  for(const id of ids){const row=receivedAffections.get(id);if(!row)continue;
    if(success)row.confirmedAt=burrowClock();else receivedAffections.delete(id);
  }
}
export function setBurrowLoadoutLocally(slots: Record<string,string>, ownerId: string, outfit = false) {
  if (!state.data||ownerId!==state.data.profile.id||ownerId!==sessionUserId()) return;
  const previous=state.data.loadouts.filter(row=>outfit
    ? !(row.room_type==='home'&&row.owner_id===ownerId&&row.slot==='outfit')
    : !(row.room_type==='home'&&row.owner_id===ownerId&&row.slot!=='outfit'));
  const room_type: 'home'|'our'='home';
  const owner_id=ownerId;
  const rows = Object.entries(slots).map(([slot,item_id])=>({room_type,owner_id,slot,item_id}));
  confirmedLoadouts.set(outfit ? `outfit:${ownerId}` : 'decor', { rows, ownerId, outfit, after: burrowClock() });
  const data = {...state.data,loadouts:[...previous,...rows]};
  publish({data}); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Apply only after the server accepts placement; an older Home read cannot
 * restore the previous gift while the success dialog is being dismissed. */
export function confirmBurrowShelfGift(ownerId:string,itemId:string){
  const data=state.data;
  if(!data||data.profile.id!==ownerId||!data.inventory.some(row=>row.owner_id===ownerId&&row.item_id===itemId)
    ||!data.catalog.some(item=>item.stable_id===itemId&&item.tags.includes('adventure_v2_gift')))return;
  confirmedShelfGifts.set(ownerId,{itemId,after:burrowClock()});
  const collection=data.adventureCollection??{enabled:true,displays:[],progress:[]};
  const next={...data,adventureCollection:{...collection,displays:[...collection.displays.filter(row=>row.user_id!==ownerId),{user_id:ownerId,gift_id:itemId}]}};
  publish({data:next});persistBurrowSnapshot(next,burrowClock()-state.receivedAt);
}
/** Show the digging state as soon as the user starts today's journey. */
export function startBurrowAdventureLocally(recordId: string) {
  if (!state.data || state.data.activeAdventure || state.data.readyRecordId !== recordId) return;
  const startedAt=new Date(Date.parse(state.data.serverNow)+Math.max(0,burrowClock()-state.receivedAt));
  const endsAt=new Date(startedAt.getTime()+adventureDurationMs(state.data.hasPlus));
  projectAdventureJournalLocally({owner:state.data.profile.id,scope:`${state.data.profile.id}:${state.data.partner?.id??'solo'}:${state.data.pairVersion??''}`,
    localDate:state.data.localDate,recordId,startedAt:startedAt.toISOString(),endsAt:endsAt.toISOString()});
}
function errorCode(error: unknown): string {
  if(error instanceof Error&&error.message==='Operation timed out')return 'request_timeout';
  if (error && typeof error === 'object' && 'body' in error) {
    const body = error.body;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  }
  return error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'network_error';
}
export function burrowErrorMessage(code: string): string {
  const messages: Record<string,string> = {
    request_timeout: 'Your burrow is taking longer to load. Please try again.',
    network_error: 'Couldn’t connect to your burrow. Check your connection and retry.',
    auth_refresh_failed: 'We couldn’t refresh your sign-in. Please try again.',
    Unauthorized: 'Your sign-in needs to be refreshed. Please sign in again.',
    'Internal error': 'Your burrow is temporarily unavailable. Please try again.',
    not_paired: 'Connect with your person to use this shared feature.',
    love_note_minute_limit: 'You can send up to 5 Love Notes per minute. Please wait a moment and try again. Your note is still here.',
    love_note_daily_limit: 'You’ve reached today’s limit of 100 Love Notes. Try again after your local midnight. Your note is still here.',
    feature_disabled: 'This update is not available yet. Please refresh or return to Home.',
    insufficient_balance: 'You don’t have enough coins for this item yet.',
    cooldown_active: 'Your next free gesture isn’t ready yet. Refresh to see the time.',
    care_cooldown: 'Your bunny or flower is happy now. Come back in 12 hours.',
    already_full: 'Your bunny has everything it needs for now.',
    already_owned: 'That item is already owned, or waiting to be opened.',
    plus_required: 'This little extra needs Burrow Plus.',
    price_changed: 'The price changed. Review the updated price and tap Buy again. No coins were spent.',
    price_confirmation_required: 'Please update the app to confirm this item’s current price. No coins were spent.',
    daily_adventure_used: 'Your bunny has already started today’s adventure.',
    adventure_pending: 'Finish your current adventure before starting another.',
    record_required: 'Save today’s story before starting the adventure.',
    result_not_ready: 'Your adventure result is still arriving. Refresh and try again.',
    reward_no_longer_eligible: 'This discovery is already collected. Refresh to see your collection.',
    interaction_required: 'Finish your friend’s conversation before collecting the gift.',
    treasure_required: 'Collect your treasure first, then continue your friend’s story.',
    adventure_cancelled: 'This adventure was cancelled when your connection changed.',
    not_completed: 'There’s a little more to do before collecting this reward.',
    idempotency_conflict: 'This request has changed. Refresh before trying again.',
    battle_required: 'Your friend is still waiting. Finish the matching Rage Room battle, then come back to collect.',
    content_unavailable: 'This saved story is unavailable. Your discovery is safe; please try refreshing.',
    already_done: 'You’ve faced this feeling today. You can help your friend tomorrow, or your partner can help.',
    daily_limit_reached: 'Both battles are complete for today. Come back after your local midnight.',
    photo_unavailable: 'The photo could not be saved or loaded. Please try again.',
    sharing_conflict: 'This diary’s privacy changed on another device. Refresh before choosing again.',
    pair_changed: 'Your connection changed. Refresh and review your person before trying again.',
    client_upgrade_required: 'Please update the app before changing this setting.',
    visit_expired: 'Your friend has headed home. Refresh to see who visits next.',
    visit_session_changed: 'This conversation changed on another device. Please open it again.',
    visit_submission_rejected: 'Your visit could not be saved. Your balance has been corrected; refresh to see the latest conversation.',
    already_completed: 'You’ve already chatted with this friend. They’re waiting for your partner.',
    upload_limit: 'You’ve uploaded too many photos. Please try again later.',
  };
  return messages[code] ?? 'That didn’t finish. Check your connection and try again.';
}
let flight: Promise<void> | null = null;
let revision = 0;
let requestStartedAt = 0;
// Only accepted successful reads cover changes; cache restores, failed reads,
// optimistic projections and reads belonging to an old pair do not.
let lastConfirmedReadStartedAt = -Infinity;
let followup: Promise<void> | null = null;
let latestRefreshAfter = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2_000;
let readGeneration = 0;
let readController: AbortController | null = null;
let backgrounded = AppState.currentState === 'background';
const operations = new Map<string, Promise<boolean>>();
function clearReadRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
function invalidateReads() {
  readGeneration++;
  readController?.abort(); readController = null;
  flight = null; followup = null; latestRefreshAfter = 0;
  lastConfirmedReadStartedAt = -Infinity;
  clearReadRetry(); retryDelay = 2_000;
}
function retryRead() {
  if (backgrounded || retryTimer || !sessionUserId()) return;
  const epoch = sessionEpoch(), generation = readGeneration;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!backgrounded && epoch === sessionEpoch() && generation === readGeneration)
      void refreshBurrow({ silent: true });
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
}
/** Cancel only snapshot reads, never payment/command settlement. StoreKit's
 * temporary inactive state is not a real background transition. */
export function observeBurrowAppState(value: string) {
  observeJournalAppState(value);
  if (value === 'background' && !backgrounded) {
    const dirty = !!pendingPersistence || !!persistenceTimer;
    cancelPersistence();
    if (dirty && state.data) persistBurrowSnapshot(state.data, burrowClock() - state.receivedAt);
    backgrounded = true; invalidateReads();
    if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null;
    if (state.loading) publish({ loading: false });
  } else if (value === 'active' && backgrounded) {
    backgrounded = false;
    if (sessionUserId()) void refreshBurrow({ silent: !!state.data });
  }
}
function restore() {
  const owner = sessionUserId();
  if (!owner) return;
  for (const [name, key] of readBurrowActionKeys(owner)) pendingKeys.set(name, key);
  const cached = readBurrowSnapshot(owner);
  if (cached) {
    syncCoinWallet(cached.data.wallet, cached.data.coinState);
    const elapsed = Math.max(0, Date.now() - cached.savedAt);
    questProgress.observe(cached.data);
    publish({ data: roomEditSnapshot(mergeAdventureArrival(null, cached.data, Date.parse(cached.data.serverNow) + elapsed)), receivedAt: burrowClock() - elapsed });
  }
}
const persistKeys = () => { const owner = sessionUserId(); if (owner) persistBurrowActionKeys(owner, pendingKeys); };
/** Adopt a confirmed first-pair identity, without inventing entitlements or
 * treating unprepared private content as ready. Fence older Solo reads. */
export function confirmBurrowPair(owner:string,partner:{userId:string;displayName:string;avatarUrl?:string;isDefaultAvatar?:boolean},pairVersion:string,
  adventureTeam?:import('./cooperative-adventure').AdventureTeamState){
  const before=state.data;
  if(!before||owner!==sessionUserId()||before.profile.id!==owner||!partner.userId||!/^[a-f0-9]{32}$/.test(pairVersion)
    ||(before.partner&&before.partner.id!==partner.userId))return false;
  if(before.partner?.id===partner.userId&&before.pairVersion===pairVersion)return true;
  invalidateBurrowPair({retainSolo:true});
  if(!state.data)return false;
  publish({data:{...state.data,partner:{id:partner.userId,display_name:partner.displayName,avatar_url:partner.avatarUrl??'',is_default_avatar:partner.isDefaultAvatar!==false,subscription_tier:null},
    pairVersion,pairAccessVerified:undefined,...(adventureTeam?.userId===owner&&adventureTeam.partnerId===partner.userId&&adventureTeam.pairVersion===pairVersion?{adventureTeam}:{})},pairInvalidated:false});
  persistWhenIdle();return true;
}
/** Drop private pair data immediately; late snapshots cannot restore it. */
export function invalidateBurrowPair({ retainSolo = false }: { retainSolo?: boolean } = {}) {
  gameReads.invalidate();
  // A first connection cannot expose an old partner's data: there is none.
  // Keep the user's personal scene mounted while authorization is refreshed.
  // Existing pairs still take the immediate privacy-clearing path on unpair.
  const personal = retainSolo && state.data && !state.data.partner && state.data.profile.id === sessionUserId()
    ? { ...state.data, pairAccessVerified: undefined } : null;
  photoOutbox.reset();
  framePhotoOutbox.reset();
  loveNoteOutbox.reset();
  receivedAffections.clear();
  giftClaims.reset();
  for(const edit of roomEdits.pending())rejectCoinSpend(`shop-room:${edit.id}`);
  roomEdits.reset();shopAuthorized=false;catalogPurchases.reset();
  localVisitAnswers.clear();
  confirmedAffection = null;
  journalProjection = null;
  cancelPersistence();
  confirmedAdventures.clear();
  confirmedAdventureInteractions.clear();
  clearBurrowSnapshot();
  invalidateReads();
  revision++; flight = null; pendingKeys.clear(); confirmedPhotos.clear(); confirmedInventory.clear(); confirmedLoadouts.clear(); confirmedShelfGifts.clear(); musicSelection = null; operations.clear(); followup = null; latestRefreshAfter = 0;
  persistKeys(); // A restart must not restore previous-pair command/retry keys.
  if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null;
  publish({ data: personal, loading: false, busy: false, error: null, syncError: null, receivedAt: personal ? state.receivedAt : 0, pairInvalidated: true });
}
subscribeSessionIdentity(() => {
  photoOutbox.reset();
  framePhotoOutbox.reset();
  loveNoteOutbox.reset();
  receivedAffections.clear();
  giftClaims.reset();
  for(const edit of roomEdits.pending())rejectCoinSpend(`shop-room:${edit.id}`);
  roomEdits.reset();shopAuthorized=false;catalogPurchases.reset();
  localVisitAnswers.clear();
  confirmedAffection = null;
  journalProjection = null;
  cancelPersistence();
  confirmedAdventures.clear();
  confirmedAdventureInteractions.clear();
  revision++;
  invalidateReads();
  flight = null; pendingKeys.clear(); confirmedPhotos.clear(); confirmedInventory.clear(); confirmedLoadouts.clear(); confirmedShelfGifts.clear(); musicSelection = null;
  publish({ data: null, loading: false, busy: false, error: null, syncError: null, receivedAt: 0, pairInvalidated: true });
  operations.clear(); followup = null; latestRefreshAfter = 0;
  if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null;
  restore();
});
restore();
AppState.addEventListener?.('change',next=>{
  if(next!=='active')shopAuthorized=false;
  else if(catalogPurchases.pending().length)void refreshBurrow({silent:true});
  if(next!=='active')photoOutbox.pause();else photoOutbox.resume();
  if(next!=='active')framePhotoOutbox.pause();else framePhotoOutbox.resume();
  if(next!=='active')loveNoteOutbox.pause();else loveNoteOutbox.resume();
  if(next!=='active')giftClaims.pause();
  else if(giftClaims.hasPending())void refreshBurrow({silent:true});
  if(next!=='active')roomEdits.pause();
  else if(roomEdits.pending().length)void refreshBurrow({silent:true});
});
// Cache confirmed receipts immediately, even if the next full bootstrap is
// offline. Optimistic projections never enter this durable personal snapshot.
subscribeCoinWallet(() => {
  // Affection/Release can deliver their visual reward AFTER the receipt, when
  // a heart/popup finishes. Protect that later flight too, not just request time.
  const quietMs=coinPresentationTiming(0).total+400;
  if (getCoinRewardSnapshot().batch) persistNotBefore = Math.max(persistNotBefore, burrowClock() + quietMs);
  const confirmed = getConfirmedCoinWallet();
  if (!state.data || !confirmed || state.data.profile.id !== sessionUserId()
    || confirmed.wallet.version <= (state.data.wallet?.version ?? -1)) return;
  const data = { ...state.data, wallet: confirmed.wallet, coinState: confirmed.coinState };
  publish({ data });
  persistBurrowWallet(data.profile.id, confirmed.wallet, confirmed.coinState);
  persistWhenIdle(burrowClock() + quietMs);
});

export function refreshBurrow({ silent = false }: { silent?: boolean } = {}) {
  if (backgrounded) return Promise.resolve();
  if (flight) return flight;
  clearReadRetry();
  const epoch = sessionEpoch();
  const requestRevision = revision;
  const generation = readGeneration;
  const startedAt = requestStartedAt = burrowClock();
  const roomReadRevision=roomEdits.revision(),giftReadRevision=giftClaims.revision();
  const profileReadRevision = accountProfileRevision();
  const controller = readController = new AbortController();
  // Background retries must not put an offline Home back behind a spinner.
  if (!silent) publish({ loading: true, error: null });
  // Bound the whole read (including authentication), not financial commands.
  // Abort on completion below; late responses cannot replace the cached scene.
  const task = withDeadline(fetchMajorUpdateBootstrap({ force: true, signal: controller.signal }), HOME_BOOTSTRAP_TIMEOUT_MS).then(async data => {
    const receivedAt=burrowClock();
    // Never delay a relationship revocation. Only same-scope silent display
    // reconciliation yields to current touches/transitions; actions stay local.
    if(silent&&state.data&&state.data.profile.id===data.profile.id&&state.data.partner?.id===data.partner?.id
      &&state.data.pairVersion===data.pairVersion&&state.data.pairAccessVerified===data.pairAccessVerified){
      await yieldToUi();
      const shared=await shareSnapshotWhenIdle(state.data,data,{yield:()=>yieldToUi(0),
        valid:()=>epoch===sessionEpoch()&&requestRevision===revision&&generation===readGeneration});
      if(!shared)return;
      data=shared;
    }
    if (epoch === sessionEpoch() && requestRevision === revision && generation === readGeneration) {
      data = { ...data, profile: projectAccountProfile(data.profile, profileReadRevision) };
      if (state.data && (state.data.partner?.id !== data.partner?.id || state.data.pairVersion !== data.pairVersion)) {
        // Also handles a pairing notification missed while offline. Fence old
        // commands/reads and local projections before accepting the new pair.
        invalidateBurrowPair({ retainSolo: true });
      }
      // A failed supplementary read retains same-pair cached counts; it never
      // turns a usable room snapshot into a loading or empty notification state.
      if(!data.attention&&state.data?.profile.id===data.profile.id&&state.data.partner?.id===data.partner?.id
        &&state.data.pairVersion===data.pairVersion)data={...data,attention:state.data.attention};
      if(data.roomCare===undefined&&state.data?.profile.id===data.profile.id&&state.data.partner?.id===data.partner?.id
        &&state.data.pairVersion===data.pairVersion)data={...data,roomCare:state.data.roomCare};
      data=mergeRoomCare(state.data,data);
      // Optional display failures must not erase a confirmed same-day value.
      // Never carry quotas/bonus or partner metadata into a new day, tier or
      // relationship. Wallet, catalogue and hasPlus always come from the core.
      if (state.data?.profile.id === data.profile.id && state.data.partner?.id === data.partner?.id
        && state.data.pairVersion === data.pairVersion && state.data.localDate === data.localDate
        && state.data.hasPlus === data.hasPlus) {
        for (const key of ['dailyPlusBonus', 'photoUsage', 'lastCareAt', 'adventureCollection'] as const) {
          if (data[key] === undefined && state.data[key] !== undefined) data = { ...data, [key]: state.data[key] };
        }
      }
      for(const [id,after] of confirmedAdventures){
        if(startedAt>=after){confirmedAdventures.delete(id);continue;}
        if(data.activeAdventure?.id===id)data={...data,activeAdventure:null,adventureResult:null};
      }
      for(const [id,projection] of localVisitAnswers){
        if(projection.scope!==`${data.profile.id}:${data.partner?.id}:${data.pairVersion}`
          ||projection.confirmedAt!==undefined&&startedAt>=projection.confirmedAt){localVisitAnswers.delete(id);continue;}
        if(data.friendVisit?.version===2&&data.friendVisit.id===id&&!data.friendVisit.myCompleted)
          data={...data,friendVisit:{...data.friendVisit,myCompleted:true}};
      }
      if (confirmedAffection) {
        const receipt = confirmedAffection;
        if (data.profile.id !== receipt.senderId || startedAt >= receipt.after
          || Date.parse(data.lastAffectionAt ?? '') >= Date.parse(receipt.at)) confirmedAffection = null;
        else data = { ...data, lastAffectionAt: receipt.at,...(receipt.usage?{affectionUsage:receipt.usage}:{}) };
      }
      for(const [id,row] of receivedAffections){
        const present=data.affectionInbox.some(event=>event.id===id)||data.affectionInboxGroups?.some(g=>g.ids.includes(id));
        if(row.scope!==notificationScope(data)||row.confirmedAt!==undefined&&startedAt>=row.confirmedAt&&!present)receivedAffections.delete(id);
      }
      for (const [id, { after, treasureClaimed }] of confirmedAdventureInteractions) {
        if (startedAt >= after) { confirmedAdventureInteractions.delete(id); continue; }
        if (data.activeAdventure?.id === id && data.adventureResult) data = { ...data,
          activeAdventure: { ...data.activeAdventure, status: 'interaction_required' },
          adventureResult: { ...data.adventureResult, claim_status: 'interaction_required',
            metadata: { ...data.adventureResult.metadata, ...(treasureClaimed ? { treasureClaimed: true } : {}) } } };
      }
      if (musicSelection) {
        if (startedAt <= musicSelection.after) data = { ...data, musicTrackId: musicSelection.id };
        else musicSelection = null;
      }
      const newestUsage=[...confirmedPhotos.values()].filter(receipt=>startedAt<receipt.after&&receipt.usage?.localDate===data.localDate)
        .sort((a,b)=>b.after-a.after)[0]?.usage;
      if(newestUsage)data={...data,photoUsage:newestUsage};
      for (const [key, { photo: receipt, after,usage }] of confirmedPhotos) {
        const matches = (row: MajorUpdateBootstrap['roomPhotos'][number]) => row.ownerId === receipt.ownerId && row.kind === receipt.kind && (row.toyId ?? '') === (receipt.toyId ?? '');
        const remote = data.roomPhotos.find(matches);
        // Doll photos cannot be deleted by this API. Require an equal/newer
        // server version, not merely a read started after the upload, before
        // removing a committed local receipt. A lagging replica must not flash
        // the old face back onto Home or unlock a consumed daily allowance.
        if ((receipt.kind!=='doll'&&startedAt>=after) || (remote && Date.parse(remote.updatedAt) >= Date.parse(receipt.updatedAt))) confirmedPhotos.delete(key);
        else {
          data = { ...data, roomPhotos: [...data.roomPhotos.filter(row => !matches(row)), receipt] };
          markToyPhotoTargetUsed(data,receipt);
          if(receipt.kind==='doll'&&usage?.localDate===data.localDate&&data.photoUsage){
            const used=usage.doll.targets.find(t=>t.ownerId===receipt.ownerId&&t.toyId===receipt.toyId);
            if(used){const targets=data.photoUsage.doll.targets,existing=targets.find(t=>t.ownerId===used.ownerId&&t.toyId===used.toyId);
              if(!existing||existing.used<used.used)data={...data,photoUsage:{...data.photoUsage,doll:{...data.photoUsage.doll,
                targets:[...targets.filter(t=>t!==existing),used]}}};
            }
          }
        }
      }
      for (const [key, receipt] of confirmedInventory) {
        const found = data.inventory.some(row => row.owner_id === receipt.row.owner_id && row.item_id === receipt.row.item_id);
        if (found || startedAt >= receipt.after) confirmedInventory.delete(key);
        else data = { ...data, inventory: [...data.inventory, receipt.row] };
      }
      for (const [key, receipt] of confirmedLoadouts) {
        if (startedAt >= receipt.after) { confirmedLoadouts.delete(key); continue; }
        const previous = data.loadouts.filter(row => receipt.outfit
          ? !(row.room_type === 'home' && row.owner_id === receipt.ownerId && row.slot === 'outfit')
          : !(row.room_type === 'home' && row.owner_id === receipt.ownerId && row.slot !== 'outfit'));
        data = { ...data, loadouts: [...previous, ...receipt.rows] };
      }
      for(const [ownerId,receipt] of confirmedShelfGifts){
        if(startedAt>receipt.after&&data.adventureCollection){confirmedShelfGifts.delete(ownerId);continue;}
        const collection=data.adventureCollection??state.data?.adventureCollection;
        if(collection)data={...data,adventureCollection:{...collection,displays:[...collection.displays.filter(row=>row.user_id!==ownerId),{user_id:ownerId,gift_id:receipt.itemId}]}};
      }
      if (state.data?.dailyPlusBonus?.claimed && state.data.dailyPlusBonus.key === data.dailyPlusBonus?.key) {
        data = { ...data, dailyPlusBonus: { ...data.dailyPlusBonus, claimed: true } };
      }
      syncCoinWallet(data.wallet, data.coinState, startedAt);
      const confirmed = getConfirmedCoinWallet();
      if (confirmed && confirmed.wallet.version >= (data.wallet?.version ?? -1)) {
        data = { ...data, wallet: confirmed.wallet, coinState: confirmed.coinState };
      }
      data = mergeJournalProjection(data, startedAt,Date.parse(data.serverNow)+Math.max(0,burrowClock()-receivedAt));
      data = mergeAdventureArrival(state.data, data, Date.parse(data.serverNow)+Math.max(0,burrowClock()-receivedAt));
      giftClaims.receive(data,true,giftReadRevision);
      data = roomEditSnapshot(giftClaims.project(data),true,roomReadRevision);
      questProgress.observe(data);
      retryDelay = 2_000;
      lastConfirmedReadStartedAt = startedAt;
      publish({ data, receivedAt, error: null, syncError: null, pairInvalidated: false }); persistWhenIdle();
      roomEdits.resume();
      catalogPurchases.resume();
      giftClaims.resume();
    }
  }).catch(error => {
    if (epoch === sessionEpoch() && requestRevision === revision && generation === readGeneration) {
      const code = errorCode(error);
      const fatal = ['not_paired','feature_disabled'].includes(code);
      if (fatal) clearBurrowSnapshot();
      // Cached scene stays usable. Read failures are not failed user actions.
      publish({ syncError: code, ...(!silent || !state.data || fatal ? { error: code } : {}), ...(fatal ? { data: null, pairInvalidated: true } : {}) });
      if (!fatal) retryRead();
    }
  }).finally(() => {
    if (readController === controller) { controller.abort(); readController = null; }
    if (flight === task) { flight = null; if (state.loading) publish({ loading: false }); }
  });
  flight = task;
  return task;
}

/** Navigation only fills an empty cache. SyncGate owns resume/periodic reads. */
export function refreshBurrowIfStale() {
  if (state.data) return Promise.resolve();
  return refreshBurrow({ silent: !!state.data });
}

/** A request begun before backgrounding cannot satisfy a resume check. */
export function refreshBurrowAfterCurrent({ silent = true, after }: { silent?: boolean; after?: number } = {}) {
  // Equal timestamps can represent a read immediately BEFORE a mutation on
  // a coarse clock. Only a strictly newer completed read is safe to reuse.
  if (after !== undefined && lastConfirmedReadStartedAt > after) return Promise.resolve();
  // Entry/resume checks share the current read. Only a mutation that completed
  // AFTER that read started needs one coalesced follow-up.
  if (after === undefined || !flight || requestStartedAt >= after) return refreshBurrow({ silent });
  latestRefreshAfter = Math.max(latestRefreshAfter, after);
  if (followup) return followup;
  const epoch = sessionEpoch(), requestRevision = revision, generation = readGeneration;
  const task = flight.then(async () => {
    while (!backgrounded && epoch === sessionEpoch() && requestRevision === revision && generation === readGeneration && requestStartedAt < latestRefreshAfter)
      await refreshBurrow({ silent });
  })
    .finally(() => { if (followup === task) followup = null; });
  followup = task; return task;
}
/** Burst interactions cause a single background snapshot, not one per tap. */
export function scheduleBurrowRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const after = burrowClock(), epoch = sessionEpoch();
  refreshTimer = setTimeout(() => { refreshTimer = null; if (epoch === sessionEpoch()) void refreshBurrowAfterCurrent({ after }); }, 400);
}
setCoinRewardReconciler(scheduleBurrowRefresh);

/** Keep a command key on uncertain failures so the Retry button cannot double debit. */
export function runBurrowAction(operation: string, action: (key: string) => Promise<unknown>, { silent = false, onError, expectedErrors = [] }: { silent?: boolean; onError?: (error: unknown) => void; expectedErrors?: readonly string[] } = {}): Promise<boolean> {
  const existing = operations.get(operation); if (existing) return existing;
  if (!silent && state.busy) return Promise.resolve(false);
  const task = execute().finally(() => { if (operations.get(operation) === task) operations.delete(operation); });
  operations.set(operation, task); return task;
  async function execute() {
  const epoch = sessionEpoch();
  const actionRevision = revision;
  const key = pendingKeys.get(operation) ?? randomUUID();
  pendingKeys.set(operation, key);
  persistKeys();
  if (!silent) publish({ busy: true, error: null });
  try {
    await action(key);
    if (epoch !== sessionEpoch() || actionRevision !== revision) return false;
    pendingKeys.delete(operation);
    persistKeys(); scheduleBurrowRefresh();
    return epoch === sessionEpoch() && actionRevision === revision;
  } catch (error) {
    if (epoch === sessionEpoch() && actionRevision === revision) {
      if (!expectedErrors.includes(errorCode(error))) publish({ error: errorCode(error) });
      try { onError?.(error); } catch {} // Presentation must not change the command outcome.
      if(!expectedErrors.includes(errorCode(error))&&typeof __DEV__!=='undefined'&&__DEV__)console.warn('[burrow/action]',operation.split(':')[0],errorCode(error));
      // A timeout can follow a committed reward. Reconcile silently, retaining
      // the durable operation key so Retry still cannot award twice.
      if (!['love_note_minute_limit', 'love_note_daily_limit'].includes(errorCode(error))) scheduleBurrowRefresh();
    }
    return false;
  } finally {
    if (!silent && epoch === sessionEpoch() && actionRevision === revision) publish({ busy: false });
  }
  }
}

export function useBurrowSnapshot() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Observe only what this host renders. Unlike useBurrow, this does not start
 * reads, subscribe to the coin wallet, or depend on navigation focus. */
export function useBurrowSelector<T>(select:(snapshot:State)=>T,equal:(before:T,next:T)=>boolean=Object.is):T {
  const current=useRef({select,equal});current.current={select,equal};
  const cached=useRef<{value:T}|null>(null);
  const read=useCallback(()=>{
    const next=current.current.select(state),before=cached.current;
    if(before&&current.current.equal(before.value,next))return before.value;
    cached.current={value:next};return next;
  },[]);
  return useSyncExternalStore(subscribe,read,read);
}

export function useBurrow(backgroundRoom=false, retainedPage?:RetainedPage) {
  const focused = useIsFocused();
  const retained = useRef(state);
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const changed=useCallback((before:State,next:State)=>!retainedPage||retainedPageChanged(before.data,next.data,retainedPage)
    ||(retainedPage==='affection'?['loading','pairInvalidated'] as const
      :retainedPage==='surprise'||retainedPage==='game'?['pairInvalidated'] as const
      :['loading','busy','error','syncError','pairInvalidated'] as const)
      .some(key=>before[key]!==next[key]),[retainedPage]);
  const read = useCallback(() => {
    const before=retained.current.data,next=state.data;
    const roomChanged=backgroundRoom&&(before?.profile.id!==next?.profile.id||before?.partner?.id!==next?.partner?.id
      ||before?.pairVersion!==next?.pairVersion||before?.profile.timezone_name!==next?.profile.timezone_name
      ||before?.catalog!==next?.catalog||before?.loadouts!==next?.loadouts||before?.roomPhotos!==next?.roomPhotos
      ||before?.adventureCollection?.displays!==next?.adventureCollection?.displays);
    if (roomChanged||focused&&changed(retained.current,state)) retained.current = state;
    return retained.current;
  }, [focused,backgroundRoom,changed]);
  const subscribePage = useCallback((listener:()=>void)=>{
    let deferred:(()=>void)|undefined;
    const release=subscribe(()=>{
      const before=retained.current.data,next=state.data;
      const identityChanged=before?.profile.id!==next?.profile.id||before?.partner?.id!==next?.partner?.id
        ||before?.pairVersion!==next?.pairVersion||before?.pairAccessVerified!==next?.pairAccessVerified;
      if(focusedRef.current||identityChanged){
        deferred?.();deferred=undefined;
        if(identityChanged)retained.current=state;
        if(identityChanged||changed(retained.current,state))listener();return;
      }
      if(backgroundRoom)listener(); // The read keeps only essential art handoffs immediate.
      // Notification caches prepare content independently of mounted views.
      // Do not redraw hidden lists/wallets or mount Adventure settlement effects
      // just because a silent receipt arrived. Focus reads the latest selected
      // snapshot synchronously. Only the small, side-effect-free Affection hub
      // is prepared offscreen; Home's essential art handoff is handled above.
      if(retainedPage==='affection'&&retainedPageChanged(before,next,retainedPage)){
        deferred?.();deferred=afterUiSettles(()=>{
          deferred=undefined;retained.current=state;listener();
        });
      }
    });
    return()=>{deferred?.();release();};
  },[backgroundRoom,retainedPage,changed]);
  // Only room-art changes can pre-render hidden Home for a seamless handoff.
  // Other hidden tabs (and Home's wallet/busy-only changes) remain frozen.
  const snapshot = useSyncExternalStore(subscribePage, read, read);
  // Neither hub paints a wallet. Rewards own their global wallet animation;
  // subscribing these full-screen rooms to wallet changes adds no feedback.
  const balance = useCoinBalance(focused&&retainedPage!=='affection'&&retainedPage!=='adventure'&&retainedPage!=='plushie'&&retainedPage!=='care');
  useFocusEffect(useCallback(() => {
    void refreshBurrowIfStale();
  }, []));
  return walletSnapshot(snapshot, balance);
}
let walletSource: State | null = null, walletBalance: number | null = null, walletResult: State | null = null;
function walletSnapshot(snapshot: State, balance: number | null): State {
  if (!snapshot.data || balance === null || snapshot.data.wallet.balance === balance) return snapshot;
  if (walletSource === snapshot && walletBalance === balance && walletResult) return walletResult;
  walletSource = snapshot; walletBalance = balance;
  walletResult = {...snapshot,data:{...snapshot.data,wallet:{...snapshot.data.wallet,balance}}};
  return walletResult;
}
