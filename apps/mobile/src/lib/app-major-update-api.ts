import { randomUUID } from 'expo-crypto';

import type { AffectionType, DailyQuestId, AdventureStatus } from '@novame/domain';

import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';

export interface MajorUpdateCatalogItem {
  stable_id: string;
  item_type: string;
  category: string;
  title: string;
  description: string;
  price: number | null;
  plus_only: boolean;
  tradable: boolean;
  tags: string[];
  asset: Record<string, unknown>;
  metadata: { slot?: string; starter?: boolean; artOrdinal?: number };
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

export interface MajorUpdateBootstrap {
  unpaired?: boolean;
  musicTrackId: string | null;
  dollChangeUsed: boolean;
  roomPhotos: { id: string; ownerId: string; kind: 'frame' | 'doll'; updatedAt: string }[];
  sharedRoom: { mySleeping: boolean; partnerSleeping: boolean; updatedBy: string | null; updatedAt: string | null; decoratedBy: string | null };
  friendVisit: {
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
  dailyAdventureUsed: boolean;
  specialQuests: { questId: string; stage: number; target: number; progress: number; reward: number }[];
  memoryPrompts: { id: string; prompt: string }[];
  memoryEntries: { id: string; author_id: string; body: string; prompt_id: string | null; created_at: string; updated_at: string; photos?: { id: string; slot: number; updatedAt: string }[] }[];
  readyRecordId: string | null;
  lastAffectionAt: string | null;
  partnerNeeds: { food: number; water: number; foodValue?: number; waterValue?: number; foodUpdatedAt?: string; waterUpdatedAt?: string };
  inventory: { id: string; owner_id: string; item_id: string; source: string }[];
  loadouts: { room_type: 'home' | 'our'; owner_id: string | null; slot: string; item_id: string }[];
  moments: { id: string; actor_id: string; event_type: string; created_at: string; payload: Record<string, string> }[];
  gifts: { id: string; item_id: string; sender_id: string; created_at: string }[];
  friends: { stable_id: string; name: string; subtitle: string }[];
  discoveries: { user_id: string; friend_id: string; interaction_completed_at: string | null }[];
  friendContent: { id: string; content_type: string; prompt: string; choices: { id: string; label: string }[]; feedback: Record<string, string> }[];
  affectionInbox: { id: string; affection_type: AffectionType; completed_at: string }[];
  adventureResult: { id: string; result_type: 'item' | 'friend' | 'quiet'; item_id: string | null; friend_id: string | null; claim_status: string;
    metadata?: { friendContent?: AdventureFriendContent | null; friendSnapshot?: { name: string } | null;
      itemSnapshot?: { title: string } | null; acceptedAt?: string; feedback?: string; declined?: boolean } } | null;
  rollout: { enabled: boolean; contentRevision: string };
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    subscription_tier: string | null;
    timezone_name: string | null;
  };
  partner: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    subscription_tier: string | null;
  } | null;
  hasPlus: boolean;
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
  activeAdventure: { id: string; status: AdventureStatus; started_at: string; ends_at: string } | null;
  partnerAdventure?: { id: string; status: AdventureStatus; started_at: string; ends_at: string } | null;
  quests: {
    error: null;
    localDate: string;
    quests: MajorUpdateQuest[];
  };
  unread: { affection: number; gifts: number };
  catalog: MajorUpdateCatalogItem[];
}

type CommandResponse = {
  success?: boolean;
  error?: string | null;
  [key: string]: unknown;
};

let bootstrapInFlight: Promise<MajorUpdateBootstrap> | null = null;
subscribeSessionIdentity(() => { bootstrapInFlight = null; });

export function fetchMajorUpdateBootstrap(options?: {
  force?: boolean;
}): Promise<MajorUpdateBootstrap> {
  if (bootstrapInFlight && !options?.force) return bootstrapInFlight;
  const epoch = sessionEpoch();
  const request = withDeadline(
    apiClient.get<{ success: boolean } & MajorUpdateBootstrap>('/api/vnext/bootstrap'),
    20_000,
  ).then((response) => {
    if (epoch !== sessionEpoch()) throw new Error('session_changed');
    if (!response.success) throw new Error('major_update_bootstrap_failed');
    return response;
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
  const epoch = sessionEpoch();
  const response = await withDeadline(apiClient.post<T>('/api/vnext/command', { action, ...payload }), 20_000);
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (response.error) throw new Error(response.error);
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

export async function fetchRoomPhoto(id: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.get<{ url: string; success: boolean }>(`/api/vnext/room-photo?id=${encodeURIComponent(id)}`), 15_000);
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

export async function saveRoomPhoto(ownerId: string, kind: 'frame' | 'doll', base64: string, idempotencyKey: string, actorId: string, partnerId?: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.post<CommandResponse>('/api/vnext/room-photo', { actorId, ownerId, kind, base64, idempotencyKey, ...(partnerId?{partnerId}:{}) }), 30_000);
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

export function interactBurrowToy(idempotencyKey = randomUUID()) {
  return command<CommandResponse>('interact_burrow_toy', { idempotencyKey });
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

export function startAdventure(recordId: string | null, idempotencyKey = randomUUID()) {
  return command<CommandResponse>('start_adventure', { recordId, idempotencyKey });
}

export function accelerateAdventure(adventureId: string) {
  return command<CommandResponse>('accelerate_adventure', { adventureId });
}

export function settleAdventure(adventureId: string) {
  return command<CommandResponse>('settle_adventure', { adventureId });
}

export function claimAdventureResult(adventureId: string) {
  return command<CommandResponse>('claim_adventure_result', { adventureId });
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
) {
  return command<CommandResponse>('purchase_catalog_item', {
    itemId,
    recipientId,
    idempotencyKey,
  });
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
