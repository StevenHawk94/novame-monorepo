import type { HistoryRow } from './burrow-history';

export type MomentKind = 'water' | 'feed' | 'journal' | 'affection' | 'game' | 'log-day' | 'letter' | 'toy' | 'rage';

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
    default: return null;
  }
}

const affectionNames: Record<string, string> = {
  hug: 'hug', kiss: 'kiss', spicy: 'little spice', cuddle: 'cuddle', gratitude: 'thank-you', miss_you: 'miss-you',
};

function gameName(value: string | undefined) {
  if (!value) return 'a game';
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function momentDescription(row: HistoryRow, selfId: string, partnerName: string): string {
  if (!('event_type' in row)) return '';
  const self = row.actor_id === selfId;
  const actor = self ? 'You' : partnerName;
  switch (momentKind(row)) {
    case 'water': return self ? 'You watered the flower' : `${actor} watered your flower`;
    case 'feed': return self ? 'You fed your bunny' : `${actor} fed their bunny`;
    case 'journal': return row.event_type === 'adventure_record_saved'
      ? `${actor} wrote a journal entry` : `${actor} answered a journal question`;
    case 'affection': return `${actor} sent ${self ? partnerName : 'you'} a ${affectionNames[row.payload.affectionType] ?? 'little love'}`;
    case 'game': return `You and ${partnerName} finished ${gameName(row.payload.gameId)}`;
    case 'log-day': return self ? 'You logged your day' : `${actor} logged their day`;
    case 'letter': return self ? `You sent ${partnerName} a love note` : `${actor} sent you a love note`;
    case 'toy': {
      const count = Math.max(1, Number(row.payload.count) || 1);
      return `${actor} played with the toy · ${count} ${count === 1 ? 'touch' : 'touches'}`;
    }
    case 'rage': return `${actor} let out some steam in the Rage Room`;
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
