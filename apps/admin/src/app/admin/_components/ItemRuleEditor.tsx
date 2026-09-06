'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type AtlasThumb = { kind:'atlas'; url:string; x:number; y:number; cellSize:number; sheetSize:number };
type UrlThumb = { kind:'url'; url:string };
type Thumbnail = AtlasThumb | UrlThumb | null;
type ItemSummary = {
  itemId:string; displayName:string; category:string; bagsCategory:string;
  ruleCount:number; neverAutoCount:number; thumbnail:Thumbnail;
};
type Rule = {
  keyword:string; triggerMode:'AUTO'|'AUTO_UNLESS_EXCLUDED'|'NEVER_AUTO';
  keywordType:'Word'|'Phrase'; exclusions:string[]; source:string; active:boolean;
};
type ItemDetail = ItemSummary & { rules:Rule[]; disabledRules:Rule[] };
type ListResponse = {
  catalogVersion:string; revision:number; categories:string[]; total:number;
  page:number; pageSize:number; items:ItemSummary[];
};
type DetailResponse = { catalogVersion:string; revision:number; item:ItemDetail };

function IconThumb({ thumbnail, label, size = 64 }: { thumbnail:Thumbnail; label:string; size?:number }) {
  if (!thumbnail) return <span className="text-2xl" aria-hidden>🎒</span>;
  if (thumbnail.kind === 'url') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbnail.url} alt={label} width={size} height={size} className="object-contain" />;
  }
  const scale = size / thumbnail.cellSize;
  return <span role="img" aria-label={label} className="block shrink-0 bg-no-repeat" style={{
    width:size, height:size,
    backgroundImage:`url(${thumbnail.url})`,
    backgroundPosition:`-${thumbnail.x * scale}px -${thumbnail.y * scale}px`,
    backgroundSize:`${thumbnail.sheetSize * scale}px ${thumbnail.sheetSize * scale}px`,
  }} />;
}

const MODE_STYLE = {
  AUTO: 'bg-emerald-100 text-emerald-800',
  AUTO_UNLESS_EXCLUDED: 'bg-amber-100 text-amber-900',
  NEVER_AUTO: 'bg-slate-200 text-slate-700',
};

export default function ItemRuleEditor() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResponse|null>(null);
  const [selected, setSelected] = useState<DetailResponse|null>(null);
  const [ruleQuery, setRuleQuery] = useState('');
  const [newPhrase, setNewPhrase] = useState('');
  const [newTriggerMode, setNewTriggerMode] = useState<'AUTO'|'NEVER_AUTO'>('AUTO');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRequest = useRef(0);

  const loadList = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q:query, category, page:String(page), limit:'120' });
      const result = await apiClient.get<ListResponse>(`/api/admin/item-catalog?${params}`);
      if (request === listRequest.current) setList(result);
    } catch (e) {
      if (request === listRequest.current) setError(e instanceof Error ? e.message : 'Could not load icons.');
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [query, category, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 250);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  async function openItem(itemId:string) {
    setError(''); setRuleQuery(''); setNewPhrase('');
    try {
      const result = await apiClient.get<DetailResponse>(`/api/admin/item-catalog?itemId=${encodeURIComponent(itemId)}`);
      setSelected(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load icon rules.'); }
  }

  async function mutate(action:'add'|'delete'|'restore', keyword:string, triggerMode?:'AUTO'|'NEVER_AUTO') {
    if (!selected || busy) return;
    if (action === 'delete' && !window.confirm(`Stop “${keyword}” from matching ${selected.item.displayName}? This is reversible.`)) return;
    setBusy(true); setError('');
    try {
      await apiClient.patch('/api/admin/item-catalog', {
        action, keyword, triggerMode, itemId:selected.item.itemId, revision:selected.revision,
      });
      const refreshed = await apiClient.get<DetailResponse>(`/api/admin/item-catalog?itemId=${encodeURIComponent(selected.item.itemId)}`);
      setSelected(refreshed);
      setNewPhrase('');
      await loadList();
    } catch (e) { setError(e instanceof Error ? e.message : 'Rule update failed. Refresh and try again.'); }
    finally { setBusy(false); }
  }

  const totalPages = Math.max(1, Math.ceil((list?.total || 0) / (list?.pageSize || 120)));
  const filteredRules = selected?.item.rules.filter(rule =>
    !ruleQuery.trim() || rule.keyword.includes(ruleQuery.trim().toLowerCase())) || [];

  return <section className="space-y-4">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>Live rule editor.</strong> Add reviewed <code>AUTO</code> or <code>NEVER_AUTO</code> rules for a word or phrase. Rules reach compatible apps through the same dynamic feed. Catalogued <code>NEVER_AUTO</code> rules cannot be overridden as AUTO here. Deleting creates a reversible override; it does not erase the source workbook.
    </div>
    <div className="flex flex-col md:flex-row gap-3">
      <input aria-label="Search icons" className="border rounded-lg px-3 py-2 flex-1" value={query}
        onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search icon name, item ID, category, or keyword…" />
      <select aria-label="Filter category" className="border rounded-lg px-3 py-2 md:max-w-xs" value={category}
        onChange={e => { setCategory(e.target.value); setPage(1); }}>
        <option value="">All categories</option>
        {list?.categories.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button className="border rounded-lg px-4 py-2 bg-white" onClick={() => void loadList()} disabled={loading}>Refresh</button>
    </div>
    <div className="flex items-center justify-between text-sm text-gray-600">
      <span>{loading ? 'Loading…' : `${list?.total || 0} icons`} · catalog {list?.catalogVersion || '…'} · rule revision {list?.revision ?? '…'}</span>
      <div className="flex items-center gap-2">
        <button className="border rounded px-3 py-1 bg-white disabled:opacity-40" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>{page} / {totalPages}</span>
        <button className="border rounded px-3 py-1 bg-white disabled:opacity-40" disabled={page >= totalPages || loading} onClick={() => setPage(value => value + 1)}>Next</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
      {list?.items.map(item => <button key={item.itemId} onClick={() => void openItem(item.itemId)}
        className="min-h-40 rounded-xl border bg-white p-3 text-left hover:border-amber-500 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
        <div className="h-20 flex items-center justify-center rounded-lg bg-slate-50"><IconThumb thumbnail={item.thumbnail} label={item.displayName} /></div>
        <strong className="mt-2 block text-sm leading-tight line-clamp-2">{item.displayName}</strong>
        <span className="block text-[11px] text-gray-500 truncate">{item.itemId}</span>
        <span className="mt-1 block text-xs text-gray-600">{item.ruleCount} active{item.neverAutoCount ? ` · ${item.neverAutoCount} never` : ''}</span>
      </button>)}
    </div>
    {!loading && !list?.items.length && <p className="rounded border bg-white p-8 text-center text-gray-500">No icons match this search.</p>}

    {selected && <div className="fixed inset-0 z-[100] bg-black/40 p-3 md:p-8 flex justify-end" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
      <aside className="w-full max-w-2xl h-full overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col" role="dialog" aria-modal="true" aria-label={`${selected.item.displayName} keyword rules`}>
        <header className="border-b p-4 flex items-center gap-3">
          <div className="w-20 h-20 rounded-xl bg-slate-50 flex items-center justify-center"><IconThumb thumbnail={selected.item.thumbnail} label={selected.item.displayName} size={72} /></div>
          <div className="min-w-0 flex-1"><h3 className="text-xl font-bold">{selected.item.displayName}</h3><p className="font-mono text-xs text-gray-500 break-all">{selected.item.itemId}</p><p className="text-sm text-gray-600">{selected.item.category}</p></div>
          <button className="rounded-full border w-10 h-10 text-xl" aria-label="Close" onClick={() => setSelected(null)}>×</button>
        </header>
        <div className="overflow-y-auto p-4 space-y-5">
          <section className="rounded-xl border bg-slate-50 p-4 space-y-3">
            <h4 className="font-bold">Add a reviewed rule</h4>
            <p className="text-sm text-gray-600">Enter one word or a phrase, then choose whether it should match automatically or never match this icon. Punctuation and capitalization are normalized before publishing.</p>
            <div className="flex flex-col sm:flex-row gap-2"><input className="min-w-0 flex-1 rounded border bg-white px-3 py-2" value={newPhrase} onChange={e => setNewPhrase(e.target.value)} placeholder="e.g. brunch or grabbed an iced coffee" />
              <select aria-label="Trigger mode" className="rounded border bg-white px-3 py-2" value={newTriggerMode} onChange={e => setNewTriggerMode(e.target.value as 'AUTO'|'NEVER_AUTO')}><option value="AUTO">AUTO</option><option value="NEVER_AUTO">NEVER_AUTO</option></select>
              <button className="rounded bg-amber-900 px-4 py-2 text-white disabled:opacity-40" disabled={busy || !/[a-z0-9]/i.test(newPhrase)} onClick={() => void mutate('add', newPhrase, newTriggerMode)}>Add</button></div>
          </section>
          <section className="space-y-3">
            <div className="flex gap-3 items-center"><h4 className="font-bold flex-1">Current rules ({selected.item.rules.length})</h4><input className="rounded border px-3 py-1.5 text-sm w-52" value={ruleQuery} onChange={e => setRuleQuery(e.target.value.toLowerCase())} placeholder="Filter keywords…" /></div>
            <div className="space-y-2">{filteredRules.map(rule => <article key={`${rule.keyword}:${rule.triggerMode}`} className="rounded-lg border p-3 flex gap-3 items-start">
              <div className="min-w-0 flex-1"><div className="font-medium break-words">{rule.keyword}</div><div className="mt-1 flex flex-wrap gap-1.5 text-[11px]"><span className={`rounded-full px-2 py-0.5 font-bold ${MODE_STYLE[rule.triggerMode]}`}>{rule.triggerMode}</span><span className="rounded-full bg-blue-50 text-blue-800 px-2 py-0.5">{rule.keywordType}</span><span className="rounded-full bg-gray-100 px-2 py-0.5">{rule.source}</span></div>{rule.exclusions.length > 0 && <p className="mt-2 text-xs text-gray-600">Excluded when: {rule.exclusions.join(' · ')}</p>}</div>
              {rule.active && <button className="shrink-0 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50" disabled={busy} onClick={() => void mutate('delete', rule.keyword)}>Delete</button>}
              {!rule.active && rule.triggerMode === 'NEVER_AUTO' && rule.source === 'ADMIN' && <button className="shrink-0 rounded border px-3 py-1.5 text-xs" disabled={busy} onClick={() => void mutate('restore', rule.keyword)}>Remove rule</button>}
            </article>)}{!filteredRules.length && <p className="text-sm text-gray-500">No matching rules.</p>}</div>
          </section>
          {selected.item.disabledRules.length > 0 && <section className="space-y-3"><h4 className="font-bold">Disabled in Admin ({selected.item.disabledRules.length})</h4>
            {selected.item.disabledRules.map(rule => <article key={rule.keyword} className="rounded-lg border border-dashed p-3 flex gap-3 items-center opacity-75"><div className="flex-1"><div className="line-through">{rule.keyword}</div><small>{rule.triggerMode} · {rule.source}</small></div><button className="rounded border px-3 py-1.5 text-xs" disabled={busy} onClick={() => void mutate('restore', rule.keyword)}>Restore</button></article>)}
          </section>}
        </div>
      </aside>
    </div>}
  </section>;
}
