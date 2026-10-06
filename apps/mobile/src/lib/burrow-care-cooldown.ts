import type { MajorUpdateBootstrap } from './app-major-update-api';

export const CARE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const justCompleted = new Map<string, number>();

export function careCooldownMessage(need: 'food' | 'water') {
  return need === 'food' ? 'Your bunny is happy now.' : 'Your flower is happy now.';
}

export function markCareCompleted(ownerId: string, need: 'food' | 'water', at = Date.now()) {
  justCompleted.set(`${ownerId}:${need}`, at);
}

export function careCoolingDown(data: MajorUpdateBootstrap, need: 'food' | 'water', now = Date.now()) {
  const ownerId = data.profile.id;
  const authoritative = Date.parse(data.lastCareAt?.[need] ?? '') || 0;
  const recent = data.moments.filter(event => event.event_type === 'room_need_refilled'
    && event.target_id === ownerId && event.payload?.need === need)
    .reduce((latest, event) => Math.max(latest, Date.parse(event.created_at) || 0), 0);
  return now - Math.max(authoritative, recent, justCompleted.get(`${ownerId}:${need}`) ?? 0) < CARE_COOLDOWN_MS;
}
