'use client';
import { useEffect, useRef, useState } from 'react';

type Preview = { url: string; name: string; width: number; height: number; bounds: number[]; squareThumbnail: boolean };
type Product = { stable_id: string; title: string; description: string; category: string; price: number | null;
  plus_only: boolean; tradable: boolean; shop_price_version: number; editable: boolean; preview: Preview | null;
  metadata: { starter?: boolean }; asset: { outfitColor?: string; outfitStyle?: string } };
type Change = { id: number; batch_id: string; item_id: string; old_price: number; new_price: number;
  admin_email: string; reason: string | null; created_at: string };
type Catalog = { appVersion: string; rows: Product[]; history: Change[] };
const button = 'rounded-lg border px-3 py-2 disabled:opacity-40';
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

function Artwork({ row }: { row: Product }) {
  const art = row.preview;
  if (!art) return <div className="w-20 h-20 flex items-center justify-center rounded-lg bg-amber-50 text-xs text-center p-1">
    {row.category === 'outfits' ? <svg viewBox="0 0 100 130" role="img" aria-label={`${row.title} code-rendered outfit`} className="h-full">
      <ellipse cx="34" cy="29" rx="10" ry="26" fill="#DFAC79"/><ellipse cx="65" cy="29" rx="10" ry="26" fill="#DFAC79"/>
      <ellipse cx="50" cy="94" rx="31" ry="30" fill="#DFAC79"/><path d="M22 80Q50 71 78 80L74 111Q50 120 26 111Z" fill={/^#[0-9a-f]{6}$/i.test(row.asset.outfitColor ?? '') ? row.asset.outfitColor : '#65845B'}/>
      {(!row.asset.outfitStyle || row.asset.outfitStyle === 'explorer') && <g><path d="M28 80L49 100L70 80" stroke="#E2C596" strokeWidth="6" fill="none"/><rect x="43" y="98" width="15" height="13" rx="3" fill="#BF985F"/></g>}
      {row.asset.outfitStyle === 'jumper' && <g><path d="M24 87H76M24 100H76" stroke="#FFF0D6" strokeWidth="5"/><path d="M43 105Q38 99 42 97Q47 94 50 99Q57 94 59 98Q61 103 50 112Z" fill="#FFF0D6"/></g>}
      {row.asset.outfitStyle === 'raincoat' && <g><path d="M50 78V115" stroke="#AF8732" strokeWidth="2"/>{[87,98,109].map(y => <circle key={y} cx="54" cy={y} r="2" fill="#FFF0D6"/>)}</g>}
      {row.asset.outfitStyle === 'pyjamas' && <g><path d="M30 87H73M27 101H74" stroke="#A4B8DB" strokeWidth="3"/><path d="M65 91L67 96L72 96L68 100L69 105L65 102L61 105L62 100L58 96L63 96Z" fill="#FFEBA7"/></g>}
      <ellipse cx="50" cy="62" rx="32" ry="27" fill="#DFAC79"/><ellipse cx="50" cy="75" rx="20" ry="13" fill="#FFF0D6"/>
      <circle cx="34" cy="62" r="3.5" fill="#623F2D"/><circle cx="65" cy="62" r="3.5" fill="#623F2D"/>
      <path d="M45 70Q50 67 55 70L50 75Z" fill="#C97866"/>
    </svg> : 'Missing local preview'}</div>;
  const [left, top, right, bottom] = art.bounds;
  const scale = 72 / Math.max(right - left, bottom - top);
  return <div className="relative w-20 h-20 overflow-hidden rounded-lg bg-amber-50 shrink-0">
    {/* Static Admin copies; mobile continues using its bundled originals. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt={row.title} src={art.url} loading="lazy" style={art.squareThumbnail
      ? { width: 80, height: 80, objectFit: 'cover' }
      : { position: 'absolute', width: art.width * scale, height: art.height * scale, maxWidth: 'none',
        left: (80 - (right - left) * scale) / 2 - left * scale, top: (80 - (bottom - top) * scale) / 2 - top * scale }} />
  </div>;
}

export default function ShopPricingTab() {
  const [data, setData] = useState<Catalog | null>(null), [category, setCategory] = useState('all');
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set()), [batchPrice, setBatchPrice] = useState('');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const generation = useRef(0), saveInFlight = useRef(false);
  async function load() {
    const token = ++generation.current; setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/shop-pricing', { cache: 'no-store' });
      const result = await response.json(); if (!response.ok) throw Error(result.message ?? result.error);
      if (token !== generation.current) return;
      setData(result); setDrafts({}); setSelected(new Set()); setPage(0);
    } catch (e) { if (token === generation.current) setError(String(e)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  const categories = [...new Set(data?.rows.map(row => row.category) ?? [])];
  const filtered = data?.rows.filter(row => (category === 'all' || row.category === category)
    && `${row.title} ${row.stable_id} ${row.preview?.name ?? ''}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [];
  const visible = filtered.slice(page * 40, (page + 1) * 40);
  const changed = data?.rows.filter(row => drafts[row.stable_id] !== undefined && drafts[row.stable_id] !== String(row.price)) ?? [];
  const valid = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1000000;
  const invalid = changed.some(row => !valid(drafts[row.stable_id]));
  const choose = (id: string, checked: boolean) => setSelected(old => { const next = new Set(old); checked ? next.add(id) : next.delete(id); return next; });
  async function save() {
    if (busy || saveInFlight.current || invalid || !changed.length || !window.confirm(`Publish ${changed.length} price changes? Images, ownership and existing purchases will not change.`)) return;
    saveInFlight.current = true; const token = ++generation.current; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/shop-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: changed.map(row => ({ id: row.stable_id, price: Number(drafts[row.stable_id]), version: row.shop_price_version })), reason }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error === 'price_conflict' ? 'Another update changed these prices. Nothing was saved. Reload, then review your changes again.' : result.error);
      if (token !== generation.current) return;
      // Keep the committed revisions locally even if the following read fails.
      setData(old => old ? { ...old, rows: old.rows.map(row => {
        const update = result.updated.find((entry: { id: string }) => entry.id === row.stable_id);
        return update ? { ...row, price: update.price, shop_price_version: update.version } : row;
      }) } : old);
      setDrafts({}); setReason('');
      await load(); if (token + 1 === generation.current) setNotice('Prices saved. No assets or inventory were changed.');
    } catch (e) { if (token === generation.current) setError(`${e} Unsaved edits have been kept. If the request outcome is unknown, reload before trying again.`); }
    finally { saveInFlight.current = false; if (token === generation.current) setBusy(false); }
  }
  return <section className="space-y-5 text-gray-900">
    <header><h2 className="text-xl font-bold">Shop Pricing</h2><p className="mt-2 text-sm text-gray-600">Bundled mobile artwork · App {data?.appVersion ?? '…'}. Only carrot prices are editable. No product creation, deletion, uploads or availability changes.</p>
      <p className="text-sm text-gray-600">Free starter items stay read-only. Paid prices: 1–1,000,000 carrots. Store subscription / carrot-pack cash prices are not managed here.</p></header>
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
      <button disabled={busy} className={button} onClick={() => setSelected(new Set(filtered.filter(r => r.editable).map(r => r.stable_id)))}>Select filtered paid items</button>
      <button disabled={busy} className={button} onClick={() => setSelected(new Set())}>Clear selection</button>
      <span>{selected.size} selected</span><input aria-label="Batch carrot price" type="number" min={1} max={1000000} step={1} disabled={busy} className="border rounded p-2 w-36" value={batchPrice} onChange={e => setBatchPrice(e.target.value)}/>
      <button disabled={busy || !selected.size || !valid(batchPrice)} className={button} onClick={() => setDrafts(old => ({ ...old, ...Object.fromEntries([...selected].map(id => [id, batchPrice])) }))}>Apply to draft</button>
    </div>
    <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-left text-sm"><thead className="bg-amber-50"><tr>{['Select', 'Artwork', 'Product', 'Category', 'Current carrots', 'New carrots'].map(text => <th className="p-3" key={text}>{text}</th>)}</tr></thead>
      <tbody>{visible.map(row => <tr key={row.stable_id} className="border-t">
        <td className="p-3"><input type="checkbox" aria-label={`Select ${row.title}`} disabled={busy || !row.editable} checked={selected.has(row.stable_id)} onChange={e => choose(row.stable_id, e.target.checked)}/></td>
        <td className="p-3"><Artwork row={row}/></td>
        <td className="p-3"><strong>{row.title}</strong><div className="text-xs text-gray-500 break-all">{row.stable_id}</div>{row.description && <p className="max-w-md text-gray-600">{row.description}</p>}{row.preview && <div className="text-xs text-gray-500">Local art: {row.preview.name}</div>}<div>{row.plus_only && 'Plus · '}{row.tradable ? 'Giftable' : 'Not giftable'}</div>{row.category === 'outfits' && <small>Code-rendered · {row.asset.outfitStyle ?? 'explorer'}</small>}{!row.preview && row.category !== 'outfits' && <div className="text-amber-800">Local registry mismatch — verify before release</div>}</td>
        <td className="p-3">{label(row.category)}</td><td className="p-3">{row.price == null ? 'Not sold' : row.price === 0 ? 'Free' : row.price.toLocaleString()}</td>
        <td className="p-3">{row.editable ? <input aria-label={`Carrot price for ${row.title}`} type="number" min={1} max={1000000} step={1} disabled={busy} value={drafts[row.stable_id] ?? String(row.price)} onChange={e => setDrafts(old => ({ ...old, [row.stable_id]: e.target.value }))} className="border rounded p-2 w-32"/> : 'Read-only'}</td>
      </tr>)}</tbody></table>{!visible.length && !busy && <p className="p-4">No matching products.</p>}</div>
    <div className="flex gap-3 items-center"><button disabled={!page} className={button} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 40))}</span><button disabled={(page + 1) * 40 >= filtered.length} className={button} onClick={() => setPage(p => p + 1)}>Next</button></div>
    <div className="rounded-lg border bg-white p-4 flex gap-3 flex-wrap items-center"><input aria-label="Price change reason" maxLength={500} placeholder="Reason (optional)" className="border rounded p-2 flex-1" disabled={busy} value={reason} onChange={e => setReason(e.target.value)}/>
      <button className={`${button} bg-amber-900 text-white`} disabled={busy || !changed.length || changed.length > 200 || invalid} onClick={() => void save()}>Save {changed.length} price changes</button>
      {(invalid || changed.length > 200) && <p role="alert">Use integer prices from 1–1,000,000; save at most 200 changes per batch.</p>}</div>
    <section className="rounded-lg border bg-white p-4 space-y-3"><h3 className="font-bold">Recent price history</h3><p className="text-sm text-gray-600">Restore adds the old price to your draft. Review and save to apply it; newer edits are still conflict-checked.</p>
      <div className="max-h-96 overflow-auto space-y-2">{data?.history.map(entry => {
        const row = data.rows.find(r => r.stable_id === entry.item_id);
        return <div key={entry.id} className="border-t pt-2 flex gap-3 items-center"><div className="flex-1 text-sm"><strong>{row?.title ?? entry.item_id}</strong> · {entry.old_price} → {entry.new_price}<div className="text-xs text-gray-500">{entry.admin_email || 'Database maintenance'} · {new Date(entry.created_at).toLocaleString()} · {entry.reason ?? 'No reason'}</div></div>
          <button disabled={busy || !row?.editable || entry.old_price < 1} className={button} onClick={() => setDrafts(old => ({ ...old, [entry.item_id]: String(entry.old_price) }))}>Restore to draft</button></div>;
      })}{!data?.history.length && <p className="text-sm text-gray-500">No price changes yet.</p>}</div></section>
  </section>;
}
