import type { HistoryRow } from './burrow-history';
import type { MajorUpdateCatalogItem } from './app-major-update-api';
import names from './burrow-moment-names.json';

export type MomentKind = 'water' | 'feed' | 'journal' | 'affection' | 'game' | 'log-day' | 'letter' | 'toy' | 'rage' | 'gift' | 'surprise';

export function momentKind(row: HistoryRow): MomentKind | null {
  if (!('event_type' in row)) return null;
  switch (row.event_type) {
    case 'room_need_refilled': return row.payload.need === 'water' ? 'water' : row.payload.need === 'food' ? 'feed' : null;
    case 'memory_created': return row.payload.kind === 'love_note' ? 'letter' : 'journal';
    case 'affection_sent': return 'affection';
    case 'game_played': return 'game';
    case 'adventure_record_saved': return row.payload.journalKind === 'tap_your_day' ? 'log-day' : 'journal';
    case 'toy_interacted': return 'toy';
    case 'rage_room_completed': return 'rage';
    case 'gift_sent': return 'gift';
    case 'surprise_sent': return 'surprise';
    default: return null;
  }
}

const affectionNames: Record<string, string> = {
  hug: 'hug', kiss: 'kiss', cuddle: 'cuddle', gratitude: 'thank you', miss_you: '“miss you”',
};
const productTypes:Record<string,string>={outfits:'Outfit',wallpapers:'Wallpaper',couple_dolls:'Plushie',
  cushions:'Cushion',tables:'Table',rugs:'Rug',vases:'Flower',lamps:'Floor Lamp',windows:'Window',
  cabinets:'Cabinet',music_players:'Music Player',frames:'Photo Frame',dresser_plants:'Kettle',
  light_strings:'String Lights',ladders:'Ladder',shelves:'Floating Shelf',shelf_decor:'Decoration',our_room:'Room'};
const gameNames:Record<string,string>=names.games,monsterNames:Record<string,string>=names.monsters;

function gameName(value: string | undefined) {
  if (!value) return 'a game';
  if(gameNames[value])return gameNames[value];
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function momentDescription(row: HistoryRow, selfId: string, partnerName: string, catalog:readonly MajorUpdateCatalogItem[]=[]): string {
  if (!('event_type' in row)) return '';
  const self = row.actor_id === selfId;
  const actor = self ? 'You' : partnerName;
  switch (momentKind(row)) {
    case 'water': return !row.target_id?(self?'You watered the flower':`${actor} watered your flower`)
      : `${actor} watered ${row.target_id===selfId?'your':self?`${partnerName}'s`:'their'} flower`;
    case 'feed': return !row.target_id?(self?'You fed your bunny':`${actor} fed their bunny`)
      : `${actor} fed ${row.target_id===selfId?'your':self?`${partnerName}'s`:'their'} bunny`;
    case 'journal': return row.event_type === 'adventure_record_saved'
      ? `${actor} wrote a journal entry` : `${actor} answered a question in memories room`;
    case 'affection': return row.payload.affectionType==='spicy'
      ? `${actor} sent ${self ? partnerName : 'you'} some heat 🔥`
      : `${actor} sent ${self ? partnerName : 'you'} a ${affectionNames[row.payload.affectionType] ?? 'little love'}`;
    case 'game': return `You and ${partnerName} played ${gameName(row.payload.gameId)}`;
    case 'log-day': return self ? 'You logged your day' : `${actor} logged their day`;
    case 'letter': return self ? `You sent ${partnerName} a love note` : `${actor} sent you a love note`;
    case 'toy': {
      const count = Math.max(1, Number(row.payload.count) || 1);
      return `${actor} squished ${self ? `${partnerName}'s` : 'your'} plushie ${count} ${count === 1 ? 'time' : 'times'}`;
    }
    case 'rage': return `${actor} tamed "${monsterNames[row.payload.monsterId] ?? row.payload.monsterName ?? 'a monster'}"`;
    case 'gift': {
      const item=catalog.find(item=>item.stable_id===row.payload.itemId);
      const title=row.payload.productName||item?.title;
      const category=row.payload.productCategory||item?.category;
      const type=category?(productTypes[category]??category.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())):'Gift';
      return `${actor} sent ${self?partnerName:'you'} a gift 🎁${title?` · ${type}-${title}`:''}`;
    }
    case 'surprise': return `${actor} sent ${self?partnerName:'you'} a surprise`;
    default: return '';
  }
}

export function momentLocalDate(value: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone }).formatToParts(new Date(value));
    const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${date.year}-${date.month}-${date.day}`;
  } catch { return value.slice(0, 10); }
}
