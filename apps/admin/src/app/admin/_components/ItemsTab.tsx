'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Candidate = {
  id: string; kind: 'missing_icon' | 'missing_keyword'; concept: string;
  suggested_item_id?: string | null; suggested_icon_name?: string | null;
  confidence: number; occurrence_count: number; status: string; safety_mode: string; exclusion_rules?: string[];
};
type CloudItem = { id: string; name: string; imageKey?: string; keywords?: string[]; bagsCategory?: string; promptCategory?: string; candidateId?: string };
type Manifest = { version?: string; items?: CloudItem[]; keywordPatches?: unknown[]; history?: { version: string; publishedAt: string; reason?: string }[] };

export default function ItemsTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [manifest, setManifest] = useState<Manifest>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('pending');
  const [files, setFiles] = useState<File[]>([]);
  const [rules, setRules] = useState<File | null>(null);
  const [busy, setBusy] = useState('');

  const missingKeywords = useMemo(() => candidates.filter((c) => c.kind === 'missing_keyword'), [candidates]);
  const missingIcons = useMemo(() => candidates.filter((c) => c.kind === 'missing_icon'), [candidates]);

  async function load() {
    const [learning, cloud] = await Promise.all([
      apiClient.get<{ success: boolean; candidates: Candidate[] }>(`/api/admin/item-learning?status=${status}`),
      apiClient.get<{ success: boolean; manifest: Manifest }>('/api/admin/items-cloud'),
    ]);
    setCandidates(learning.candidates || []);
    setManifest(cloud.manifest || {});
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

  async function publishApproved() {
    setBusy('Publishing approved keywords…');
    try {
      await apiClient.post('/api/admin/items-cloud', { action: 'publishApproved' });
      await load();
    } finally { setBusy(''); }
  }

  async function uploadBatch() {
    if (!rules || !files.length) return alert('Select a JSON rules file and one or more .webp files.');
    setBusy('Reading rules…');
    try {
      const parsed = JSON.parse(await rules.text()) as { items?: CloudItem[] } | CloudItem[];
      const definitions = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(definitions)) throw new Error('Rules JSON must be an array or { items: [...] }.');
      const fileByName = new Map(files.map((file) => [file.name, file]));
      const batchId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const pre = await apiClient.post<{ uploads: { filename: string; key: string; contentType: string; url: string }[] }>(
        '/api/admin/items-cloud/presign', { batchId, files: files.map((file) => ({ filename: file.name })) },
      );
      for (let i = 0; i < pre.uploads.length; i += 6) {
        setBusy(`Uploading ${Math.min(i + 6, pre.uploads.length)} / ${pre.uploads.length}…`);
        await Promise.all(pre.uploads.slice(i, i + 6).map(async (upload) => {
          const file = fileByName.get(upload.filename);
          if (!file) throw new Error(`Missing file ${upload.filename}`);
          const response = await fetch(upload.url, { method: 'PUT', headers: { 'Content-Type': upload.contentType }, body: file });
          if (!response.ok) throw new Error(`Upload failed: ${upload.filename}`);
        }));
      }
      const keyByFilename = new Map(pre.uploads.map((upload) => [upload.filename, upload.key]));
      const entries = definitions.map((item) => {
        const filename = (item as CloudItem & { filename?: string }).filename || `${item.id}.webp`;
        const imageKey = keyByFilename.get(filename);
        if (!imageKey) throw new Error(`No uploaded image for ${item.id} (expected ${filename})`);
        return { ...item, imageKey };
      });
      setBusy('Publishing atomic manifest…');
      await apiClient.post('/api/admin/items-cloud', { action: 'commitBatch', entries });
      setFiles([]); setRules(null);
      await load();
      alert('Batch published. Apps will fetch it silently on next launch.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Upload failed');
    } finally { setBusy(''); }
  }

  async function rollback(version: string) {
    if (!confirm(`Roll back the item catalog to version ${version}?`)) return;
    setBusy('Rolling back…');
    try { await apiClient.post('/api/admin/items-cloud', { action: 'rollback', version }); await load(); }
    finally { setBusy(''); }
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
      <div><h2 className="text-xl font-bold text-black">Memory Items Learning & Cloud Updates</h2>
        <p className="text-sm text-gray-500">No journal text is stored here. Every rule remains manual until approved and published.</p></div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-3 py-2 text-black">
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="published">Published</option><option value="rejected">Rejected</option><option value="all">All</option>
      </select>
      <button disabled={!selected.size || !!busy} className="bg-green-700 text-white px-3 py-2 rounded disabled:opacity-40" onClick={() => void review([...selected], 'approved')}>Approve selected</button>
      <button disabled={!selected.size || !!busy} className="bg-red-700 text-white px-3 py-2 rounded disabled:opacity-40" onClick={() => void review([...selected], 'rejected')}>Reject selected</button>
      <button disabled={!!busy} className="bg-black text-white px-3 py-2 rounded disabled:opacity-40" onClick={() => void publishApproved()}>Publish approved keywords</button>
      {busy && <span className="text-sm text-blue-700">{busy}</span>}
    </div>
    <div className="grid md:grid-cols-2 gap-5"><CandidateList title="Missing icon suggestions" rows={missingIcons} /><CandidateList title="Missing keyword mappings" rows={missingKeywords} /></div>
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <h3 className="font-bold text-black">Batch upload to R2</h3>
      <p className="text-sm text-gray-500">Images upload browser → R2 directly. JSON fields: id, name, keywords, promptCategory, bagsCategory, optional filename.</p>
      <input type="file" multiple accept=".webp,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <input type="file" accept=".json,application/json" onChange={(e) => setRules(e.target.files?.[0] || null)} />
      <button disabled={!!busy} className="bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-40" onClick={() => void uploadBatch()}>Upload & publish {files.length || ''} items</button>
      <div className="text-sm text-black">Current version: {manifest.version || 'none'} · cloud items: {manifest.items?.length || 0} · keyword patches: {manifest.keywordPatches?.length || 0}</div>
      <div className="flex flex-wrap gap-2">{(manifest.history || []).slice(1, 8).map((entry) => <button key={entry.version} className="border px-2 py-1 rounded text-xs text-black" onClick={() => void rollback(entry.version)}>Rollback {new Date(entry.publishedAt).toLocaleString()}</button>)}</div>
    </section>
  </div>;
}
