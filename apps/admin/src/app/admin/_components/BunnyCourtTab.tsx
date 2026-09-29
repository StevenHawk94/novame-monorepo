'use client';

import { useCallback, useEffect, useState } from 'react';

type CourtCase = { case_id: string; category: string; subcategory: string | null; title: string; engine: string; access_tier: string; status: string; updated_at: string };

export default function BunnyCourtTab() {
  const [cases, setCases] = useState<CourtCase[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/bunny-court', { cache: 'no-store' });
    const data = await response.json();
    if (response.ok) setCases(data.cases || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async () => {
    if (!file || busy) return;
    setBusy(true); setMessage('Validating and publishing…');
    const form = new FormData(); form.set('file', file);
    const response = await fetch('/api/admin/bunny-court', { method: 'POST', body: form });
    const data = await response.json();
    setMessage(response.ok ? `Published ${data.imported} cases, ${data.questions} questions, and ${data.templates} verdict templates.` : data.error || 'Import failed.');
    setBusy(false); if (response.ok) void load();
  };

  const active = cases.filter((item) => item.status.toLowerCase().includes('launch'));
  const counts = active.reduce<Record<string, number>>((memo, item) => { memo[item.category] = (memo[item.category] || 0) + 1; return memo; }, {});
  return <div className="space-y-6">
    <div className="rounded-xl border bg-white p-6 space-y-4">
      <div><h2 className="text-xl font-semibold text-black">Bunny Court Content</h2><p className="text-sm text-gray-600 mt-1">Upload reviewed cases directly from the standard CSV spreadsheet. Every row is validated before publishing.</p></div>
      <div className="flex flex-wrap gap-3 items-center">
        <a href="/api/admin/bunny-court?action=template" className="rounded-lg border px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">Download CSV template</a>
        <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} className="text-sm text-black" />
        <button type="button" disabled={!file || busy} onClick={upload} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Publishing…' : 'Validate & publish'}</button>
      </div>
      {message && <p className="text-sm text-black">{message}</p>}
      <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950"><strong>Schema:</strong> one case per row. Keep <code>questions_json</code> as an array and <code>results_json</code> as an object keyed by the engine’s required result branches. Use <code>[A]</code> and <code>[B]</code> for the two users’ names; the app replaces them server-side.</div>
    </div>
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="rounded-xl border bg-white p-4"><div className="text-2xl font-bold text-black">{active.length}</div><div className="text-sm text-gray-600">Live cases</div></div>
      {['Love Court','Life Court','Conflict Court'].map((category) => <div key={category} className="rounded-xl border bg-white p-4"><div className="text-2xl font-bold text-black">{counts[category] || 0}</div><div className="text-sm text-gray-600">{category}</div></div>)}
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-black"><tr>{['Case ID','Court','Subcategory','Title','Engine','Tier','Status'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{cases.map((item) => <tr key={item.case_id} className="border-t text-black"><td className="px-4 py-3 font-mono text-xs">{item.case_id}</td><td className="px-4 py-3">{item.category}</td><td className="px-4 py-3">{item.subcategory || '—'}</td><td className="px-4 py-3 font-medium">{item.title}</td><td className="px-4 py-3">{item.engine}</td><td className="px-4 py-3">{item.access_tier}</td><td className="px-4 py-3">{item.status}</td></tr>)}</tbody></table></div>
  </div>;
}
