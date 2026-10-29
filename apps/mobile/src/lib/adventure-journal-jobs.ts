import { useSyncExternalStore } from 'react';
import { adventureDurationMs } from './adventure-duration';
import {BUNDLED_SHOP_RELEASE} from './generated/shop-catalog-version';
import type {AdventureTeam} from './cooperative-adventure';
import {previewAdventureJoin} from './cooperative-adventure';
import {preparedAdventureTeam} from './adventure-team-prefetch';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { storage } from './storage';
import { kAdventureJournalJobs } from '../shared/storage/keys';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { prepareReflect, finalizeReflect, type PreparedReflect, type ReflectSnapshot } from './reflect-api';
import { holdReflectSettlement, releaseReflectSettlement } from './reflect-settlement-outbox';
import { startAdventure, type AdventureDisplay } from './app-major-update-api';
import { burrowClock, getBurrowSnapshot, refreshBurrowAfterCurrent, projectAdventureJournalLocally, cacheAdventureDisplay } from './burrow-store';
import { removeBurrowTextDraft } from './burrow-text-drafts';
import { stageCoinOperationReward, cancelStagedCoinOperationReward } from './coin-command-outbox';
import { releaseCoinReward } from './coin-reward-store';
import { captureQuestFact, questProgress } from './quest-progress-store';
import type { QuestIntent } from './quest-progress-model';
import {adventureDay} from './adventure-entry-state';
import {finishAdventureDeliveryBeforeStart} from './adventure-delivery';

type Input = Parameters<typeof prepareReflect>[0];
export type AdventureJournalJob = {
  id: string; owner: string; scope: string; localDate: string; input: Input;
  draftScope?: string; draftTarget?: string; draftKey?: string;
  draft?: PreparedReflect; snapshot?: ReflectSnapshot; confirmedRecordId?: string;
  startPlan?:{version:5;catalogRelease:string;partnerId:string|null;pairVersion:string|null};
  startKey: string; startedAt?: string; previewEndsAt?: string; previewTeam?:AdventureTeam; receipt?: { id: string; endsAt: string; display?: AdventureDisplay;team?:AdventureTeam };
  error?: string; blocked?: boolean;
  rewardPresented?: boolean;
  quest?: QuestIntent;
};
let jobs: AdventureJournalJob[] = [];
let loadedOwner: string | null = null, version = 0, generation = 0;
let flight: Promise<void> | null = null, timer: ReturnType<typeof setTimeout> | undefined, retries = 0;
const listeners = new Set<() => void>();
const recordRewardId=(id:string)=>`record:journal:${id}`;
function stageRecordReward(job:AdventureJournalJob){
  try{stageCoinOperationReward(recordRewardId(job.id),`record-first:${job.localDate}`,10,!!job.rewardPresented);}
  catch{/* Presentation must never turn a committed journal into a failed Save. */}
}
const notify = () => { version++; listeners.forEach(fn => fn()); };
function context() {
  const owner = sessionUserId(), data = getBurrowSnapshot().data;
  return data && owner === data.profile.id ? { owner, data,
    scope: `${owner}:${data.partner?.id ?? 'solo'}:${data.pairVersion ?? ''}` } : null;
}
function load() {
  const owner = sessionUserId() ?? null;
  if (loadedOwner === owner) return;
  loadedOwner = owner; jobs = [];
  try {
    const rows = JSON.parse(storage.getString(kAdventureJournalJobs.name) ?? '[]');
    if (Array.isArray(rows)) jobs = rows.filter(j => j?.owner === owner && typeof j.id === 'string'
      && typeof j.scope === 'string' && typeof j.startKey === 'string' && typeof j.input?.body === 'string');
  } catch { /* Invalid data is never submitted. */ }
}
function update(id: string, patch: Partial<AdventureJournalJob>) {
  const next = jobs.map(j => j.id === id ? { ...j, ...patch } : j);
  storage.set(kAdventureJournalJobs.name, JSON.stringify(next)); // Commit before acknowledgement.
  jobs = next; notify();
}
export function readAdventureJournalJob(id?: string) {
  load(); const ctx = context();
  return ctx ? [...jobs].reverse().find(j => j.scope === ctx.scope && (id ? j.id === id
    : !!j.startedAt && (!j.receipt || j.receipt.id === ctx.data.activeAdventure?.id))) : undefined;
}
export function useAdventureJournalJob(id?: string) {
  useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version, () => version);
  return readAdventureJournalJob(id);
}
function project(job: AdventureJournalJob) {
  if(job.quest)questProgress.fact(`journal:${job.id}`,job.quest,
    job.snapshot?.adventureRecordRegistered||job.confirmedRecordId?'confirmed':job.blocked?'rejected':'pending');
  projectAdventureJournalLocally({ owner: job.owner, scope: job.scope, localDate: job.localDate,
    recordId: job.snapshot?.reflectId ?? job.confirmedRecordId ?? `pending:${job.id}`, startedAt: job.startedAt,
    adventureId: job.receipt?.id, endsAt: job.receipt?.endsAt ?? job.previewEndsAt, error: job.error,team:job.receipt?job.receipt.team:job.previewTeam });
  if (job.receipt?.display) cacheAdventureDisplay(job.receipt.display);
}
/** Save is a synchronous local commit. No server promise belongs to a button. */
export function queueAdventureJournal(input: Input, draft?: { scope: string; target: string; key: string }) {
  load(); const ctx = context();
  if (!ctx) throw Error('session_changed');
  const id = input.idempotencyKey ?? randomUUID();
  const localDate=adventureDay(ctx.data,Date.parse(ctx.data.serverNow)+Math.max(0,burrowClock()-getBurrowSnapshot().receivedAt));
  const captured=captureQuestFact('write_adventure_record');
  const quest=captured&&captured.day!==localDate?{...captured,day:localDate,assignmentId:undefined}:captured;
  const previous = jobs.find(j => j.id === id && j.scope === ctx.scope);
  if (previous) return previous.id;
  // Only one unfinished day can own the Adventure entry point.
  const pending = jobs.find(j => j.scope === ctx.scope && j.localDate === localDate && !j.receipt && !j.blocked);
  if (pending) return pending.id;
  const job: AdventureJournalJob = { id, owner: ctx.owner, scope: ctx.scope, localDate,
    quest,
    input: { ...input, idempotencyKey: id, localDate }, startKey: randomUUID(),startPlan:{version:5,catalogRelease:BUNDLED_SHOP_RELEASE,partnerId:ctx.data.partner?.id??null,pairVersion:ctx.data.pairVersion??null},
    draftScope: draft?.scope, draftTarget: draft?.target, draftKey: draft?.key };
  const next = [...jobs, job].slice(-30);
  storage.set(kAdventureJournalJobs.name, JSON.stringify(next));
  jobs = next; stageRecordReward(job); project(job); notify(); void resumeAdventureJournalJobs();
  return id;
}
/** Called by the visible logged heading, never by confetti or a server timer. */
export function presentAdventureJournalReward(id:string){
  const job=readAdventureJournalJob(id);if(!job||job.rewardPresented||job.blocked)return;
  try{update(id,{rewardPresented:true});}catch{/* The committed journal and in-memory reward still dedupe this run. */}
  releaseCoinReward(recordRewardId(id));
}
export function requestAdventureJournalStart(id: string) {
  const job = readAdventureJournalJob(id); if (!job) return false;
  const snap = getBurrowSnapshot();
  const hint=preparedAdventureTeam();
  const now = hint?.now??(Date.parse(snap.data!.serverNow) + Math.max(0, burrowClock() - snap.receivedAt));
  const startedAt = job.startedAt ?? new Date(now).toISOString();
  const previewTeam=job.startedAt?job.previewTeam:job.startPlan?.version===5?previewAdventureJoin(hint?.state,{
    userId:job.owner,partnerId:job.startPlan.partnerId,pairVersion:job.startPlan.pairVersion},now):undefined;
  update(id, { startedAt, previewTeam,previewEndsAt: job.previewEndsAt ?? previewTeam?.endsAt
    ?? new Date(Date.parse(startedAt) + adventureDurationMs(!!snap.data?.hasPlus)).toISOString(), blocked: false, error: undefined });
  project(readAdventureJournalJob(id)!); void resumeAdventureJournalJobs(); return true;
}
/** Saved-day entry can be reopened before its background upload has finished. */
export function startPendingAdventureJournal(recordId: string) {
  load(); const ctx = context();
  const job = ctx && jobs.find(j => j.scope === ctx.scope && (j.snapshot?.reflectId === recordId || j.confirmedRecordId === recordId || `pending:${j.id}` === recordId));
  if (job) return requestAdventureJournalStart(job.id);
  if (!ctx || ctx.data.readyRecordId !== recordId || recordId.startsWith('pending:')) return false;
  const id = randomUUID();
  const localDate=adventureDay(ctx.data,Date.parse(ctx.data.serverNow)+Math.max(0,burrowClock()-getBurrowSnapshot().receivedAt));
  const next = [...jobs, { id, owner: ctx.owner, scope: ctx.scope, localDate,
    input: { promptId: 9, body: '', mode: 'typing' as const }, confirmedRecordId: recordId, startKey: randomUUID(),startPlan:{version:5 as const,catalogRelease:BUNDLED_SHOP_RELEASE,partnerId:ctx.data.partner?.id??null,pairVersion:ctx.data.pairVersion??null} }];
  storage.set(kAdventureJournalJobs.name, JSON.stringify(next)); jobs = next;
  return requestAdventureJournalStart(id);
}
export function retryAdventureJournalJob(id: string) {
  if (!readAdventureJournalJob(id)) return;
  update(id, { error: undefined, blocked: false }); void resumeAdventureJournalJobs();
}
const active = () => AppState.currentState === 'active';
export function pauseAdventureJournalJobs() { clearTimeout(timer); timer = undefined; }
export function resumeAdventureJournalJobs(): Promise<void> {
  load(); pauseAdventureJournalJobs();
  const ctx=context();
  if(ctx)for(const job of jobs)if(job.owner===ctx.owner&&job.scope!==ctx.scope)
    cancelStagedCoinOperationReward(recordRewardId(job.id));
  if (flight) return flight;
  if (!active() || !context()) return Promise.resolve();
  const own = generation;
  const task = drain(own).finally(() => {
    if (flight === task) flight = null;
    if (own !== generation && active()) void resumeAdventureJournalJobs();
    else if (!timer && active() && jobs.some(j => j.scope === context()?.scope && !j.blocked
      && ((!j.snapshot && !j.confirmedRecordId) || (j.startedAt && !j.receipt))))
      timer = setTimeout(() => { timer = undefined; void resumeAdventureJournalJobs(); }, 0);
  });
  flight = task; return task;
}
async function drain(own: number) {
  const current = (job: AdventureJournalJob) => own === generation && job.scope === context()?.scope && job.owner === sessionUserId();
  while (active() && own === generation) {
    const ctx = context(); if (!ctx) return;
    const job = jobs.find(j => j.scope === ctx.scope && !j.blocked && ((!j.snapshot && !j.confirmedRecordId) || (j.startedAt && !j.receipt)));
    if (!job) return;
    let held: string | undefined;
    try {
      if(!job.snapshot&&!job.confirmedRecordId)stageRecordReward(job);
      if (!job.draft && !job.confirmedRecordId) {
        if (job.localDate !== adventureDay(ctx.data,Date.parse(ctx.data.serverNow)+Math.max(0,burrowClock()-getBurrowSnapshot().receivedAt))) throw Error('day_changed');
        const prepared = await prepareReflect(job.input);
        if (prepared.ok) held = prepared.draft.draftId;
        if (!current(job)) return;
        if (!prepared.ok) throw Error(prepared.error);
        update(job.id, { draft: prepared.draft, error: undefined });
      }
      let latest = readAdventureJournalJob(job.id)!;
      if (!latest.snapshot && !latest.confirmedRecordId) {
        held = latest.draft!.draftId; holdReflectSettlement(held);
        const memories = latest.draft!.matchedItems.map(item => ({ itemId: item.itemId,
          text: item.label || item.displayName, source: 'manual' as const, visible: true, edited: true }));
        const result = await finalizeReflect(latest.draft!, memories, {operationId:recordRewardId(job.id),deferred:true});
        if (!current(job)) return;
        if (!result.ok) throw Error(result.error);
        update(job.id, { snapshot: result.snapshot, error: undefined });
        if (latest.draftScope && latest.draftTarget && latest.draftKey)
          removeBurrowTextDraft(latest.draftScope, latest.draftTarget, latest.draftKey);
        project(readAdventureJournalJob(job.id)!);
        void refreshBurrowAfterCurrent({ silent: true, after: burrowClock() });
      }
      latest = readAdventureJournalJob(job.id)!;
      if (latest.startedAt && !latest.receipt) {
        // An older API interprets unknown encounter versions as v1. Never let
        // a new durable intent fall through during rollout/rollback: require
        // the authenticated server's opt-in snapshot before sending it.
        const latestData=context()?.data,capability=preparedAdventureTeam()?.state??latestData?.adventureTeam;
        if(latest.startPlan?.version===5&&(!capability||capability.userId!==job.owner
          ||(capability.partnerId??null)!==(latestData?.partner?.id??null)
          ||(capability.pairVersion??null)!==(latestData?.pairVersion??null))){
          void refreshBurrowAfterCurrent({silent:true,after:burrowClock()});
          throw Error('adventure_protocol_unavailable');
        }
        if(!await finishAdventureDeliveryBeforeStart())throw Error('adventure_delivery_pending');
        if(!current(job))return;
        const receipt = await startAdventure(latest.snapshot?.reflectId ?? latest.confirmedRecordId!, latest.startKey,latest.startPlan??{version:4});
        if (!current(job)) return;
        if (typeof receipt.adventureId !== 'string' || typeof receipt.endsAt !== 'string') throw Error('network');
        // Persist this small frozen plan with the start receipt before painting;
        // a crash needn't wait for the large Home snapshot's idle serialization.
        update(job.id, { receipt: { id: receipt.adventureId, endsAt: receipt.endsAt, display: receipt.adventureDisplay,team:receipt.team }, error: undefined });
        project(readAdventureJournalJob(job.id)!);
        void refreshBurrowAfterCurrent({ silent: true, after: burrowClock() });
      }
      retries = 0;
    } catch (error) {
      if (!current(job)) return;
      const body = error && typeof error === 'object' && 'body' in error ? error.body : null;
      const code = body && typeof body === 'object' && 'error' in body ? String(body.error)
        : error instanceof Error ? error.message : 'network';
      const blocked = ['daily_adventure_used','adventure_pending','record_required','selection_unavailable',
        'journal_kind_used','daily_limit','plus_required','pair_changed','feature_disabled','local_date_mismatch','day_changed'].includes(code);
      if(blocked&&!readAdventureJournalJob(job.id)?.snapshot)cancelStagedCoinOperationReward(recordRewardId(job.id));
      try { update(job.id, { error: code, blocked }); project(readAdventureJournalJob(job.id)!); } catch { /* Previously committed words remain recoverable. */ }
      if(blocked)void refreshBurrowAfterCurrent({silent:true,after:burrowClock()});
      if (!blocked && active()) timer = setTimeout(() => { timer = undefined; void resumeAdventureJournalJobs(); }, Math.min(60_000, 2_000 * 2 ** Math.min(retries++, 5)));
      return;
    } finally { if (held) releaseReflectSettlement(held); }
  }
}
/** Restore intent after process death; stale reads never send the user back to the input page. */
export function restoreAdventureJournalProjection() {
  load(); const ctx = context(); if (!ctx) return;
  const job = [...jobs].reverse().find(j => j.scope === ctx.scope && (!j.receipt || j.receipt.id === ctx.data.activeAdventure?.id
    || (ctx.data.activeAdventure?.id.startsWith('pending:') && j.localDate === ctx.data.localDate)));
  if (job && (!job.receipt || ctx.data.activeAdventure?.status === 'in_progress')) project(job);
}
subscribeSessionIdentity(() => {
  generation++; pauseAdventureJournalJobs(); jobs = []; loadedOwner = null; retries = 0; notify();
});
