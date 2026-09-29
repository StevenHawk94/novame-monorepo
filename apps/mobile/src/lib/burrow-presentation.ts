import { projectedRoomNeed } from '@novame/engine';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from './app-major-update-api';

type Adventure = MajorUpdateBootstrap['activeAdventure'];
export function adventureNeedsCompletion(adventure: Adventure | undefined) {
  return adventure?.status === 'result_ready' || adventure?.status === 'interaction_required';
}
export function adventureHasArrived(adventure: Adventure | undefined, now: number) {
  return adventureNeedsCompletion(adventure) || (adventure?.status === 'in_progress' && Date.parse(adventure.ends_at) <= now);
}
export function adventureIsAway(adventure: Adventure | undefined, now: number) {
  return adventure?.status === 'in_progress' && !adventureHasArrived(adventure, now);
}
export function roomSlots(data: MajorUpdateBootstrap, ownerId: string, shared = false) {
  const slots: Record<string, MajorUpdateCatalogItem> = {};
  data.catalog.filter(item => item.metadata.starter && item.metadata.slot &&
    (shared ? item.item_type === 'our_room' : ['decor', 'outfit'].includes(item.item_type)))
    .forEach(item => { slots[item.metadata.slot!] = item; });
  data.loadouts.filter(row => shared ? row.room_type === 'our' : row.room_type === 'home' && row.owner_id === ownerId)
    .forEach(row => { const item = data.catalog.find(item => item.stable_id === row.item_id); if (item) slots[row.slot] = item; });
  return slots;
}
export function roomNeedDisplay(data: MajorUpdateBootstrap, partner: boolean, now: number) {
  const needs = partner ? data.partnerNeeds : data.roomNeeds;
  return {
    food: projectedRoomNeed(needs.foodValue ?? needs.food, Date.parse(needs.foodValue == null ? data.serverNow : needs.foodUpdatedAt ?? data.serverNow), now),
    water: projectedRoomNeed(needs.waterValue ?? needs.water, Date.parse(needs.waterValue == null ? data.serverNow : needs.waterUpdatedAt ?? data.serverNow), now),
  };
}

/** Resume intent survives forms/modals, but a foreground finish never creates
 * an intent. Kept separate from React so ordering/race rules are testable. */
export function createAdventureArrival() {
  let waiting = true;
  let baseline: MajorUpdateBootstrap | null = null;
  let candidate: string | null = null;
  return {
    resume(current: MajorUpdateBootstrap | null) { waiting = true; baseline = current; candidate = null; },
    reset() { waiting = true; baseline = null; candidate = null; },
    observe(data: MajorUpdateBootstrap | null, fresh: boolean) {
      if (!fresh || !data) return;
      if (waiting && data !== baseline) {
        candidate = adventureNeedsCompletion(data.activeAdventure) ? data.activeAdventure!.id : null;
        waiting = false;
      }
      if (candidate && (data.activeAdventure?.id !== candidate || !adventureNeedsCompletion(data.activeAdventure))) candidate = null;
    },
    take(safe: boolean, alreadyOnAdventure: boolean) {
      if (alreadyOnAdventure) { candidate = null; return null; }
      if (!safe) return null;
      const id = candidate; candidate = null; return id;
    },
  };
}
