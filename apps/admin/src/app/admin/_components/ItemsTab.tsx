'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
import ItemPublisher from './ItemPublisher';
import ItemRuleEditor from './ItemRuleEditor';

type Candidate = { id:string; kind:string; concept:string; source_phrase?:string; suggested_item_id?:string; suggested_icon_name?:string; occurrence_count:number; status:string; evidence_version:number; bare_word_disabled:boolean; reviewed_at?:string };
type Removal = { id:string; icon_name:string; keyword:string; status:string };
type Rule = { revision:number; keyword:string; item_id:string; action:string };
type Review = { candidates:Candidate[]; removals:Removal[]; iconBacklog:Candidate[]; events:Rule[]; snapshot:{ revision:number; rules:Rule[] } };
const button = 'rounded px-3 py-2 bg-amber-900 text-white disabled:opacity-40';
function reviewErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'error' in error.body) {
    const detail = (error.body as { error?: unknown }).error;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return error instanceof Error ? error.message : 'Review failed. Refresh and try again.';
}
function canPublishKeyword(row: Candidate): boolean {
  return row.evidence_version === 2 && Boolean((row.source_phrase || '').trim());
}
export default function ItemsTab() {
  const [view, setView] = useState<'rules'|'suggestions'|'publisher'>('rules');
  const [data, setData] = useState<Review | null>(null);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [targets, setTargets] = useState<Record<string,string>>({});
  const load = useCallback(async () => {
    try { setData(await apiClient.get<Review>(`/api/admin/item-learning?status=${status}`)); }
    catch (e) { setError(reviewErrorMessage(e)); }
  }, [status]);
  useEffect(() => { if (view === 'suggestions') void load(); }, [load, view]);
  async function act(action:string, row:{id?:string;revision?:number}, itemId?:string) {
    if (busy || !data) return;
    if (action === 'disable' && !window.confirm('Disable only this exact keyword for all NEW reflections? A user removing an item does not necessarily mean the match was wrong. This change can be undone.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiClient.patch('/api/admin/item-learning', { action, id:row.id, eventRevision:row.revision, itemId, revision:data.snapshot.revision });
      await load();
      if (action === 'approve-icon') setNotice('Added to Icon Backlog. It will stay visible below until its asset is published or the suggestion is rejected.');
      if (action === 'publish') setNotice('Keyword rule published.');
    } catch (e) { setError(reviewErrorMessage(e)); }
    finally { setBusy(false); }
  }
  function candidates(kind:string, title:string) {
    const rows = data?.candidates.filter(c => c.kind === kind && !(kind === 'missing_icon' && c.status === 'approved')) || [];
    return <section className="rounded-lg border bg-white p-4"><h3 className="font-bold mb-3">{title} ({rows.length})</h3>
      <div className="space-y-3 max-h-[600px] overflow-auto">{rows.map(row => {
        const keywordPublishable = kind !== 'missing_keyword' || canPublishKeyword(row);
        return <article key={row.id} className="rounded border p-3 space-y-2">
        <div className="font-semibold">Icon Name: {row.suggested_icon_name || row.concept}</div>
        <div className="break-words">User Input: <strong>{row.source_phrase || '(legacy suggestion: no verified source phrase)'}</strong></div>
        <div className="text-xs text-gray-500">{row.occurrence_count} reflections · {row.status}</div>
        {kind === 'missing_keyword' && <label className="block text-xs">Target item ID<input className="block border rounded p-2 w-full text-sm" value={targets[row.id] ?? row.suggested_item_id ?? ''} onChange={e => setTargets(old => ({...old,[row.id]:e.target.value}))}/></label>}
        {kind === 'missing_keyword' && !keywordPublishable && <p className="text-xs text-amber-800">A verified source keyword is required. Add one directly in Icon Rule Editor, or reject this suggestion.</p>}
        {['pending','approved'].includes(row.status) && <div className="flex gap-2 flex-wrap">
          {(kind === 'missing_keyword' || row.status === 'pending') && <button className={button} disabled={busy || !keywordPublishable} onClick={() => void act(kind === 'missing_keyword' ? 'publish' : 'approve-icon', row, targets[row.id] ?? row.suggested_item_id)}>{kind === 'missing_keyword' ? (keywordPublishable ? 'Approve → AUTO' : 'Needs verified keyword') : 'Add to icon backlog'}</button>}
          <button disabled={busy} className="border rounded px-3 py-2" onClick={() => void act('reject',row)}>Reject</button>
        </div>}
      </article>})}{!rows.length && <p className="text-gray-500">No records.</p>}</div></section>;
  }
  return <div className="space-y-6 text-gray-900">
    <header className="space-y-3"><h2 className="text-xl font-bold">Memory Items</h2>
      <p className="text-sm text-gray-600">Browse the live icon catalog, maintain reviewed keyword rules, or process suggestions collected from reflections.</p>
      <div className="flex gap-2 flex-wrap">
        {([['rules','Icon Rule Editor'],['suggestions','Suggestions & Removals'],['publisher','Icon Publisher']] as const).map(([id,label]) => <button key={id} onClick={() => setView(id)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === id ? 'bg-amber-900 text-white' : 'border bg-white'}`}>{label}</button>)}
      </div>
    </header>
    {view === 'rules' && <ItemRuleEditor />}
    {view === 'publisher' && <ItemPublisher />}
    {view === 'suggestions' && <>
    <section className="rounded-lg border bg-white p-4 space-y-3"><p className="text-sm text-gray-600">Only the verified source keyword is shown, never a full journal. Admin approval may publish a word or phrase as AUTO; reviewed NEVER_AUTO rules still block it. Approval changes matching rules, not existing memories. Missing Icons still need an actual asset/catalog release.</p>
      <div className="flex gap-3 items-center flex-wrap"><select className="border rounded p-2" value={status} onChange={e => setStatus(e.target.value)}>{['pending','approved','published','rejected','all'].map(s => <option key={s}>{s}</option>)}</select>
        <button className="border rounded p-2" disabled={busy} onClick={() => {setError('');void load();}}>Refresh</button><a className="underline" href="/api/admin/item-learning?export=1">Export reviewed rules</a><span className="text-sm">Revision {data?.snapshot.revision ?? '…'}</span></div></section>
    {error && <p role="alert" className="p-3 bg-red-50 text-red-800 rounded">{error}</p>}
    {notice && <p role="status" className="p-3 bg-green-50 text-green-800 rounded">{notice}</p>}
    <div className="grid lg:grid-cols-2 gap-5">{candidates('missing_icon','Missing Icons')}{candidates('missing_keyword','Missing Keywords')}</div>
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="font-bold">Icon Backlog ({data?.iconBacklog?.length || 0})</h3><p className="text-sm text-gray-600">Approved missing concepts waiting for a real icon asset and catalog release.</p></div><button className="border rounded p-2" onClick={() => setView('publisher')}>Open Icon Publisher</button></div>
      <div className="max-h-[500px] overflow-auto space-y-2">{data?.iconBacklog?.map(row => <article key={row.id} className="border rounded p-3 flex items-center gap-3 flex-wrap"><div className="flex-1"><strong>{row.suggested_icon_name || row.concept}</strong><div className="break-words text-sm">{row.source_phrase || '(legacy suggestion)'}</div><small>{row.occurrence_count} reflections · added {row.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString() : 'recently'}</small></div><button disabled={busy} className="border rounded p-2" onClick={() => void act('reject', row)}>Remove from backlog</button></article>)}{!data?.iconBacklog?.length && <p className="text-gray-500">No approved missing icons yet.</p>}</div>
    </section>
    <section className="bg-white border rounded-lg p-4 space-y-3"><h3 className="font-bold">Confirmed Item Removals</h3><p className="text-sm text-gray-600">Review whether the match was wrong; removal may just be personal preference. Each row is an actual accepted triggering keyword.</p>
      <div className="max-h-[500px] overflow-auto space-y-2">{data?.removals.map(row => <article key={row.id} className="border rounded p-3 flex items-center gap-3 flex-wrap"><div className="flex-1"><strong>{row.icon_name}</strong><div>{row.keyword}</div><small>{row.status}</small></div>
        {row.status === 'pending' && <><button disabled={busy} className={button} onClick={() => void act('disable',row)}>Disable exact keyword</button><button disabled={busy} className="border rounded p-2" onClick={() => void act('reject-removal',row)}>Keep rule</button></>}
      </article>)}{!data?.removals.length && <p className="text-gray-500">No records.</p>}</div>
    </section>
    <section className="bg-white border rounded-lg p-4"><h3 className="font-bold mb-3">Rule Change History</h3><div className="max-h-[400px] overflow-auto space-y-2">{data?.events.map(event => <div key={event.revision} className="border rounded p-3 flex gap-3 items-center"><div className="flex-1 text-sm">#{event.revision} {event.action} · {event.keyword}<div className="text-xs text-gray-500">{event.item_id}</div></div>{data.snapshot.rules.some(r => r.keyword === event.keyword && r.revision === event.revision) && <button className="border rounded p-2" disabled={busy} onClick={() => void act('undo', event)}>Undo</button>}</div>)}</div></section>
    </>}
  </div>;
}
