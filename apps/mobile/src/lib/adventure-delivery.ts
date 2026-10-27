import { AppState } from 'react-native';
import { storage } from './storage';
import { kAdventureDelivery } from '../shared/storage/keys';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { claimAdventureTreasure, completeFriendInteraction, claimAdventureResult } from './app-major-update-api';
import { getBurrowSnapshot, confirmBurrowAdventureItemLocally, confirmBurrowAdventureInteractionLocally,
  confirmBurrowAdventureClaimLocally, scheduleBurrowRefresh } from './burrow-store';
import { createAdventureDeliveryQueue, type AdventureDelivery } from './adventure-delivery-queue';

const worker = createAdventureDeliveryQueue({
  context: () => { const data = getBurrowSnapshot().data; const owner = sessionUserId();
    return data && owner === data.profile.id ? { owner, scope: `${owner}:${data.partner?.id ?? 'solo'}:${data.pairVersion ?? ''}` } : null; },
  load: () => { try { const rows = JSON.parse(storage.getString(kAdventureDelivery.name) ?? '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; } },
  save: rows => { storage.set(kAdventureDelivery.name, JSON.stringify(rows)); },
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
export const queueAdventureDelivery = (id: string, intent: { treasure?: boolean; choiceId?: string; finish?: boolean }) => worker.enqueue(id, intent);
export const resumeAdventureDelivery = () => worker.resume();
export const pauseAdventureDelivery = () => worker.pause();
