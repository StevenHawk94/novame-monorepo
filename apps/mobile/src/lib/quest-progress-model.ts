import type { MajorUpdateBootstrap, MajorUpdateQuest } from './app-major-update-api';

export type QuestScope = { scope: string; day: string };
export type QuestIntent = QuestScope & { questId: string; assignmentId?: string; verified?: boolean; stage?: number };
type Status = 'pending' | 'confirmed' | 'rejected';
type Fact = QuestIntent & { id: string; status: Status };
type Claim = QuestIntent & { id: string; status: Status };
export const questScope = (data: MajorUpdateBootstrap): QuestScope => ({
  scope: `${data.profile.id}:${data.partner?.id ?? 'solo'}:${data.pairVersion ?? ''}`, day: data.localDate,
});
const same = (a: QuestScope, b: QuestScope) => a.scope === b.scope && a.day === b.day;
const done = (q: MajorUpdateQuest) => !!q.completedAt || q.progress >= q.target;

/** Display-only facts. Neither these records nor the predicted coins authorize
 * a grant: the existing server commands still validate every claim. */
export function createQuestProgress(deps: { load: () => unknown; save: (value: unknown) => void; changed: () => void }) {
  const facts = new Map<string, Fact>(), claims = new Map<string, Claim>();
  const originals = new WeakMap<object, MajorUpdateQuest>();
  const specialOriginals = new WeakMap<object, MajorUpdateBootstrap['specialQuests'][number]>();
  function reload(owner?:string|null) {
    facts.clear(); claims.clear();
    try {
      const disk = deps.load() as { facts?: Fact[]; claims?: Claim[] };
      const valid = (r: Fact) => r && typeof r.id === 'string' && typeof r.scope === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && typeof r.questId === 'string'
        && ['pending','confirmed','rejected'].includes(r.status)
        && (r.assignmentId===undefined||typeof r.assignmentId==='string')
        && (r.verified===undefined||typeof r.verified==='boolean')
        && (r.stage===undefined||Number.isSafeInteger(r.stage)&&r.stage>0);
      const owned=(r:Fact)=>valid(r)&&(owner===undefined||!!owner&&r.scope.startsWith(`${owner}:`));
      for (const r of Array.isArray(disk?.facts)?disk.facts:[]) if (owned(r)) facts.set(`${r.scope}:${r.day}:${r.id}`, r);
      for (const r of Array.isArray(disk?.claims)?disk.claims:[]) if (owned(r)) claims.set(`${r.scope}:${r.id}`, r);
    } catch { /* A corrupt projection cannot manufacture a reward. */ }
  }
  reload();
  function save() {
    // Keep unsettled dependencies across midnight/relaunch. Confirmed display
    // checkpoints are bounded; primary outboxes own actual retry payloads.
    const trim = <T extends Fact>(rows: Map<string,T>) => {
      const old = [...rows.entries()].filter(([,r]) => r.status !== 'pending'
        &&![...claims.values()].some(c=>c.status==='pending'&&same(c,r)&&c.questId===r.questId));
      for (const [key] of old.slice(0, Math.max(0, old.length - 120))) rows.delete(key);
    };
    trim(facts); trim(claims);
    // Projection persistence is supplementary. A full disk must not turn a
    // committed monetary receipt into an ambiguous failure/replayed credit.
    try { deps.save({ facts: [...facts.values()], claims: [...claims.values()] }); } catch {}
    deps.changed();
  }
  function fact(id: string, intent: QuestIntent, status: Status) {
    const key = `${intent.scope}:${intent.day}:${id}`, old = facts.get(key);
    // Restoring an outbox must not downgrade an already confirmed receipt.
    if (old?.status === status || (status === 'pending' && old)) return;
    facts.set(key, { ...intent, id, status }); save();
  }
  /** Retire only an unconfirmed display witness from an old protocol. Never
   * revoke a confirmed pre-upgrade receipt or its already-earned quest. */
  function rejectPendingFact(id:string,intent:QuestIntent){
    const old=facts.get(`${intent.scope}:${intent.day}:${id}`);
    if(old&&old.status!=='confirmed')fact(id,intent,'rejected');
  }
  function claim(id: string, intent: QuestIntent, status: Status) {
    const key = `${intent.scope}:${id}`, old = claims.get(key);
    if (old?.status === status || (status === 'pending' && old?.status === 'confirmed')) return;
    claims.set(key, { ...intent, id, status });
    if (status === 'rejected' && intent.assignmentId) {
      // A definitive server rejection invalidates the speculative completion;
      // a subsequent real action can create a new independently keyed fact.
      for (const [key, row] of facts) if (same(row,intent) && row.questId === intent.questId)
        facts.set(key,{...row,status:'rejected'});
    }
    save();
  }
  function capture(data: MajorUpdateBootstrap, questId: string): QuestIntent {
    const q = data.quests.quests.find(q => q.questId === questId);
    return { ...questScope(data), questId, ...(q ? { assignmentId: q.assignmentId } : {}) };
  }
  function captureClaim(data: MajorUpdateBootstrap, assignmentId: string): QuestIntent {
    const shown = data.quests.quests.find(q => q.assignmentId === assignmentId);
    if (!shown || assignmentId.startsWith('pending:') || !done(shown)) throw Error('not_completed');
    const base = originals.get(shown) ?? shown;
    return { ...capture(data,shown.questId), assignmentId, verified: done(base) };
  }
  function observe(data: MajorUpdateBootstrap) {
    const ctx=questScope(data);let changed=false;
    // Call only with an authoritative read, never a projected UI snapshot.
    for(const [key,r] of facts)if(same(r,ctx)&&r.status!=='confirmed'
      &&data.quests.quests.some(q=>q.questId===r.questId&&done(q))){
      facts.set(key,{...r,status:'confirmed'});changed=true;
    }
    for(const [key,r] of claims)if(r.scope===ctx.scope&&r.status!=='confirmed'
      &&(r.stage!==undefined?data.specialQuests.some(q=>q.questId===r.questId&&q.stage>r.stage!)
        :same(r,ctx)&&data.quests.quests.some(q=>q.assignmentId===r.assignmentId&&q.claimedAt))){
      // Another device may have settled a previously rejected/unknown claim.
      // Its authoritative stage must release subsequent milestone claims.
      claims.set(key,{...r,status:'confirmed'});changed=true;
    }
    if(changed)save();
  }
  function guard(intent: QuestIntent, current: QuestScope | null) {
    if (!current) throw Error('quest_sync_pending');
    if (current.scope !== intent.scope) throw Error('pair_changed');
    if(intent.stage!==undefined){
      const earlier=[...claims.values()].filter(r=>r.scope===intent.scope&&r.questId===intent.questId
        &&r.stage!==undefined&&r.stage<intent.stage!);
      if(earlier.some(r=>r.status==='rejected'))throw Error('not_completed');
      if(earlier.some(r=>r.status==='pending'))throw Error('quest_sync_pending');
    }
    if (intent.verified || !intent.assignmentId) return;
    const matching = [...facts.values()].filter(r => same(r,intent) && r.questId === intent.questId);
    if (matching.some(r => r.status === 'confirmed')) return;
    if (matching.some(r => r.status === 'pending')) throw Error('quest_sync_pending');
    throw Error('not_completed');
  }
  function project(data: MajorUpdateBootstrap): MajorUpdateBootstrap {
    const ctx = questScope(data);
    let changed = false;
    const quests = data.quests.quests.map(shown => {
      const base = originals.get(shown) ?? shown;
      const active = [...facts.values()].some(r => same(r,ctx) && r.questId === base.questId && r.status !== 'rejected');
      const claimed = [...claims.values()].some(r => same(r,ctx) && r.assignmentId === base.assignmentId && r.status !== 'rejected');
      const next = active || claimed ? { ...base,
        ...(active ? { progress: Math.max(base.progress,base.target), completedAt: base.completedAt ?? `${ctx.day}T12:00:00Z` } : {}),
        ...(claimed ? { claimedAt: base.claimedAt ?? `${ctx.day}T12:00:00Z` } : {}) } : base;
      if(next.progress===shown.progress&&next.completedAt===shown.completedAt&&next.claimedAt===shown.claimedAt)return shown;
      if (next !== base) originals.set(next,base);
      if (next !== shown) changed = true;
      return next;
    });
    const specialQuests = data.specialQuests.map(shown => {
      const base = specialOriginals.get(shown) ?? shown;
      const stages = [...claims.values()].filter(r => r.scope === ctx.scope && r.questId === base.questId
        && r.stage !== undefined && r.status !== 'rejected').map(r => r.stage!);
      const stage = Math.max(base.stage, ...stages.map(n => n + 1));
      const next = stage > base.stage ? { ...base, stage, target: base.target / base.stage * stage } : base;
      if(next.stage===shown.stage&&next.target===shown.target)return shown;
      if (next !== base) specialOriginals.set(next,base);
      if (next !== shown) changed = true;
      return next;
    });
    return changed ? { ...data, quests: { ...data.quests, quests }, specialQuests } : data;
  }
  const unproject = (data: MajorUpdateBootstrap): MajorUpdateBootstrap => ({...data,
    quests:{...data.quests,quests:data.quests.quests.map(q=>originals.get(q)??q)},
    specialQuests:data.specialQuests.map(q=>specialOriginals.get(q)??q)});
  return { fact, rejectPendingFact, claim, capture, captureClaim, guard, project, unproject, observe,
    reload:(owner:string|null)=>{reload(owner);deps.changed();},
    reset: () => { facts.clear(); claims.clear(); deps.changed(); } };
}
