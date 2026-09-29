/**
 * Stable identifiers for the Burrow major update.
 *
 * Product copy and artwork are intentionally not defined here. Persisted rows
 * and navigation depend on these identifiers, while content can be replaced
 * through the catalog without changing application code.
 */

export const APP_MAJOR_UPDATE_FLAG = 'app_major_update_enabled' as const;
export const APP_MAJOR_UPDATE_CONTENT_REVISION = 'burrow-v1-placeholder' as const;

export const BURROW_ROOM_IDS = [
  'my_room',
  'partner_room',
  'our_room',
  'friends_room',
  'game_room',
  'rage_room',
  'self_care_room',
  'memories_room',
  'collection_room',
] as const;
export type BurrowRoomId = (typeof BURROW_ROOM_IDS)[number];

export const HOME_DECOR_SLOTS = [
  'cushion',
  'table',
  'rug',
  'vase',
  'lamp',
  'window',
  'cabinet',
  'decor',
  'music_player',
  'frame',
  'poster',
  'couple_doll',
] as const;
export type HomeDecorSlot = (typeof HOME_DECOR_SLOTS)[number];

export const SHOP_CATEGORIES = [
  'outfits',
  'windows',
  'lamps',
  'vases',
  'decor',
  'cushions',
  'tables',
  'rugs',
  'cabinets',
  'posters',
  'music_players',
  'frames',
  'couple_dolls',
  'our_room',
] as const;
export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

export const COLLECTION_CATEGORIES = [
  'decor',
  'outfits',
  'our_room',
  'gifts',
  'friends',
] as const;
export type CollectionCategory = (typeof COLLECTION_CATEGORIES)[number];

export const AFFECTION_TYPES = [
  'hug',
  'spicy',
  'cuddle',
  'gratitude',
  'kiss',
  'miss_you',
] as const;
export type AffectionType = (typeof AFFECTION_TYPES)[number];

export const ADVENTURE_STATUSES = [
  'record_saved',
  'memories_confirmed',
  'ready_to_start',
  'in_progress',
  'result_ready',
  'interaction_required',
  'completed',
  'cancelled',
] as const;
export type AdventureStatus = (typeof ADVENTURE_STATUSES)[number];

export const ADVENTURE_RESULT_TYPES = ['item', 'friend', 'quiet'] as const;
export type AdventureResultType = (typeof ADVENTURE_RESULT_TYPES)[number];

export const FRIEND_CONTENT_TYPES = [
  'insight',
  'question',
  'emotional_help',
] as const;
export type FriendContentType = (typeof FRIEND_CONTENT_TYPES)[number];

export const MOMENT_EVENT_TYPES = [
  'adventure_record_saved',
  'adventure_completed',
  'friend_discovered',
  'affection_sent',
  'room_need_refilled',
  'room_media_updated',
  'gift_sent',
  'gift_claimed',
  'memory_created',
] as const;
export type MomentEventType = (typeof MOMENT_EVENT_TYPES)[number];

export const DAILY_QUEST_IDS = [
  'write_adventure_record',
  'send_affection',
  'water_partner_flower',
  'feed_partner_bunny',
  'visit_partner_room',
  'finish_adventure',
  'play_game',
] as const;
export type DailyQuestId = (typeof DAILY_QUEST_IDS)[number];

/** Games are a preview in this release, so game quests cannot be assigned. */
export const ACTIVE_DAILY_QUEST_IDS = DAILY_QUEST_IDS.filter(id => id !== 'play_game');
export const SPECIAL_QUEST_STEPS = {
  adventures_completed: 5,
  items_collected: 10,
  friends_met: 2,
  games_played: 5,
} as const;

export const CURRENCY_REWARDS = {
  dailyQuest: 10,
  specialQuestStage: 15,
  firstDailyAffection: 10,
  firstDailyAdventureRecord: 10,
  firstDailyGame: 5,
  firstDailyRage: 5,
  firstDailyPartnerWater: 5,
  firstDailyPartnerFeed: 5,
  plusDailyLogin: 50,
} as const;

export interface RoomAssetPlacement {
  anchorX: number;
  anchorY: number;
  widthRatio: number;
  zIndex: number;
}

export interface CatalogAssetDescriptor extends RoomAssetPlacement {
  imageUrl: string;
  thumbUrl: string;
  assetVersion: number;
}
