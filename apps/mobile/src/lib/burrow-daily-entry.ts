import type { MajorUpdateBootstrap } from './app-major-update-api';
import { burrowLocalDay } from './burrow-local-day';
import {adventureEntryState} from './adventure-entry-state';

/** Entry decisions use the cached server clock and the owner's timezone, not
 * the phone's wall clock. An unfinished result always remains accessible. */
export function adventureFinishedToday(data: MajorUpdateBootstrap | null, now: number) {
  return adventureEntryState(data,now).kind==='napping';
}

export function freeAffectionUsedToday(data: MajorUpdateBootstrap | null, now: number) {
  if (!data) return false;
  try{
    if(data.affectionUsage?.localDate===burrowLocalDay(now,data.economicTimezone ?? data.profile.timezone_name))
      return data.affectionUsage.used+(data.affectionUsage.pending??0)>=(data.hasPlus?6:1);
  }catch{}
  if(data.hasPlus||!data.lastAffectionAt)return false;
  const sentAt = Date.parse(data.lastAffectionAt);
  if (!Number.isFinite(sentAt) || !Number.isFinite(now)) return false;
  try {
    return burrowLocalDay(sentAt, data.economicTimezone ?? data.profile.timezone_name) === burrowLocalDay(now, data.economicTimezone ?? data.profile.timezone_name);
  } catch { return false; }
}
