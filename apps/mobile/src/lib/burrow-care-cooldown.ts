import type { MajorUpdateBootstrap } from './app-major-update-api';
import {currentRoomCare,roomCareAction} from './room-care-model';
import type {RoomCareAction} from '@novame/domain';

export const CARE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const justCompleted = new Map<string, number>();
const pending = new Map<string, object>();
let v2Pending: (data:MajorUpdateBootstrap,owner:string,action:RoomCareAction)=>boolean=()=>false;
export function configureCarePending(reader:typeof v2Pending){v2Pending=reader;}
const submissionScope = (data: MajorUpdateBootstrap, ownerId: string, need: 'food' | 'water') =>
  `${data.profile.id}:${data.partner?.id ?? ''}:${data.pairVersion ?? ''}:${ownerId}:${need}`;

/** Reserve before showing completion, including after the interaction unmounts.
 * A failed request releases the reservation; it never creates a fake cooldown. */
export function beginCareSubmission(data: MajorUpdateBootstrap, need: 'food' | 'water', ownerId = data.profile.id) {
  const key = submissionScope(data, ownerId, need), token = {};
  pending.set(key, token);
  return () => { if (pending.get(key) === token) pending.delete(key); };
}

export function careCooldownMessage(need: 'food' | 'water', partnerName?: string) {
  const owner=partnerName?.trim()?`${partnerName.trim()}'s`:'Your';
  return need === 'food' ? `${owner} bunny is full and happy.` : `${owner} flower is fresh and growing.`;
}

export function markCareCompleted(ownerId: string, need: 'food' | 'water', at = Date.now()) {
  justCompleted.set(`${ownerId}:${need}`, at);
}

/** Shared entry/completion gate: full, saving, or inside the care cooldown. */
export function careCoolingDown(data: MajorUpdateBootstrap, need: 'food' | 'water', now = Date.now(), ownerId = data.profile.id) {
  if (pending.has(submissionScope(data, ownerId, need))) return true;
  const care=currentRoomCare(data);
  if(care){
    const action=roomCareAction(need,ownerId!==data.profile.id);
    const status=(ownerId===data.profile.id?care.own:care.partner)?.[action];
    return !status||v2Pending(data,ownerId,action)||now<(Date.parse(status.nextAt??'')||0);
  }
  const needs = ownerId === data.profile.id ? data.roomNeeds : data.partnerNeeds;
  if (needs) {
    const stored = need === 'food' ? needs.foodValue : needs.waterValue;
    const value = stored ?? needs[need];
    const capturedAt = ownerId === data.profile.id ? data.roomNeeds.serverNow ?? data.serverNow : data.serverNow;
    const updated = Date.parse(stored == null ? capturedAt :
      (need === 'food' ? needs.foodUpdatedAt : needs.waterUpdatedAt) ?? capturedAt);
    // Same five-minute integer decay as the server, including initial full
    // rooms that have no refill event / lastCareAt timestamp yet.
    const elapsed = Number.isFinite(updated) ? Math.max(0, now - updated) : 0;
    if (value - Math.floor(elapsed / 300_000) >= 100) return true;
  }
  const authoritative = Date.parse((ownerId === data.profile.id ? data.lastCareAt : data.partnerLastCareAt)?.[need] ?? '') || 0;
  const recent = data.moments.filter(event => event.event_type === 'room_need_refilled'
    && event.target_id === ownerId && event.payload?.need === need)
    .reduce((latest, event) => Math.max(latest, Date.parse(event.created_at) || 0), 0);
  return now - Math.max(authoritative, recent, justCompleted.get(`${ownerId}:${need}`) ?? 0) < CARE_COOLDOWN_MS;
}
