import { randomUUID } from 'expo-crypto';

import type { AffectionType, DailyQuestId, AdventureStatus } from '@novame/domain';

import { apiClient } from './api';
import { withDeadline, HOME_BOOTSTRAP_TIMEOUT_MS } from './async-lifecycle';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { commandCoinReward, settleCoinReward, failCoinReward, type CoinResponse } from './coin-reward-store';
import {submitCoinOperation,submitCoinCommand} from './coin-command-outbox';
import type { CoinWalletState } from './coin-reward-ledger';
import type { DailyPlusBonusState } from './daily-plus-bonus';
import { trackItemPurchaseForRating } from './official-rating-milestones';
import {BUNDLED_SHOP_RELEASE} from './generated/shop-catalog-version';
import type {AdventureTeamState,AdventureTeam} from './cooperative-adventure';

export interface MajorUpdateCatalogItem {
  stable_id: string;
  item_type: string;
  status?: string;
  category: string;
  title: string;
  description: string;
  price: number | null;
  plus_only: boolean;
  tradable: boolean;
  tags: string[];
  asset: Record<string, unknown>;
  metadata: { slot?: string; starter?: boolean; artOrdinal?: number; windowFrameKey?: string; giftCategory?: string; giftCategoryCode?: string; friendId?: string; catalogManaged?: boolean };
  is_placeholder: boolean;
}

export interface MajorUpdateQuest {
  assignmentId: string;
  questId: DailyQuestId;
  target: number;
  progress: number;
  completedAt: string | null;
  claimedAt: string | null;
}

export interface AdventureFriendContent {
  id: string;
  content_type: 'insight' | 'question' | 'emotional_help';
  prompt: string;
  choices: { id: string; label: string }[];
  feedback: Record<string, string>;
  rage_monster_id: string | null;
}

export interface CoupleFriendVisit {
  version: 2; id: string; friend_id: string; visit_date: string; pairVersion: string;
  myCompleted: boolean; expiresAt: string | null; waitingCopy: string | null; partnerCompleted?: boolean;
}
export interface FriendVisitConversation {
  sessionId: string; visitId: string; pairVersion: string;
  type: 'Trivia' | 'Preference' | 'Guess'; scene: string | null; lines: string[];
  question: string; choices: {id: string; label: string}[];
}
export interface PreparedFriendVisit extends Omit<FriendVisitConversation,'choices'> {
  friendId: string; mode: 'independent' | 'followup'; expiresAt: string | null; serverNow: string;
  choices: {id: string; label: string; feedback: string[]; reward: number}[];
}

export type AdventurePlan = { adventureId: string; version: string; readAt: string;
  result: NonNullable<MajorUpdateBootstrap['adventureResult']> };
export type AdventureDisplay = { userId: string; partnerId: string | null; pairVersion: string | null;
  serverNow: string; activeAdventure: MajorUpdateBootstrap['activeAdventure'];
  adventureResult: MajorUpdateBootstrap['adventureResult']; adventurePlan: AdventurePlan | null };

export interface MajorUpdateBootstrap {
  bunnyIdentity?:import('./bunny-identity-model').BunnyIdentity;
  adventureTeam?:AdventureTeamState;
  /** Process-local authorization; never trusted from disk. */
  pairAccessVerified?: true;
  /** Preselected display-only outcome. It cannot attest to an inventory award. */
  adventurePlan?: AdventurePlan | null;
  /** An atomic bootstrap read, not an inferred/default product price list. */
  catalogComplete?: true;
  photoUsage?: {localDate:string;frame:{limit:number;used:number;remaining:number};doll:{limit:number;targets:{ownerId:string;toyId:string;used:number}[]}};
  attention?: import('./burrow-attention').BurrowAttentionSnapshot;
  adventureCollection?: { enabled: boolean; displays: { user_id: string; gift_id: string }[]; progress: { friend_id: string; completed: number }[] };
  coinState?: CoinWalletState;
  dailyPlusBonus?: DailyPlusBonusState;
  unpaired?: boolean;
  musicTrackId: string | null;
  dollChangeUsed: boolean;
  dollPhotoChangesUsed?: string[];
  roomPhotos: { id: string; ownerId: string; kind: 'frame' | 'doll'; toyId?: string; updatedAt: string }[];
  sharedRoom: { mySleeping: boolean; partnerSleeping: boolean; updatedBy: string | null; updatedAt: string | null; decoratedBy: string | null };
  friendVisitsVersion?: 2;
  friendVisit: CoupleFriendVisit | {
    version?: 1;
    id: string; friend_id: string; visit_date: string; completed_at: string | null; declined_at: string | null;
    accepted_at: string | null; reward_item_id: string | null; reward_recipient_id: string | null;
    response: { choiceId?: string } | null;
    content_snapshot: { prompt: string; content_type: 'insight' | 'question' | 'emotional_help';
      choices: { id: string; label: string }[]; feedback: Record<string,string>; rage_monster_id: string | null };
  } | null;
  friendVisitDate: string;
  friendVisitTimezone: string;
  serverNow: string;
  localDate: string;
  /** Immutable economic clock; profile timezone remains display-only. */
  economicTimezone?: string;
  dailyAdventureUsed: boolean;
  specialQuests: { questId: string; stage: number; target: number; progress: number; reward: number }[];
  memoryPrompts: { id: string; prompt: string }[];
  memoryEntries: { id: string; author_id: string; body: string; prompt_id: string | null; created_at: string; updated_at: string; photos?: { id: string; slot: number; updatedAt: string }[] }[];
  readyRecordId: string | null;
  lastAffectionAt: string | null;
  partnerNeeds: { food: number; water: number; foodValue?: number; waterValue?: number; foodUpdatedAt?: string; waterUpdatedAt?: string };
  lastCareAt?: { food: string | null; water: string | null };
  partnerLastCareAt?: { food: string | null; water: string | null };
  dollPhotoChangeTargetsUsed?: { ownerId: string; toyId: string }[];
  inventory: { id: string; owner_id: string; item_id: string; source: string; acquired_at?: string }[];
  loadouts: { room_type: 'home' | 'our'; owner_id: string | null; slot: string; item_id: string }[];
  moments: { id: string; actor_id: string; target_id?: string | null; event_type: string; created_at: string; payload: Record<string, string> }[];
  gifts: { id: string; item_id: string; sender_id: string; created_at: string }[];
  /** Pending gift metadata may outlive a retired Shop listing. Never for sale. */
  giftCatalog?: MajorUpdateCatalogItem[];
  friends: { stable_id: string; name: string; subtitle: string }[];
  discoveries: { user_id: string; friend_id: string; source_adventure_id?: string | null; interaction_completed_at: string | null }[];
  friendContent: { id: string; content_type: string; prompt: string; choices: { id: string; label: string }[]; feedback: Record<string, string> }[];
  affectionInbox: { id: string; affection_type: AffectionType; completed_at: string }[];
  affectionInboxGroups?: { affection_type: AffectionType; completed_at: string; ids: string[] }[];
  affectionUsage?: {localDate:string;used:number;limit:number;remaining:number;keys?:string[];pending?:number};
  adventureResult: { id: string; result_type: 'item' | 'friend' | 'quiet'; item_id: string | null; friend_id: string | null; claim_status: string;
    metadata?: { encounterV2?: boolean; dialogueCompleted?: boolean; reaction?: string[]; response?: { choiceId: string };
      dialogue?: { id: string; scene: string | null; lines: string[]; choices: { id: string; label: string; reaction: string[] }[]; outro: string | null };
      giftSnapshot?: MajorUpdateCatalogItem; treasureSnapshot?: MajorUpdateCatalogItem | null; treasureReserved?: boolean; treasureClaimed?: boolean;
      treasureVersion?: number; treasureCoins?: number; treasureAwardCoins?: number; treasureAwardItemId?: string | null;
      friendContent?: AdventureFriendContent | null; friendSnapshot?: { stable_id?: string; name: string; gender?: string; metadata?: { gender?: string } } | null;
      itemSnapshot?: MajorUpdateCatalogItem | { title: string } | null; acceptedAt?: string; feedback?: string; declined?: boolean } } | null;
  rollout: { enabled: boolean; contentRevision: string };
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    is_default_avatar?: boolean | null;
    subscription_tier: string | null;
    timezone_name: string | null;
  };
  partner: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    is_default_avatar?: boolean | null;
    subscription_tier: string | null;
  } | null;
  hasPlus: boolean;
  roomModel?: 'personal-v2';
  pairVersion?: string;
  wallet: { balance: number; version: number };
  roomNeeds: {
    foodValue?: number;
    waterValue?: number;
    food: number;
    foodUpdatedAt: string;
    water: number;
    waterUpdatedAt: string;
    serverNow: string;
  };
  activeAdventure: { id: string; status: AdventureStatus; started_at: string; ends_at: string;
    /** Local preview until a start receipt supplies a real ID and deadline.
     * Exact started_at may be refined by display/bootstrap without a restart. */
    localStartPending?: true } | null;
  partnerAdventure?: { id: string; status: AdventureStatus; started_at: string; ends_at: string } | null;
  quests: {
    error: null;
    localDate: string;
    quests: MajorUpdateQuest[];
  };
  unread: { affection: number; gifts: number };
  catalog: MajorUpdateCatalogItem[];
}

type CommandResponse = CoinResponse & {
  success?: boolean;
  error?: string | null;
  [key: string]: unknown;
};

let bootstrapInFlight: Promise<MajorUpdateBootstrap> | null = null;
subscribeSessionIdentity(() => { bootstrapInFlight = null; });

export function fetchMajorUpdateBootstrap(options?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<MajorUpdateBootstrap> {
  if (bootstrapInFlight && !options?.force) return bootstrapInFlight;
  const epoch = sessionEpoch();
  const request = withDeadline(
    apiClient.get<{ success: boolean } & MajorUpdateBootstrap>('/api/vnext/bootstrap?friendVisits=2', { signal: options?.signal }),
    HOME_BOOTSTRAP_TIMEOUT_MS,
  ).then((response) => {
    if (epoch !== sessionEpoch()) throw new Error('session_changed');
    if (!response.success) throw new Error('major_update_bootstrap_failed');
    return { ...response, catalogComplete: true as const, pairAccessVerified: true as const };
  });
  const flight = request.finally(() => {
    if (bootstrapInFlight === flight) bootstrapInFlight = null;
  });
  bootstrapInFlight = flight;
  return flight;
}

async function command<T extends CommandResponse>(
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  if(['claim_daily_quest','claim_special_quest','complete_affection','refill_room_need'].includes(action)){
    return submitCoinCommand<T>(action,payload);
  }
  const epoch = sessionEpoch();
  const ticket = commandCoinReward(action, payload);
  try {
    const response = await withDeadline(apiClient.post<T>('/api/vnext/command', { action, ...payload }), 20_000);
    if (epoch !== sessionEpoch()) throw new Error('session_changed');
    if (response.error) throw new Error(response.error);
    settleCoinReward(ticket, response);
    return response;
  } catch (error) { failCoinReward(ticket,error); throw error; }
}

/** The shared wallet owns the celebration; Home only supplies its modal. */
export async function claimDailyPlusBonus(localDate: string,amount=50) {
  const epoch = sessionEpoch();
  const response = await submitCoinOperation<CommandResponse & {
    coinState: CoinWalletState; dailyPlusBonus: DailyPlusBonusState;
  }>({id:`plus-login:${localDate}`,key:`plus-login:${localDate}`,amount,deferred:false,path:'/api/vnext/command',payload:{action:'claim_daily_plus_bonus',localDate}});
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (response.error) throw new Error(response.error);
  if (!response.coinState?.wallet || !response.dailyPlusBonus?.claimed
    || response.dailyPlusBonus.key !== `plus-login:${localDate}` || response.dailyPlusBonus.localDate !== localDate) throw new Error('bonus_receipt_missing');
  return response;
}

export function saveRoomLoadout(roomType: 'home' | 'our', slots: Record<string, string>) {
  return command<CommandResponse>('save_room_loadout', { roomType, slots });
}
export function saveBunnyOutfit(itemId: string) {
  return command<CommandResponse>('save_bunny_outfit', { itemId });
}

export function selectRoomMusic(trackId: string | null) {
  return command<CommandResponse>('select_room_music', { trackId });
}

export async function fetchRoomPhoto(id: string, updatedAt?: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.get<{ url: string; success: boolean }>(`/api/vnext/room-photo?id=${encodeURIComponent(id)}${updatedAt ? `&version=${encodeURIComponent(updatedAt)}` : ''}`), 15_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  return result.url;
}

export async function fetchMemoryPhoto(id: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.get<{ url: string }>(`/api/vnext/memory-photo?id=${encodeURIComponent(id)}`), 15_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  return result.url;
}
export async function saveMemoryPhoto(entryId: string, slot: number, expectedPhotoId: string | null, base64: string, idempotencyKey: string, actorId: string, partnerId?: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.post<CommandResponse>('/api/vnext/memory-photo', { action: 'upload', entryId, slot, expectedPhotoId, base64, idempotencyKey, actorId, ...(partnerId?{partnerId}:{}) }), 30_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (result.error) throw new Error(result.error);
  return result;
}
export async function deleteMemoryPhoto(entryId: string, photoId: string, actorId: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.post<CommandResponse>('/api/vnext/memory-photo', { action: 'remove', entryId, photoId, actorId }), 15_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (result.error) throw new Error(result.error);
  return result;
}

export async function saveRoomPhoto(ownerId: string, kind: 'frame' | 'doll', base64: string, idempotencyKey: string, actorId: string, partnerId?: string, toyId?: string) {
  const epoch = sessionEpoch();
  if (kind === 'doll' && !toyId) throw new Error('toy_required');
  const result = await withDeadline(apiClient.post<CommandResponse & { photo?: MajorUpdateBootstrap['roomPhotos'][number];photoUsage?:MajorUpdateBootstrap['photoUsage'] }>('/api/vnext/room-photo', { actorId, ownerId, kind, base64, idempotencyKey, ...(partnerId?{partnerId}:{}), ...(kind === 'doll' ? {toyId} : {}) }), 30_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (result.error) throw new Error(result.error);
  return result;
}

export async function deleteRoomFramePhoto(photoId: string, actorId: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.delete<CommandResponse>('/api/vnext/room-photo', { photoId, actorId }), 15_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (result.error) throw new Error(result.error);
  return result;
}

export function visitPartnerRoom() {
  return command<CommandResponse>('visit_partner_room', {});
}

export function setRoomSleep(sleeping: boolean, idempotencyKey: string) {
  return command<CommandResponse>('set_room_sleep', { sleeping, idempotencyKey });
}

export function respondFriendVisit(visitId: string, response: { choiceId?: string; acknowledged?: boolean }) {
  return command<CommandResponse & { battleRequired?: boolean; monsterId?: string; feedback?: string }>('respond_friend_visit', { visitId, response });
}

export function beginFriendVisit(visitId: string, pairVersion: string) {
  return command<CommandResponse & FriendVisitConversation>('begin_friend_visit_v2', {visitId,pairVersion});
}
export function answerFriendVisit(conversation: FriendVisitConversation, choiceId: string) {
  return command<CommandResponse & {feedback:string[];reward:number}>('respond_friend_visit_v2', {
    visitId:conversation.visitId,sessionId:conversation.sessionId,pairVersion:conversation.pairVersion,choiceId,
  });
}

export function prepareFriendVisit(visitId: string, pairVersion: string) {
  return preparedVisitCommand<CommandResponse & PreparedFriendVisit>('prepare_friend_visit_v3',{visitId,pairVersion});
}
/** Preparing dialogue is read-like; its monetary answer uses the common outbox. */
async function preparedVisitCommand<T extends CommandResponse>(action:string,payload:Record<string,unknown>) {
  const epoch=sessionEpoch();
  const result=await withDeadline(apiClient.post<T>('/api/vnext/command',{action,...payload}),20_000);
  if(epoch!==sessionEpoch())throw Error('session_changed');
  if(result.error)throw Error(result.error);
  return result;
}
export function answerPreparedFriendVisit(conversation: PreparedFriendVisit, choiceId: string,quiet=false,deferred=false) {
  return submitCoinOperation<CommandResponse & {feedback:string[];reward:number}>({id:`friend-visit:${conversation.visitId}`,key:`friend-visit:${conversation.visitId}`,
    amount:conversation.choices?.find(c=>c.id===choiceId)?.reward??0,deferred,path:'/api/vnext/command',payload:{action:'respond_friend_visit_v3',
    visitId:conversation.visitId,sessionId:conversation.sessionId,pairVersion:conversation.pairVersion,choiceId,
  }},quiet);
}

export function claimSpecialQuest(questId: string, stage: number) {
  return command<CommandResponse>('claim_special_quest', { questId, stage });
}
export function saveMemoryRoomEntry(entryId: string | null, body: string, promptId: string | null, idempotencyKey: string) {
  return command<CommandResponse>('save_memory', { entryId, body, promptId, idempotencyKey });
}
export function deleteMemoryRoomEntry(entryId: string) {
  return command<CommandResponse>('delete_memory', { entryId });
}

export function refillRoomNeed(
  ownerId: string,
  need: 'food' | 'water',
  idempotencyKey = randomUUID(),
) {
  return command<CommandResponse>('refill_room_need', { ownerId, need, idempotencyKey });
}

export function interactBurrowToy(idempotencyKey = randomUUID(),ownerId?:string) {
  return command<CommandResponse>('interact_burrow_toy', { idempotencyKey,...(ownerId?{ownerId}:{}) });
}
export function interactBurrowToyBatch(idempotencyKey:string,count:number,scope:{userId:string;partnerId:string|null;pairVersion:string|null;localDate:string}) {
  return command<CommandResponse>('interact_burrow_toy_batch',{idempotencyKey,count,ownerId:scope.userId,
    partnerId:scope.partnerId,pairVersion:scope.pairVersion,localDate:scope.localDate});
}
export function interactBurrowToyWindow(scope:import('./toy-interaction-batcher').ToyRecordScope,batch:import('./toy-interaction-batcher').ToyRecordBatch) {
  return command<CommandResponse>('interact_burrow_toy_window',{ownerId:scope.userId,partnerId:scope.partnerId,
    pairVersion:scope.pairVersion,idempotencyKey:batch.id,count:batch.count,toyId:batch.toyId,photoId:batch.photoId,
    localDate:batch.localDate,windowStartedAt:batch.windowStartedAt,occurredAt:batch.occurredAt,lastOccurredAt:batch.lastOccurredAt});
}

export function completeAffection(
  affectionType: AffectionType,
  gestureMetrics: Record<string, unknown>,
  idempotencyKey = randomUUID(),
) {
  return command<CommandResponse>('complete_affection', {
    affectionType,
    gestureMetrics,
    idempotencyKey,
  });
}

export function startAdventure(recordId: string | null, idempotencyKey = randomUUID(),plan?:{version?:number;catalogRelease?:string;partnerId?:string|null;pairVersion?:string|null}) {
  return command<CommandResponse & { adventureDisplay?: AdventureDisplay;team?:AdventureTeam }>('start_adventure', { recordId, idempotencyKey,
    encounterVersion:plan?.version??4,catalogRelease:plan?.catalogRelease??BUNDLED_SHOP_RELEASE,
    ...(plan?.version===5?{partnerId:plan.partnerId??null,pairVersion:plan.pairVersion??null}:{}) });
}

export function fetchAdventureDisplay(adventureId: string) {
  return withDeadline(apiClient.get<AdventureDisplay>(`/api/vnext/adventure?adventureId=${encodeURIComponent(adventureId)}`), 5_000);
}

export function prepareAdventureEncounters() {
  return command<CommandResponse & { gifts: { id: string; url: string }[] }>('prepare_adventure_encounters', {});
}
export function selectAdventureGift(itemId: string | null) {
  return command<CommandResponse>('select_adventure_gift', { itemId });
}

export function accelerateAdventure(adventureId: string) {
  return command<CommandResponse>('accelerate_adventure', { adventureId });
}

export function settleAdventure(adventureId: string) {
  return command<CommandResponse>('settle_adventure', { adventureId });
}

export function claimAdventureResult(adventureId: string) {
  return command<CommandResponse & { interactionRequired?: boolean; itemId?: string | null }>('claim_adventure_result', { adventureId });
}
export function claimAdventureTreasure(adventureId: string) {
  return command<CommandResponse & { interactionRequired?: boolean; treasureClaimed?: boolean; itemId?: string | null; coins?: number }>('claim_adventure_treasure', { adventureId });
}

export function completeFriendInteraction(
  adventureId: string,
  response: Record<string, unknown>,
) {
  return command<CommandResponse & { feedback?: string; battleRequired?: boolean }>('complete_friend_interaction', { adventureId, response });
}

export function purchaseCatalogItem(
  itemId: string,
  recipientId?: string,
  idempotencyKey = randomUUID(),
  expectedPrice?: number,
) {
  return trackItemPurchaseForRating(command<CommandResponse>('purchase_catalog_item', {
    itemId,
    recipientId,
    idempotencyKey,
    expectedPrice,
  }), idempotencyKey, expectedPrice);
}

/** Atomically buy missing decorations and apply the whole previewed room. */
export function purchaseRoomLoadout(slots: Record<string, string>, idempotencyKey = randomUUID(), outfitItemId?: string, expectedPrices?: Record<string, number>) {
  return trackItemPurchaseForRating(command<CommandResponse>('purchase_room_loadout', { slots, idempotencyKey, outfitItemId, expectedPrices }), idempotencyKey, undefined, true);
}

export function claimGift(giftId: string) {
  return command<CommandResponse>('claim_gift', { giftId });
}

export function assignDailyQuests() {
  return command<CommandResponse>('assign_daily_quests', {});
}

export function claimDailyQuest(assignmentId: string) {
  return command<CommandResponse>('claim_daily_quest', { assignmentId });
}

export function markAffectionRead(ids: string[]) {
  return command<CommandResponse>('mark_affection_read', { ids });
}
