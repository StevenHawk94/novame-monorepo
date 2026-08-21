'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Candidate = {
  id: string; kind: 'missing_icon' | 'missing_keyword'; concept: string;
  suggested_item_id?: string | null; suggested_icon_name?: string | null;
  confidence: number; occurrence_count: number; status: string; safety_mode: string; exclusion_rules?: string[];
};
export default function ItemsTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState('');

  const missingKeywords = useMemo(() => candidates.filter((c) => c.kind === 'missing_keyword'), [candidates]);
  const missingIcons = useMemo(() => candidates.filter((c) => c.kind === 'missing_icon'), [candidates]);

  async function load() {
    const learning = await apiClient.get<{ success: boolean; candidates: Candidate[] }>(
      `/api/admin/item-learning?status=${status}`,
    );
    setCandidates(learning.candidates || []);
    setSelected(new Set());
  }
  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function review(ids: string[], nextStatus: 'approved' | 'rejected' | 'pending', overrides?: Partial<Candidate>) {
    if (!ids.length) return;
    setBusy('Saving review…');
    await apiClient.patch('/api/admin/item-learning', {
      ids, status: nextStatus, suggestedItemId: overrides?.suggested_item_id,
      suggestedIconName: overrides?.suggested_icon_name, safetyMode: overrides?.safety_mode,
      exclusionRules: overrides?.exclusion_rules,
    });
    setBusy('');
    await load();
  }

  const CandidateList = ({ title, rows }: { title: string; rows: Candidate[] }) => (
    <section className="bg-white border rounded-lg p-4">
      <h3 className="font-bold text-black mb-3">{title} ({rows.length})</h3>
      <div className="space-y-2 max-h-[520px] overflow-auto">
        {rows.map((row) => (
          <div key={row.id} className="border rounded p-3 flex gap-3 items-center text-sm">
            <input type="checkbox" checked={selected.has(row.id)} onChange={(event) => setSelected((old) => {
              const next = new Set(old); event.target.checked ? next.add(row.id) : next.delete(row.id); return next;
            })} />
            <div className="flex-1 min-w-0 text-black">
              <div className="font-semibold">{row.concept} <span className="text-gray-400">×{row.occurrence_count}</span></div>
              <div className="text-xs text-gray-500">Suggested: {row.suggested_icon_name || 'new icon'} · confidence {Number(row.confidence).toFixed(2)}</div>
              {row.kind === 'missing_keyword' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <input defaultValue={row.suggested_item_id || ''} onBlur={(e) => { row.suggested_item_id = e.target.value; }}
                    className="border rounded px-2 py-1 flex-1 text-black" placeholder="Target item id" />
                  <select defaultValue={row.safety_mode} onChange={(e) => { row.safety_mode = e.target.value; }} className="border rounded px-2 py-1 text-black">
                    <option>AUTO</option><option>AUTO_UNLESS_EXCLUDED</option><option>NEVER_AUTO</option>
                  </select>
                  <input defaultValue={(row.exclusion_rules || []).join('; ')} onBlur={(e) => { row.exclusion_rules = e.target.value.split(';').map((x) => x.trim()).filter(Boolean); }}
                    className="border rounded px-2 py-1 w-full text-black" placeholder="Exclusions separated by ;" />
                </div>
              )}
            </div>
            <button className="bg-green-600 text-white px-3 py-1 rounded" onClick={() => void review([row.id], 'approved', row)}>Approve</button>
            <button className="bg-red-100 text-red-700 px-3 py-1 rounded" onClick={() => void review([row.id], 'rejected')}>Reject</button>
          </div>
        ))}
        {!rows.length && <p className="text-gray-500">No records.</p>}
      </div>
    </section>
  );

  return <div className="space-y-6">
    <div className="flex flex-wrap gap-3 items-center">
      <div><h2 className="text-xl font-bold text-black">Memory Items Learning Review</h2>
        <p className="text-sm text-gray-500">No journal text is stored here. Approved mappings are incorporated into the bundled catalog release workflow.</p></div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-3 py-2 text-black">
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="published">Published</option><option value="rejected">Rejected</option><option value="all">All</option>
      </select>
      <button disabled={!selected.size || !!busy} className="bg-green-700 text-white px-3 py-2 rounded disabled:opacity-40" onClick={() => void review([...selected], 'approved')}>Approve selected</button>
      <button disabled={!selected.size || !!busy} className="bg-red-700 text-white px-3 py-2 rounded disabled:opacity-40" onClick={() => void review([...selected], 'rejected')}>Reject selected</button>
      {busy && <span className="text-sm text-blue-700">{busy}</span>}
    </div>
    <div className="grid md:grid-cols-2 gap-5"><CandidateList title="Missing icon suggestions" rows={missingIcons} /><CandidateList title="Missing keyword mappings" rows={missingKeywords} /></div>
  </div>;
}
