import type { MajorUpdateBootstrap } from './app-major-update-api';

const scope = (data: MajorUpdateBootstrap) => `${data.profile.id}:${data.partner?.id ?? ''}:${data.pairVersion ?? ''}`;
/** Reconcile display only: no inventory, discoveries, quests or wallets change.
 * An older read cannot undo arrival or replace a newer dialogue plan. A server
 * cancellation/completion, new journey or changed pairing always wins. */
export function mergeAdventureArrival(previous: MajorUpdateBootstrap | null, next: MajorUpdateBootstrap, now: number): MajorUpdateBootstrap {
  const a = next.activeAdventure;
  if (!a || !['in_progress','result_ready','interaction_required'].includes(a.status)) return next;
  if (a.localStartPending || a.id.startsWith('pending:')) return next;
  const same = previous && scope(previous) === scope(next) && previous.activeAdventure?.id === a.id;
  const oldPlan = same && previous.adventurePlan?.adventureId === a.id ? previous.adventurePlan : null;
  const incoming = next.adventurePlan?.adventureId === a.id ? next.adventurePlan : null;
  const plan = oldPlan && (!incoming || Date.parse(oldPlan.readAt) > Date.parse(incoming.readAt)) ? oldPlan : incoming;
  const wasArrived = same && previous.activeAdventure?.ends_at === a.ends_at
    && ['result_ready','interaction_required'].includes(previous.activeAdventure.status);
  const arrived = a.status !== 'in_progress' || wasArrived || Date.parse(a.ends_at) <= now;
  let result = next.adventureResult;
  // Do not turn a server result/receipt into a pre-arrival synthetic result.
  if (arrived && !result) result = same && previous.adventureResult?.metadata?.encounterV2
    ? previous.adventureResult : plan?.result ?? null;
  // A changed pre-arrival plan (e.g. a visit skipped the Stranger dialogue)
  // supersedes only a synthetic display result, never a committed result.
  if (result?.id.startsWith('plan:') && plan && result.claim_status === 'pending'
    && !result.metadata?.treasureClaimed && !result.metadata?.dialogueCompleted) result = plan.result;
  const status = a.status === 'in_progress' && arrived && result?.metadata?.encounterV2
    ? wasArrived && previous?.activeAdventure?.status === 'interaction_required' ? 'interaction_required' : 'result_ready' : a.status;
  if (plan === next.adventurePlan && result === next.adventureResult && status === a.status) return next;
  return { ...next, adventurePlan: plan, adventureResult: result,
    activeAdventure: status === a.status ? a : { ...a, status } };
}
