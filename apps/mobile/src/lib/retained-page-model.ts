import type { MajorUpdateBootstrap } from './app-major-update-api';
export type RetainedPage = 'home' | 'burrow' | 'quests' | 'shop' | 'moments' | 'collection' | 'affection' | 'adventure' | 'game' | 'surprise' | 'partner_room' | 'plushie';
const fields: Record<RetainedPage, readonly (keyof MajorUpdateBootstrap)[]> = {
  home: ['catalog','catalogComplete','inventory','loadouts','roomPhotos','photoUsage','adventureCollection','unread','wallet',
    'activeAdventure','adventureResult','adventurePlan','dailyAdventureUsed','readyRecordId','roomNeeds','lastCareAt','sharedRoom',
    'dailyPlusBonus','affectionInbox','affectionInboxGroups','affectionUsage','memoryEntries','gifts','giftCatalog','musicTrackId'],
  burrow: ['friendVisit','friendVisitsVersion','friends','discoveries','friendContent','adventureCollection','unread','activeAdventure','moments','roomPhotos','catalog','pairAccessVerified'],
  quests: ['quests','specialQuests','activeAdventure','dailyAdventureUsed','readyRecordId','inventory','catalog','wallet'],
  shop: ['catalog','catalogComplete','inventory','loadouts','roomPhotos','adventureCollection','wallet','activeAdventure','partnerAdventure','gifts','giftCatalog','photoUsage','dollChangeUsed','dollPhotoChangesUsed','dollPhotoChangeTargetsUsed'],
  moments: ['moments','catalog','pairAccessVerified'],
  collection: ['catalog','catalogComplete','inventory','gifts','giftCatalog','loadouts','roomPhotos','adventureCollection','wallet','activeAdventure','partnerAdventure','photoUsage','dollChangeUsed','dollPhotoChangesUsed','dollPhotoChangeTargetsUsed'],
  affection: ['affectionInbox','affectionInboxGroups','affectionUsage','lastAffectionAt','unread'],
  adventure: ['catalog','catalogComplete','inventory','activeAdventure','adventureResult','adventurePlan',
    'adventureTeam','bunnyIdentity','adventureCollection','dailyAdventureUsed','readyRecordId','quests','specialQuests','friends','discoveries','friendContent'],
  game: ['catalog','catalogComplete','wallet'],
  surprise: ['catalog','catalogComplete','wallet'],
  plushie:['catalog','catalogComplete','inventory','loadouts','roomPhotos','photoUsage','dollPhotoChangesUsed','dollPhotoChangeTargetsUsed'],
  partner_room: ['catalog','catalogComplete','inventory','loadouts','roomPhotos','adventureCollection','wallet',
    'partnerAdventure','roomNeeds','lastCareAt','sharedRoom'],
};
export function retainedPageChanged(before: MajorUpdateBootstrap | null, next: MajorUpdateBootstrap | null, page: RetainedPage) {
  if (before === next) return false;
  if (!before || !next) return true;
  if(['profile','partner','pairVersion','pairAccessVerified','localDate','hasPlus',...fields[page]]
    .some(key => before[key as keyof MajorUpdateBootstrap] !== next[key as keyof MajorUpdateBootstrap]))return true;
  const channels=page==='home'?['letters'] as const:page==='burrow'?['games','journal'] as const:page==='game'?['games'] as const:page==='moments'?['moments'] as const:[];
  return channels.length>0&&(before.attention?.scope!==next.attention?.scope||
    channels.some(channel=>before.attention?.[channel]!==next.attention?.[channel]));
}
