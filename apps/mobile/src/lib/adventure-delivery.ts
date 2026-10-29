import { AppState } from 'react-native';
import {readAdventureDeliveryRows,saveAdventureDeliveryRows} from './adventure-delivery-state';
import {adventureJourneyDay,adventureScope} from './adventure-entry-state';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { claimAdventureTreasure, completeFriendInteraction, claimAdventureResult } from './app-major-update-api';
import { getBurrowSnapshot, confirmBurrowAdventureItemLocally, confirmBurrowAdventureInteractionLocally,
  confirmBurrowAdventureClaimLocally, scheduleBurrowRefresh } from './burrow-store';
import { createAdventureDeliveryQueue, type AdventureDelivery } from './adventure-delivery-queue';

const worker = createAdventureDeliveryQueue({
  context: () => { const data = getBurrowSnapshot().data; const owner = sessionUserId();
    return data && owner === data.profile.id ? { owner, scope: `${owner}:${data.partner?.id ?? 'solo'}:${data.pairVersion ?? ''}` } : null; },
  load: () => [...readAdventureDeliveryRows()],
  save: saveAdventureDeliveryRows,
  active: () => AppState.currentState === 'active',
  treasure: claimAdventureTreasure, respond: (id, choiceId) => completeFriendInteraction(id, { choiceId }), claim: claimAdventureResult,
  confirmed: (job, stage, receipt) => {
    if (stage !== 'response') confirmBurrowAdventureItemLocally(job.id, receipt.itemId);
    if (stage === 'treasure') confirmBurrowAdventureInteractionLocally(job.id, true);
    if (stage === 'finish') confirmBurrowAdventureClaimLocally(job.id);
  },
  settled: scheduleBurrowRefresh,
  schedule: (fn, ms) => setTimeout(fn, ms), cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
// Scope clearing on sign-out must also clear this module's in-memory jobs.
subscribeSessionIdentity(() => worker.reset());
export const readAdventureDelivery = (id: string): AdventureDelivery | undefined => worker.get(id);
export const queueAdventureDelivery = (id: string, intent: { treasure?: boolean; choiceId?: string; finish?: boolean;checkpoint?:AdventureDelivery['checkpoint'] }) => {
  const data=getBurrowSnapshot().data;
  if(!data||data.profile.id!==sessionUserId()||data.activeAdventure?.id!==id)return false;
  return worker.enqueue(id,{...intent,journeyDay:adventureJourneyDay(data)});
};
/** A new Start can be journalled now, but cannot race the old final claim. */
export async function finishAdventureDeliveryBeforeStart(){
  const data=getBurrowSnapshot().data;if(!data)return false;
  const scope=adventureScope(data),owner=sessionUserId();
  await worker.resume();
  return readAdventureDeliveryRows().filter(j=>j.owner===owner&&j.scope===scope&&j.finish&&!j.terminal).every(j=>j.finishSaved&&!j.failed);
}
export const resumeAdventureDelivery = () => worker.resume();
export const pauseAdventureDelivery = () => worker.pause();
