import friendBounds from './adventure-friend-bounds.json';
import type { FriendGeometry } from './adventure-encounter-layout';

// Metro requires literal paths. Keep all supplied UI artwork in one registry.
export const BURROW_ROOM_ICONS = {
  my_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/my-room.webp'),
  partner_room: require("../../assets/burrow-webp/burrow-page/burrow page icons/partner's-room.webp"),
  surprise_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/surprise-room.webp'),
  friends_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/friends-room.webp'),
  game_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/game-room.webp'),
  rage_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/rage-room.webp'),
  memories_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/memory room.webp'),
  collection_room: require('../../assets/burrow-webp/burrow-page/burrow page icons/collection-room.webp'),
} as const;

export const BURROW_AFFECTION_ICONS = {
  hug: require('../../assets/burrow-webp/affection page icons/Hug.webp'),
  kiss: require('../../assets/burrow-webp/affection page icons/Kiss.webp'),
  cuddle: require('../../assets/burrow-webp/affection page icons/Cuddle.webp'),
  spicy: require('../../assets/burrow-webp/affection page icons/Spicy.webp'),
  miss_you: require('../../assets/burrow-webp/affection page icons/Miss You.webp'),
  gratitude: require('../../assets/burrow-webp/affection page icons/Gratitude.webp'),
} as const;

export const BURROW_DAILY_ENTRY_ART = {
  napping: require('../../assets/burrow-webp/adventure-page/napping.webp'),
  plus: require('../../assets/burrow-webp/affection page icons/plus.webp'),
} as const;

export const BURROW_QUEST_BANNER = require('../../assets/burrow-webp/Quest-Page-Banner.webp');

export const BURROW_ADVENTURE_ENTRY_ART = {
  banner: require('../../assets/burrow-webp/adventure-page-banner.webp'),
  compass: require('../../assets/burrow-webp/adventure-page/select-page.webp'),
  write: require('../../assets/burrow-webp/adventure-page/write-freely.webp'),
  tap: require('../../assets/burrow-webp/adventure-page/tab-your-day.webp'),
} as const;

export const BURROW_QUEST_ICONS = {
  write_adventure_record: require('../../assets/burrow-webp/quests page icons/daily quests-adventure.webp'),
  send_affection: require('../../assets/burrow-webp/quests page icons/daily quests-affection.webp'),
  feed_partner_bunny: require('../../assets/burrow-webp/quests page icons/daily quests-feed bunny.webp'),
  water_partner_flower: require('../../assets/burrow-webp/quests page icons/daily quests-water flower.webp'),
  play_game: require('../../assets/burrow-webp/quests page icons/daily quests-game with partner.webp'),
  interact_with_toy: require('../../assets/burrow-webp/quests page icons/daily quests-toy interation.webp'),
  adventures_completed: require('../../assets/burrow-webp/quests page icons/special quests-adventure finished..webp'),
  items_collected: require('../../assets/burrow-webp/quests page icons/special quests-item collected.webp'),
  friends_met: require('../../assets/burrow-webp/quests page icons/special quests-friends met..webp'),
  games_played: require('../../assets/burrow-webp/quests page icons/special quests-game played.webp'),
} as const;

/** Existing Moments art, with bundled gift/Surprise art for sent events. */
export const BURROW_MOMENT_ICONS = {
  water: require('../../assets/burrow-webp/moments-icons/water.webp'),
  feed: require('../../assets/burrow-webp/moments-icons/feed.webp'),
  journal: require('../../assets/burrow-webp/moments-icons/journal.webp'),
  affection: require('../../assets/burrow-webp/moments-icons/affection.webp'),
  game: require('../../assets/burrow-webp/moments-icons/game.webp'),
  'log-day': require('../../assets/burrow-webp/moments-icons/log-day.webp'),
  letter: require('../../assets/burrow-webp/moments-icons/letter.webp'),
  toy: require('../../assets/burrow-webp/moments-icons/toy.webp'),
  rage: require('../../assets/burrow-webp/moments-icons/rage.webp'),
  gift: require('../../assets/Tap-your-day-Icons/memory.new_gave_a_gift.webp'),
  surprise: BURROW_ROOM_ICONS.surprise_room,
} as const;

export const BURROW_GAME_RULE_ICONS = [
  require('../../assets/burrow-webp/game room/rule-1.webp'),
  require('../../assets/burrow-webp/game room/rule-2.webp'),
  require('../../assets/burrow-webp/game room/rule-3.webp'),
] as const;

export const BURROW_FRIEND_ART: Record<string, readonly [number, number]> = {
  "Arlo": [require("../../assets/burrow-webp/adventure-page/Aardvark_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Aardvark_03_Variant2.webp")],
  "Biscuit": [require("../../assets/burrow-webp/adventure-page/Groundhog_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Groundhog_03_Variant2.webp")],
  "Bruno": [require("../../assets/burrow-webp/adventure-page/Bear_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Bear_03_Variant2.webp")],
  "Duchess": [require("../../assets/burrow-webp/adventure-page/Badger_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Badger_03_Variant2.webp")],
  "Dillon": [require("../../assets/burrow-webp/adventure-page/Armadillo_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Armadillo_03_Variant2.webp")],
  "Fenn": [require("../../assets/burrow-webp/adventure-page/Frog_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Frog_03_Variant2.webp")],
  "Hazel": [require("../../assets/burrow-webp/adventure-page/Squirrel_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Squirrel_03_Variant2.webp")],
  "Juniper": [require("../../assets/burrow-webp/adventure-page/Fox_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Fox_03_Variant2.webp")],
  "Kiki": [require("../../assets/burrow-webp/adventure-page/Meerkat_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Meerkat_03_Variant2.webp")],
  "Mr Mole": [require("../../assets/burrow-webp/adventure-page/Mole_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Mole_03_Variant2.webp")],
  "Oswin": [require("../../assets/burrow-webp/adventure-page/Owl_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Owl_03_Variant2.webp")],
  "Pickles": [require("../../assets/burrow-webp/adventure-page/Hedgehog_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Hedgehog_03_Variant2.webp")],
  "Rue": [require("../../assets/burrow-webp/adventure-page/Wolf_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Wolf_03_Variant2.webp")],
  "Tobias": [require("../../assets/burrow-webp/adventure-page/Tortoise_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Tortoise_03_Variant2.webp")],
  "Twig": [require("../../assets/burrow-webp/adventure-page/Mouse_02_Variant1.webp"), require("../../assets/burrow-webp/adventure-page/Mouse_03_Variant2.webp")],
};
const legacyFriends: Record<string,string> = {"Miss Armadillo":"Dillon","Miss Forg":"Fenn","Miss Frog":"Fenn","Pip":"Fenn","Mr Badger":"Duchess","Mr Hedgehog":"Pickles","Mr Mole":"Mr Mole","Mr Pocket Gopher":"Biscuit","Mr Prairie Dog":"Kiki","Mr Wombat":"Bruno","Mrs Aardvark":"Arlo","Mrs Meerkat":"Kiki","Mrs Owl":"Oswin"};
export function burrowFriendArt(name: string | null | undefined, answered = false) {
  if (!name) return undefined;
  return (BURROW_FRIEND_ART[name] ?? BURROW_FRIEND_ART[legacyFriends[name]])?.[answered ? 1 : 0];
}

/** Measured offline at alpha > 16. No decoding/measuring on the UI thread. */
export function burrowFriendArtGeometry(name: string | null | undefined): FriendGeometry | undefined {
  if (!name) return undefined;
  return (friendBounds as unknown as Record<string, FriendGeometry>)[legacyFriends[name] ?? name];
}
