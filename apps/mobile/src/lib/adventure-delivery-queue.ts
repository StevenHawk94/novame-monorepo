export type AdventureDelivery = {
  owner: string; scope: string; id: string; treasure: boolean; choiceId?: string; finish: boolean;
  treasureSaved: boolean; responseSaved: boolean; failed?: boolean;
};
type Receipt = { itemId?: string | null; interactionRequired?: boolean };
/** UI records intent synchronously. Only this durable, ordered worker writes
 * treasure -> frozen choice -> final gift. Receipts, never taps, award items. */
export function createAdventureDeliveryQueue(deps: {
  context: () => { owner: string; scope: string } | null;
  load: () => AdventureDelivery[]; save: (jobs: AdventureDelivery[]) => void;
  active: () => boolean;
  treasure: (id: string) => Promise<Receipt>;
  respond: (id: string, choiceId: string) => Promise<unknown>;
  claim: (id: string) => Promise<Receipt>;
  confirmed: (job: AdventureDelivery, stage: 'treasure' | 'response' | 'finish', receipt: Receipt) => void;
  settled: () => void;
  schedule: (fn: () => void, ms: number) => unknown; cancel: (timer: unknown) => void;
}) {
  const jobs = new Map<string, AdventureDelivery>();
  for (const job of deps.load()) if (job && typeof job.id === 'string' && typeof job.owner === 'string'
    && typeof job.scope === 'string' && typeof job.treasure === 'boolean' && typeof job.finish === 'boolean'
    && typeof job.treasureSaved === 'boolean' && typeof job.responseSaved === 'boolean'
    && (job.choiceId === undefined || typeof job.choiceId === 'string')) jobs.set(`${job.scope}:${job.id}`, job);
  let flight: Promise<void> | null = null, timer: unknown, attempts = 0, generation = 0;
  const persist = () => deps.save([...jobs.values()]);
  function update(key: string, next?: AdventureDelivery) {
    const previous = jobs.get(key);
    if (next) jobs.set(key, next); else jobs.delete(key);
    try { persist(); } catch (error) {
      if (previous) jobs.set(key, previous); else jobs.delete(key);
      throw error;
    }
  }
  const current = (job: AdventureDelivery) => {
    const ctx = deps.context(); return ctx?.owner === job.owner && ctx.scope === job.scope;
  };
  function get(id: string) { const ctx = deps.context(); return ctx ? jobs.get(`${ctx.scope}:${id}`) : undefined; }
  function enqueue(id: string, intent: { treasure?: boolean; choiceId?: string; finish?: boolean }) {
    const ctx = deps.context(); if (!ctx) return false;
    const previous = get(id);
    const job: AdventureDelivery = { owner: ctx.owner, scope: ctx.scope, id,
      treasure: false, finish: false, treasureSaved: false, responseSaved: false, ...previous,
      ...intent, ...(previous?.choiceId ? { choiceId: previous.choiceId } : {}), failed: false };
    try { update(`${ctx.scope}:${id}`, job); } catch { return false; }
    void resume(); return true;
  }
  function resume(): Promise<void> {
    if (timer !== undefined) { deps.cancel(timer); timer = undefined; }
    if (flight) return flight;
    if (!deps.active() || !deps.context()) return Promise.resolve();
    const started = deps.context();
    const startedGeneration = generation;
    const task = drain().finally(() => {
      if (flight === task) flight = null;
      const now = deps.context();
      // A new account/pair may have queued while the old request was in flight.
      if (now && (generation !== startedGeneration || now.owner !== started?.owner || now.scope !== started?.scope)) void resume();
    });
    flight = task; return task;
  }
  async function drain() {
    const startedGeneration = generation;
    while (deps.active()) {
      const job = [...jobs.values()].find(j => current(j) && !j.failed
        && ((j.treasure && !j.treasureSaved) || (j.choiceId && !j.responseSaved) || j.finish));
      if (!job) return;
      const key = `${job.scope}:${job.id}`;
      const stage = job.treasure && !job.treasureSaved ? 'treasure' : job.choiceId && !job.responseSaved ? 'response' : 'finish';
      try {
        const receipt = stage === 'treasure' ? await deps.treasure(job.id)
          : stage === 'response' ? await deps.respond(job.id, job.choiceId!) as Receipt : await deps.claim(job.id);
        if (generation !== startedGeneration || !current(job)) return;
        if (stage === 'finish' && receipt.interactionRequired) throw Error('interaction_required');
        const latest = jobs.get(key)!;
        update(key, stage === 'finish' ? undefined : { ...latest, ...(stage === 'treasure' ? { treasureSaved: true } : { responseSaved: true }) });
        deps.confirmed(job, stage, receipt);
        if (stage === 'finish') deps.settled();
        attempts = 0;
      } catch (error) {
        if (generation !== startedGeneration || !current(job)) return;
        const body = error && typeof error === 'object' && 'body' in error ? error.body : null;
        const code = body && typeof body === 'object' && 'error' in body ? String(body.error)
          : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
        if (['adventure_cancelled','pair_changed','not_found','session_changed'].includes(code)) {
          try { update(key); deps.settled(); return; } catch { /* keep durable intent */ }
        }
        if (['invalid_response','interaction_required','treasure_required','feature_disabled'].includes(code)) {
          try { update(key, { ...jobs.get(key)!, failed: true }); deps.settled(); return; } catch { /* keep durable intent */ }
        }
        // An ambiguous network failure may have committed: replay the same ID.
        if (deps.active()) timer = deps.schedule(() => { timer = undefined; void resume(); }, Math.min(60_000, 2_000 * 2 ** Math.min(attempts++, 5)));
        return;
      }
    }
  }
  function pause() { if (timer !== undefined) deps.cancel(timer); timer = undefined; }
  return { get, enqueue, resume, pause, reset() { generation++; pause(); jobs.clear(); attempts = 0; } };
}
