'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type MetadataRow = {
  iconName: string;
  imageFile: string;
  category?: string;
  bagsCategory?: string;
  promptCategory?: string;
  rarity?: 'common' | 'uncommon' | 'rare';
  visualConcept?: string;
  keywordsMapping: string[] | string;
  keywordSafety: Array<{
    keyword: string;
    triggerMode: 'AUTO' | 'AUTO_UNLESS_EXCLUDED' | 'NEVER_AUTO';
    keywordType: 'Word' | 'Phrase';
    exclusions?: string[];
  }>;
};
type Preview = {
  success: boolean;
  batchVersion: string;
  baseVersion: string;
  rows: Array<{ itemId:string; iconName:string; imageFile:string; action:'NEW'|'REPLACE'; keywordsMapping:string[]; safetyCount:number }>;
  uploads: Record<string, { url:string; contentType:string }>;
};

const TEMPLATE: MetadataRow[] = [{
  iconName: 'Air Conditioner',
  imageFile: 'Air Conditioner.webp',
  category: 'Object',
  bagsCategory: 'Stuff',
  promptCategory: 'Chores & Home Care',
  rarity: 'common',
  visualConcept: 'A wall-mounted air conditioning unit.',
  keywordsMapping: ['air conditioner', 'turned on the air conditioner'],
  keywordSafety: [
    { keyword: 'air conditioner', triggerMode: 'AUTO', keywordType: 'Phrase', exclusions: [] },
    { keyword: 'turned on the air conditioner', triggerMode: 'AUTO', keywordType: 'Phrase', exclusions: [] },
  ],
}];

function downloadTemplate() {
  const blob = new Blob([JSON.stringify(TEMPLATE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'item-upload-template.json'; anchor.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

async function dimensions(file: File): Promise<{ width:number; height:number }> {
  const bitmap = await createImageBitmap(file);
  const value = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return value;
}

export default function ItemPublisher() {
  const [live, setLive] = useState<{version:string;publishedAt:string|null;items:unknown[]}|null>(null);
  const [rows, setRows] = useState<MetadataRow[]>([]);
  const [metadataName, setMetadataName] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview|null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [phase, setPhase] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const imageNames = useMemo(() => new Set(images.map(file => file.name)), [images]);
  const imageUrls = useMemo(() => new Map(images.map(file => [file.name, URL.createObjectURL(file)])), [images]);
  useEffect(() => () => { for (const url of imageUrls.values()) URL.revokeObjectURL(url); }, [imageUrls]);

  const loadLive = async () => {
    try { setLive(await apiClient.get('/api/admin/items')); } catch { /* review tab remains usable */ }
  };
  useEffect(() => { void loadLive(); }, []);

  const resetPrepared = () => { setPreview(null); setUploaded(false); setErrors([]); };

  async function chooseMetadata(file?: File) {
    resetPrepared(); setRows([]); setMetadataName(file?.name ?? '');
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('The JSON root must be an array of icon rows.');
      setRows(parsed as MetadataRow[]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Could not read metadata JSON.']);
    }
  }

  async function chooseImages(files: FileList|null) {
    resetPrepared();
    const selected = [...(files ? Array.from(files) : [])];
    const problems:string[] = [];
    const seen = new Set<string>();
    for (const file of selected) {
      if (seen.has(file.name)) problems.push(`Duplicate image filename: ${file.name}`);
      seen.add(file.name);
      if (!file.name.toLowerCase().endsWith('.webp') || file.type !== 'image/webp') {
        problems.push(`${file.name}: must be a real .webp image.`); continue;
      }
      if (file.size === 0 || file.size > 2 * 1024 * 1024) problems.push(`${file.name}: must be > 0 and ≤ 2MB.`);
      try {
        const size = await dimensions(file);
        if (size.width !== size.height) problems.push(`${file.name}: canvas must be square (${size.width}×${size.height}).`);
        if (size.width < 128 || size.width > 1024) problems.push(`${file.name}: use a 128–1024px square canvas.`);
      } catch { problems.push(`${file.name}: browser could not decode this WebP.`); }
    }
    setImages(selected); setErrors(problems);
  }

  async function runPreview() {
    const problems:string[] = [];
    if (!rows.length) problems.push('Choose a metadata JSON file with at least one row.');
    if (!images.length) problems.push('Choose the matching WebP icon files.');
    const expected = new Set(rows.map(row => String(row.imageFile || '')));
    for (const name of expected) if (!imageNames.has(name)) problems.push(`Missing selected image: ${name || '(empty imageFile)'}`);
    for (const file of images) if (!expected.has(file.name)) problems.push(`Selected image is not referenced by JSON: ${file.name}`);
    if (problems.length) { setErrors(problems); return; }
    setPhase('Validating complete catalog…'); setErrors([]);
    try {
      const result = await apiClient.post<Preview>('/api/admin/items/preview', { rows });
      setPreview(result); setUploaded(false);
    } catch (error) {
      const body = (error as {body?:{errors?:string[];error?:string}})?.body;
      setErrors(body?.errors ?? [body?.error ?? (error instanceof Error ? error.message : 'Preview failed.')]);
    } finally { setPhase(''); }
  }

  async function upload() {
    if (!preview) return;
    setPhase('Uploading 0%…'); setErrors([]);
    try {
      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        const target = preview.uploads[file.name];
        if (!target) throw new Error(`No signed upload target for ${file.name}. Run Preview again.`);
        const response = await fetch(target.url, { method:'PUT', headers:{'Content-Type':target.contentType}, body:file });
        if (!response.ok) throw new Error(`${file.name}: R2 upload returned HTTP ${response.status}.`);
        setPhase(`Uploading ${Math.round(((index + 1) / images.length) * 100)}%…`);
      }
      setUploaded(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Upload failed.']);
    } finally { setPhase(''); }
  }

  async function publish() {
    if (!preview || !uploaded) return;
    if (!window.confirm(`Publish ${preview.rows.length} icon update(s)? NEW items become matchable; REPLACE keeps the existing item ID and changes its art/rules.`)) return;
    setPhase('Verifying R2 files and publishing manifest…'); setErrors([]);
    try {
      await apiClient.post('/api/admin/items/publish', {
        rows, batchVersion:preview.batchVersion, baseVersion:preview.baseVersion,
      });
      alert('Item Manifest published. Supporting app versions will refresh in the background.');
      setPreview(null); setUploaded(false); setRows([]); setImages([]); setMetadataName('');
      await loadLive();
    } catch (error) {
      const body = (error as {body?:{errors?:string[];error?:string}})?.body;
      setErrors(body?.errors ?? [body?.error ?? (error instanceof Error ? error.message : 'Publish failed.')]);
    } finally { setPhase(''); }
  }

  return <section className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5 space-y-5">
    <div><h3 className="text-lg font-bold">Publish New or Replacement Icons</h3>
      <p className="text-sm text-gray-700 mt-1">Safe three-step flow: <strong>Preview → Upload → Publish Manifest</strong>. Nothing becomes live before the last step. Same normalized icon name means REPLACE and preserves its item ID; a new name means NEW.</p>
      <p className="text-xs text-gray-600 mt-1">Live version: {live?.version ?? 'loading…'} · dynamic icons/replacements: {live?.items?.length ?? 0}{live?.publishedAt ? ` · ${new Date(live.publishedAt).toLocaleString()}` : ''}</p>
      {live && <button className="text-xs underline mt-1" onClick={() => downloadJson(`item-manifest-${live.version}.json`, live)}>Download current live manifest</button>}
    </div>
    <div className="rounded bg-white border p-4 text-sm space-y-2">
      <strong>Before selecting files</strong>
      <ol className="list-decimal pl-5 space-y-1 text-gray-700">
        <li>Download the template. Keep every <code>imageFile</code> exactly equal to its selected WebP filename (case-sensitive).</li>
        <li>Set <code>promptCategory</code> to one of Reflect_Subcategory_Map’s ten Main_Category values, so “No Match” browsing can find the icon.</li>
        <li>Every <code>keywordsMapping</code> phrase needs exactly one matching <code>keywordSafety</code> row.</li>
        <li><code>AUTO_UNLESS_EXCLUDED</code> requires exclusions. Ambiguous bare words should be <code>NEVER_AUTO / Word</code>.</li>
        <li>Images must be square WebP, 128–1024px, non-empty, and no larger than 2MB. Preview reports all problems together.</li>
        <li>REPLACE treats the uploaded mappings and Safety rows as the icon’s complete new rule set. Review the diff before publishing.</li>
      </ol>
      <button className="border rounded px-3 py-2 font-semibold" onClick={downloadTemplate}>Download JSON Template</button>
    </div>
    <div className="grid md:grid-cols-2 gap-3">
      <label className="bg-white border rounded p-3"><strong className="block text-sm">1. Metadata JSON</strong><input className="mt-2 block w-full text-sm" type="file" accept=".json,application/json" onChange={event => void chooseMetadata(event.target.files?.[0])}/><small>{metadataName || 'No file selected'} · {rows.length} rows</small></label>
      <label className="bg-white border rounded p-3"><strong className="block text-sm">2. Matching WebP files</strong><input className="mt-2 block w-full text-sm" type="file" multiple accept=".webp,image/webp" onChange={event => void chooseImages(event.target.files)}/><small>{images.length} files selected</small></label>
    </div>
    {errors.length > 0 && <div role="alert" className="rounded bg-red-50 border border-red-300 p-3 text-red-900"><strong>Fix these before continuing:</strong><ul className="list-disc pl-5 mt-1">{errors.map((error,index)=><li key={`${error}-${index}`}>{error}</li>)}</ul></div>}
    <div className="flex gap-3 flex-wrap">
      <button disabled={!!phase} className="rounded bg-slate-900 text-white px-4 py-2 font-semibold disabled:opacity-40" onClick={() => void runPreview()}>{phase || 'Preview & Validate'}</button>
      <button disabled={!preview || !!phase || uploaded} className="rounded bg-blue-700 text-white px-4 py-2 font-semibold disabled:opacity-40" onClick={() => void upload()}>{uploaded ? 'Files Uploaded' : 'Upload Validated Files'}</button>
      <button disabled={!preview || !uploaded || !!phase} className="rounded bg-green-700 text-white px-4 py-2 font-semibold disabled:opacity-40" onClick={() => void publish()}>Publish Item Manifest</button>
    </div>
    {preview && <div className="bg-white border rounded overflow-auto max-h-80"><table className="w-full text-sm"><thead className="sticky top-0 bg-gray-100"><tr><th className="text-left p-2">Action</th><th className="text-left p-2">Icon</th><th className="text-left p-2">Stable item ID</th><th className="text-left p-2">Rules</th><th className="text-left p-2">Image</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.itemId} className="border-t"><td className={`p-2 font-bold ${row.action==='NEW'?'text-green-700':'text-amber-700'}`}>{row.action}</td><td className="p-2">{row.iconName}</td><td className="p-2 font-mono text-xs">{row.itemId}</td><td className="p-2">{row.keywordsMapping.length} mappings / {row.safetyCount} safety</td><td className="p-2"><div className="flex items-center gap-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={imageUrls.get(row.imageFile)} alt="" className="w-12 h-12 object-contain rounded bg-slate-50"/><span>{row.imageFile}</span></div></td></tr>)}</tbody></table></div>}
  </section>;
}
