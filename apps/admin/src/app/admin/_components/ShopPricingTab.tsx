'use client';
import { useEffect, useRef, useState } from 'react';

type Preview = { url: string; landscapeUrl?: string; windowFrameKey?: string; name: string; width: number; height: number; bounds: number[]; squareThumbnail: boolean };
type Product = { stable_id: string; title: string; description: string; category: string; price: number | null;
  plus_only: boolean; tradable: boolean; shop_price_version: number; editable: boolean; preview: Preview | null;
  metadata: { starter?: boolean; billing?: string }; asset: { outfitKey?: string };
  questions?: {self:string;partner:string;options:string[]}[] };
type Change = { id: number; batch_id: string; item_id: string; old_price: number; new_price: number;
  old_plus_only: boolean | null; new_plus_only: boolean | null;
  admin_email: string; reason: string | null; created_at: string };
type Catalog = { appVersion: string; rows: Product[]; history: Change[] };
const button = 'rounded-lg border px-3 py-2 disabled:opacity-40';
const label = (value: string) => value === 'dresser_plants' ? 'Kettles' : value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const isGame = (row: Product) => row.stable_id.startsWith('game:');
const minPrice = (row: Product) => isGame(row) ? 0 : 1;
const maxPrice = (row: Product) => row.metadata.billing ? 99999 : 1000000;

function Artwork({ row }: { row: Product }) {
  const art = row.preview;
  if (!art) return <div className="w-20 h-20 flex items-center justify-center rounded-lg bg-amber-50 text-xs text-center p-1">
    {row.metadata.starter && row.category === 'outfits' ? 'Default bunny' : 'Missing local preview'}</div>;
  const [left, top, right, bottom] = art.bounds;
  const scale = 72 / Math.max(right - left, bottom - top);
  const imageStyle = art.squareThumbnail
    ? { width: 80, height: 80, objectFit: 'cover' as const }
    : { position: 'absolute' as const, width: art.width * scale, height: art.height * scale, maxWidth: 'none',
      left: (80 - (right - left) * scale) / 2 - left * scale, top: (80 - (bottom - top) * scale) / 2 - top * scale };
  return <div className="relative w-20 h-20 overflow-hidden rounded-lg bg-amber-50 shrink-0"
    style={row.category==='surprises'?{backgroundColor:'#c69063'}:undefined}>
    {/* Static Admin copies; mobile continues using its bundled originals. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {art.landscapeUrl && <img alt="" aria-hidden src={art.landscapeUrl} loading="lazy" style={imageStyle}/>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt={row.title} src={art.url} loading="lazy" style={imageStyle}/>
  </div>;
}

export default function ShopPricingTab() {
  const [data, setData] = useState<Catalog | null>(null), [category, setCategory] = useState('all');
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [plusDrafts, setPlusDrafts] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set()), [batchPrice, setBatchPrice] = useState('');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const generation = useRef(0), saveInFlight = useRef(false);
  async function load() {
    const token = ++generation.current; setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/shop-pricing', { cache: 'no-store' });
      const result = await response.json(); if (!response.ok) throw Error(result.message ?? result.error);
      if (token !== generation.current) return;
      setData(result); setDrafts({}); setPlusDrafts({}); setSelected(new Set()); setPage(0);
    } catch (e) { if (token === generation.current) setError(String(e)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  const categories = [...new Set(data?.rows.map(row => row.category) ?? [])];
  const filtered = data?.rows.filter(row => (category === 'all' || row.category === category)
    && `${row.title} ${row.stable_id} ${row.preview?.name ?? ''}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [];
  const visible = filtered.slice(page * 40, (page + 1) * 40);
  const priceChanged = (row: Product) => drafts[row.stable_id] !== undefined && drafts[row.stable_id] !== String(row.price);
  const plusChanged = (row: Product) => plusDrafts[row.stable_id] !== undefined && plusDrafts[row.stable_id] !== row.plus_only;
  const changed = data?.rows.filter(row => priceChanged(row) || plusChanged(row)) ?? [];
  const valid = (value: string, min=1, max=1000000) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  const invalid = changed.some(row => priceChanged(row) && !valid(drafts[row.stable_id],minPrice(row),maxPrice(row)));
  const batchValid = !!selected.size && !!data && data.rows.filter(row=>selected.has(row.stable_id)).every(row=>valid(batchPrice,minPrice(row),maxPrice(row)));
  const choose = (id: string, checked: boolean) => setSelected(old => { const next = new Set(old); checked ? next.add(id) : next.delete(id); return next; });
  async function save() {
    if (busy || saveInFlight.current || invalid || !changed.length || !window.confirm(`Publish ${changed.length} product changes? Plus-only items require Plus for new purchases. Images, ownership and existing purchases will not change.`)) return;
    saveInFlight.current = true; const token = ++generation.current; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/shop-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: changed.map(row => ({ id: row.stable_id, version: row.shop_price_version,
          ...(priceChanged(row) ? { price: Number(drafts[row.stable_id]) } : {}),
          ...(plusChanged(row) ? { plus_only: plusDrafts[row.stable_id] } : {}) })), reason }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error === 'price_conflict' ? 'Another update changed these product settings. Nothing was saved. Reload, then review your changes again.' : result.error);
      if (token !== generation.current) return;
      // Keep the committed revisions locally even if the following read fails.
      setData(old => old ? { ...old, rows: old.rows.map(row => {
        const update = result.updated.find((entry: { id: string }) => entry.id === row.stable_id);
        return update ? { ...row, price: update.price, plus_only: update.plus_only ?? row.plus_only, shop_price_version: update.version } : row;
      }) } : old);
      setDrafts({}); setPlusDrafts({}); setReason('');
      await load(); if (token + 1 === generation.current) setNotice('Product settings saved. No assets or inventory were changed.');
    } catch (e) { if (token === generation.current) setError(`${e} Unsaved edits have been kept. If the request outcome is unknown, reload before trying again.`); }
    finally { saveInFlight.current = false; if (token === generation.current) setBusy(false); }
  }
  return <section className="space-y-5 text-gray-900">
    <header><h2 className="text-xl font-bold">Shop, Games & Surprise</h2><p className="mt-2 text-sm text-gray-600">Bundled mobile artwork · App {data?.appVersion ?? '…'}. Edit prices and Plus exclusivity, then Save to publish. Games unlock permanently; Surprise charges on every send. Preview and replay are free.</p>
      <p className="text-sm text-gray-600">Games: 0–99,999 coins. Set 0 and turn Plus OFF for Free play: no purchase prompt or coin charge; pairing is still required. Free unlocks are shared with the partner and remain unlocked if the price later increases. Plus ON still requires membership, even at 0. Surprise: 1–99,999; Shop: 1–1,000,000. Starter prices stay read-only. Subscription / coin-pack cash prices are not managed here.</p></header>
    <div className="flex gap-3 flex-wrap items-center">
      <input aria-label="Search Shop products" className="border rounded-lg p-2" placeholder="Search name or ID" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/>
      <select aria-label="Shop category" className="border rounded-lg p-2" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="all">All categories</option>{categories.map(c => <option key={c} value={c}>{label(c)}</option>)}</select>
      <button disabled={busy} className={button} onClick={() => { if (!changed.length || window.confirm('Discard unsaved edits and reload prices?')) void load(); }}>Reload</button>
      <span className="text-sm">{filtered.length} products · {changed.length} edited</span>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    {busy && <p role="status">Loading / saving…</p>}
    <div className="rounded-lg border bg-white p-3 flex gap-3 flex-wrap items-center">
      <button disabled={busy} className={button} onClick={() => setSelected(new Set(filtered.filter(r => r.editable).map(r => r.stable_id)))}>Select filtered editable items</button>
      <button disabled={busy} className={button} onClick={() => setSelected(new Set())}>Clear selection</button>
      <span>{selected.size} selected</span><input aria-label="Batch carrot price" type="number" min={0} max={1000000} step={1} disabled={busy} className="border rounded p-2 w-36" value={batchPrice} onChange={e => setBatchPrice(e.target.value)}/>
      <button disabled={busy || !batchValid} className={button} onClick={() => {if(batchValid)setDrafts(old => ({ ...old, ...Object.fromEntries([...selected].map(id => [id, batchPrice])) }));}}>Apply to draft</button>
      <span className="text-xs text-gray-600">Zero is allowed only when every selected item is a game.</span>
    </div>
    <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-left text-sm"><thead className="bg-amber-50"><tr>{['Select', 'Artwork', 'Product', 'Category', 'Current carrots', 'New carrots', 'Plus only'].map(text => <th className="p-3" key={text}>{text}</th>)}</tr></thead>
      <tbody>{visible.map(row => <tr key={row.stable_id} className="border-t">
        <td className="p-3"><input type="checkbox" aria-label={`Select ${row.title}`} disabled={busy || !row.editable} checked={selected.has(row.stable_id)} onChange={e => choose(row.stable_id, e.target.checked)}/></td>
        <td className="p-3"><Artwork row={row}/></td>
        <td className="p-3"><strong>{row.title}</strong><div className="text-xs text-gray-500 break-all">{row.stable_id}</div>{row.description && <p className="max-w-md text-gray-600">{row.description}</p>}{row.preview && <div className="text-xs text-gray-500">Local art: {row.preview.name}</div>}<div>{row.plus_only && 'Plus · '}{row.tradable ? 'Giftable' : 'Not giftable'}</div>{!row.preview && !row.metadata.starter && <div className="text-amber-800">Local registry mismatch — verify before release</div>}</td>
        <td className="p-3">{label(row.category)}{row.metadata.billing&&<div className="text-xs text-gray-500">{row.metadata.billing==='once'?'One-time unlock':'Per send'}</div>}
          {!!row.questions?.length&&<details className="mt-2 max-w-md"><summary className="cursor-pointer">View {row.questions.length} questions</summary>{row.questions.map((question,i)=><div key={i} className="mt-3"><strong>{i+1}. {question.self}</strong><div className="text-xs text-gray-600">Partner: {question.partner}</div><ol className="list-[upper-alpha] pl-5">{question.options.map((option,j)=><li key={j}>{option}</li>)}</ol></div>)}</details>}</td><td className="p-3">{row.price == null ? 'Not sold' : row.price === 0 ? 'Free' : row.price.toLocaleString()}</td>
        <td className="p-3">{row.editable ? <><input aria-label={`Carrot price for ${row.title}`} type="number" min={minPrice(row)} max={maxPrice(row)} step={1} disabled={busy} value={drafts[row.stable_id] ?? String(row.price)} onChange={e => setDrafts(old => ({ ...old, [row.stable_id]: e.target.value }))} className="border rounded p-2 w-32"/>{isGame(row)&&Number(drafts[row.stable_id]??row.price)===0&&<div className="mt-1 text-xs">{(plusDrafts[row.stable_id]??row.plus_only)?'Plus exclusive — turn Plus off for Free access.':'Free — no coin charge.'}</div>}</> : 'Read-only'}</td>
        <td className="p-3"><button type="button" role="switch" aria-label={`Plus only for ${row.title}`} aria-checked={plusDrafts[row.stable_id] ?? row.plus_only}
          disabled={busy} onClick={() => setPlusDrafts(old => ({ ...old, [row.stable_id]: !(old[row.stable_id] ?? row.plus_only) }))}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-40 ${(plusDrafts[row.stable_id] ?? row.plus_only) ? 'bg-amber-600' : 'bg-gray-300'}`}>
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${(plusDrafts[row.stable_id] ?? row.plus_only) ? 'translate-x-6' : 'translate-x-1'}`}/>
        </button><div className="mt-1 text-xs whitespace-nowrap">{(plusDrafts[row.stable_id] ?? row.plus_only) ? 'Plus exclusive' : 'No Plus required'}{plusChanged(row) && ' · Unsaved'}</div></td>
      </tr>)}</tbody></table>{!visible.length && !busy && <p className="p-4">No matching products.</p>}</div>
    <div className="flex gap-3 items-center"><button disabled={!page} className={button} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 40))}</span><button disabled={(page + 1) * 40 >= filtered.length} className={button} onClick={() => setPage(p => p + 1)}>Next</button></div>
    <div className="rounded-lg border bg-white p-4 flex gap-3 flex-wrap items-center"><input aria-label="Product change reason" maxLength={500} placeholder="Reason (optional)" className="border rounded p-2 flex-1" disabled={busy} value={reason} onChange={e => setReason(e.target.value)}/>
      <button className={`${button} bg-amber-900 text-white`} disabled={busy || !changed.length || changed.length > 200 || invalid} onClick={() => void save()}>Save {changed.length} product changes</button>
      {(invalid || changed.length > 200) && <p role="alert">Use integer prices: Games 0–99,999; Surprise 1–99,999; Shop 1–1,000,000. Save at most 200 changes per batch.</p>}</div>
    <section className="rounded-lg border bg-white p-4 space-y-3"><h3 className="font-bold">Recent product history</h3><p className="text-sm text-gray-600">Restore adds the old price and Plus setting to your draft. Review and save to apply it; newer edits are still conflict-checked.</p>
      <div className="max-h-96 overflow-auto space-y-2">{data?.history.map(entry => {
        const row = data.rows.find(r => r.stable_id === entry.item_id);
        return <div key={entry.id} className="border-t pt-2 flex gap-3 items-center"><div className="flex-1 text-sm"><strong>{row?.title ?? entry.item_id}</strong> · {entry.old_price} → {entry.new_price}
          {entry.old_plus_only != null && <span> · {entry.old_plus_only ? 'Plus' : 'No Plus'} → {entry.new_plus_only ? 'Plus' : 'No Plus'}</span>}
          <div className="text-xs text-gray-500">{entry.admin_email || 'Database maintenance'} · {new Date(entry.created_at).toLocaleString()} · {entry.reason ?? 'No reason'}</div></div>
          <button disabled={busy || !row || (!row.editable && entry.old_plus_only == null) || (entry.old_price < minPrice(row) && entry.old_plus_only == null)} className={button} onClick={() => {
            if(row?.editable && entry.old_price >= minPrice(row)) setDrafts(old => ({ ...old, [entry.item_id]: String(entry.old_price) }));
            if(entry.old_plus_only != null) setPlusDrafts(old => ({ ...old, [entry.item_id]: entry.old_plus_only! }));
          }}>Restore to draft</button></div>;
      })}{!data?.history.length && <p className="text-sm text-gray-500">No price changes yet.</p>}</div></section>
  </section>;
}
