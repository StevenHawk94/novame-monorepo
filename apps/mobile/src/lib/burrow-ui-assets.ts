// Metro requires literal paths. Keep all supplied UI artwork in one registry.
export const BURROW_ROOM_ICONS = {
  our_room: require('../../assets/burrow-webp/burrow page icons/our-room.webp'),
  friends_room: require('../../assets/burrow-webp/burrow page icons/friends-room.webp'),
  game_room: require('../../assets/burrow-webp/burrow page icons/game-room.webp'),
  rage_room: require('../../assets/burrow-webp/burrow page icons/rage-room.webp'),
  memories_room: require('../../assets/burrow-webp/burrow page icons/memory room.webp'),
  collection_room: require('../../assets/burrow-webp/burrow page icons/collection-room.webp'),
} as const;

export const BURROW_AFFECTION_ICONS = {
  hug: require('../../assets/burrow-webp/affection page icons/hug.webp'),
  kiss: require('../../assets/burrow-webp/affection page icons/kiss.webp'),
  cuddle: require('../../assets/burrow-webp/affection page icons/cuddle.webp'),
  spicy: require('../../assets/burrow-webp/affection page icons/spicy.webp'),
  miss_you: require('../../assets/burrow-webp/affection page icons/miss you.webp'),
  gratitude: require('../../assets/burrow-webp/affection page icons/gratitude.webp'),
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

export const BURROW_COIN_ART = {
  200: require('../../assets/burrow-webp/Coin-purchase-page/200coins.webp'),
  400: require('../../assets/burrow-webp/Coin-purchase-page/400coins.webp'),
  1000: require('../../assets/burrow-webp/Coin-purchase-page/1000coins.webp'),
} as const;

export const BURROW_GAME_RULE_ICONS = [
  require('../../assets/burrow-webp/game room/rule-1.webp'),
  require('../../assets/burrow-webp/game room/rule-2.webp'),
  require('../../assets/burrow-webp/game room/rule-3.webp'),
] as const;

export const BURROW_FRIEND_ART: Record<string, number> = {
  'Miss Armadillo': require('../../assets/burrow-webp/adventure-page/Miss Armadillo.webp'),
  'Miss Forg': require('../../assets/burrow-webp/adventure-page/Miss Forg.webp'),
  'Miss Frog': require('../../assets/burrow-webp/adventure-page/Miss Forg.webp'),
  'Mr Badger': require('../../assets/burrow-webp/adventure-page/Mr Badger.webp'),
  'Mr Hedgehog': require('../../assets/burrow-webp/adventure-page/Mr Hedgehog.webp'),
  'Mr Mole': require('../../assets/burrow-webp/adventure-page/Mr Mole.webp'),
  'Mr Pocket Gopher': require('../../assets/burrow-webp/adventure-page/Mr Pocket Gopher.webp'),
  'Mr Prairie Dog': require('../../assets/burrow-webp/adventure-page/Mr Prairie Dog.webp'),
  'Mr Wombat': require('../../assets/burrow-webp/adventure-page/Mr Wombat.webp'),
  'Mrs Aardvark': require('../../assets/burrow-webp/adventure-page/Mrs Aardvark.webp'),
  'Mrs Meerkat': require('../../assets/burrow-webp/adventure-page/Mrs Meerkat.webp'),
  'Mrs Owl': require('../../assets/burrow-webp/adventure-page/Mrs Owl.webp'),
};

// Keep the original catalogue alias for Pip; a missing art match must never
// invent a different friend or change the reward attached to a discovery.
export function burrowFriendArt(name: string | null | undefined) {
  return name ? BURROW_FRIEND_ART[name] ?? (name === 'Pip' ? BURROW_FRIEND_ART['Miss Forg'] : undefined) : undefined;
}
