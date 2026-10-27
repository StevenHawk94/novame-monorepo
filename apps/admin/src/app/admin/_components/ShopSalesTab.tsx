'use client';
import { useEffect, useRef, useState } from 'react';

type Sale = { item_id: string; category: string; title: string; item_status: string; current_price: number | null;
  purchases: number; self_purchases: number; gift_purchases: number; coins_spent: number;
  preview: { url: string; landscapeUrl?: string; name: string } | null };
type Category = { id: string; label: string; purchases: number; coinsSpent: number; soldStyles: number; styles: number };
type Report = { rows: Sale[]; categories: Category[]; purchases: number; coinsSpent: number; since: string | null; until: string };
const button = 'rounded-lg border px-3 py-2 disabled:opacity-40';
const number = (value: number) => value.toLocaleString();

export default function ShopSalesTab() {
  const [data, setData] = useState<Report | null>(null), [days, setDays] = useState('all'), [kind, setKind] = useState('all');
  const [category, setCategory] = useState('all'), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), token = ++generation.current;
    setBusy(true); setError(''); setData(null); setPage(0);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/shop-sales?days=${days}&kind=${kind}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json(); if (!response.ok) throw Error(result.message ?? result.error);
        if (generation.current === token) setData(result);
      } catch (e) { if (!controller.signal.aborted && generation.current === token) setError(String(e)); }
      finally { if (generation.current === token) setBusy(false); }
    })();
    return () => { generation.current++; controller.abort(); };
  }, [days, kind, reload]);
  const ranked = (data?.rows ?? []).filter(row => category === 'all' || row.category === category)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const filtered = ranked.filter(row => `${row.title} ${row.item_id} ${row.preview?.name ?? ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const visible = filtered.slice(page * 40, (page + 1) * 40);
  const categoryName = (id: string) => data?.categories.find(c => c.id === id)?.label ?? id;
  return <section className="space-y-5 text-gray-900">
    <header><h2 className="text-xl font-bold">Shop Sales</h2>
      <p className="mt-2 text-sm text-gray-600">Rank categories and styles by successful paid purchases. Includes direct Shop purchases, Decorate checkout items and gifts to a partner. Each purchased item counts once; retries do not add sales.</p>
      <p className="text-sm text-gray-600">Excludes refunds, starter items, free unlocks and reward gifts. Coin spend uses the price paid at checkout, not today’s price; it is not cash revenue. Games and Surprise are not Shop merchandise. Retired products with sales remain visible; previously deleted records cannot be reconstructed.</p>
    </header>
    <div className="flex flex-wrap items-center gap-3">
      <label>Period <select className="border rounded-lg p-2" value={days} onChange={e => setDays(e.target.value)}>
        <option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
      </select></label>
      <label>Purchase type <select className="border rounded-lg p-2" value={kind} onChange={e => setKind(e.target.value)}>
        <option value="all">All purchases</option><option value="self">For self</option><option value="gift">For partner</option>
      </select></label>
      <button className={button} disabled={busy} onClick={() => setReload(n => n + 1)}>Refresh</button>
    </div>
    {busy && <p role="status">Loading purchase statistics…</p>}
    {error && <p role="alert" className="bg-red-50 text-red-800 rounded-lg p-3">{error}</p>}
    {data && <>
      <div className="rounded-lg border bg-white p-4"><strong>{number(data.purchases)} purchases · {number(data.coinsSpent)} coins spent</strong>
        <p className="mt-1 text-xs text-gray-600">UTC: {data.since ? new Date(data.since).toISOString() : 'All history'} → {new Date(data.until).toISOString()}. Zero-sale current products are included.</p></div>
      <h3 className="font-bold">Category ranking</h3>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-left text-sm"><thead className="bg-amber-50"><tr>
        {['Rank', 'Category', 'Purchases', 'Styles sold / listed', 'Coins spent'].map(label => <th className="p-3" key={label}>{label}</th>)}
      </tr></thead><tbody>{data.categories.map((c, i) => <tr className="border-t" key={c.id}>
        <td className="p-3">{i + 1}</td><td className="p-3"><button className="text-blue-700 underline" onClick={() => { setCategory(c.id); setPage(0); setQuery(''); }}>{c.label}</button></td>
        <td className="p-3">{number(c.purchases)}</td><td className="p-3">{c.soldStyles} / {c.styles}</td><td className="p-3">{number(c.coinsSpent)}</td>
      </tr>)}</tbody></table></div>
      <h3 className="font-bold">Style ranking</h3>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Sales category" className="border rounded-lg p-2" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="all">All categories</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input aria-label="Search purchased styles" className="border rounded-lg p-2" placeholder="Search style or item ID" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/>
        <span className="text-sm">{filtered.length} styles</span>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-left text-sm"><thead className="bg-amber-50"><tr>
        {['Rank', 'Style', 'Category', 'Purchases', 'For self', 'For partner', 'Coins spent'].map(label => <th className="p-3" key={label}>{label}</th>)}
      </tr></thead><tbody>{visible.map(row => <tr className="border-t" key={row.item_id}>
        <td className="p-3">{row.rank}</td><td className="p-3"><div className="flex items-center gap-3">
          {row.preview && <div className="relative h-16 w-16 shrink-0 rounded-lg bg-amber-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {row.preview.landscapeUrl && <img src={row.preview.landscapeUrl} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy"/>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.preview.url} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy"/>
          </div>}
          <div><strong>{row.title}</strong><div className="text-xs text-gray-500 break-all">{row.item_id}</div>
            {row.item_status !== 'active' && <span className="text-xs text-amber-800">Retired</span>}</div>
        </div></td><td className="p-3">{categoryName(row.category)}</td><td className="p-3 font-bold">{number(row.purchases)}</td>
        <td className="p-3">{number(row.self_purchases)}</td><td className="p-3">{number(row.gift_purchases)}</td><td className="p-3">{number(row.coins_spent)}</td>
      </tr>)}</tbody></table>{!visible.length && <p className="p-4">No matching styles.</p>}</div>
      <div className="flex items-center gap-3"><button className={button} disabled={!page} onClick={() => setPage(n => n - 1)}>Previous</button>
        <span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 40))}</span>
        <button className={button} disabled={(page + 1) * 40 >= filtered.length} onClick={() => setPage(n => n + 1)}>Next</button></div>
    </>}
  </section>;
}
