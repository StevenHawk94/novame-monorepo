'use client';

import { useEffect, useState } from 'react';

import { apiClient, ApiError } from '@/lib/api-client';

/**
 * ScenesTab — Home scene ("Maps") catalog management (2026-07-30).
 *
 * Lists the scenes in R2's video-manifest and publishes new ones. One combo
 * = 2 webp files named after the scene (spaces become dashes):
 *   <Stem>.webp (home background) / <Stem>-Small.webp (grid thumb).
 * Presign → browser PUTs both straight to R2 → commit verifies + merges the
 * manifest. New scenes append at the end; the app grid renders left-to-right
 * in publish order. Live in the app immediately — no release.
 */

type SceneRow = {
  key: string;
  name: string;
  price: number;
  plusOnly: boolean;
  imageUrl: string;
  thumbUrl: string;
};

type GetResponse = { success: boolean; scenes?: SceneRow[]; error?: string };
type PresignResponse = {
  success: boolean;
  uploads?: Record<'image' | 'thumb', { url: string; contentType: string }>;
  error?: string;
};
type CommitResponse = { success: boolean; error?: string };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}: ${JSON.stringify(e.body)}`;
  return e instanceof Error ? e.message : 'Network error';
}

export default function ScenesTab() {
  const [loading, setLoading] = useState(true);
  const [scenes, setScenes] = useState<SceneRow[]>([]);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('300');
  const [plusOnly, setPlusOnly] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [thumb, setThumb] = useState<File | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiClient.get<GetResponse>('/api/admin/scenes');
      if (d.success && d.scenes) setScenes(d.scenes);
      else alert(d.error || 'Failed to load scenes');
    } catch (e) {
      alert(errMsg(e));
    }
    setLoading(false);
  };

  const validate = (): string | null => {
    if (!name.trim()) return 'Enter the scene name.';
    const p = Number(price);
    if (!Number.isInteger(p) || p <= 0) return 'Price must be a positive integer.';
    if (!image || !thumb) return 'Pick both files.';
    if (!image.name.endsWith('.webp') || image.size > MAX_IMAGE_BYTES) return 'Background must be .webp ≤ 2MB.';
    if (!thumb.name.endsWith('.webp') || thumb.size > MAX_IMAGE_BYTES) return 'Small thumb must be .webp ≤ 2MB.';
    return null;
  };

  const publish = async () => {
    const err = validate();
    if (err) {
      alert(err);
      return;
    }
    try {
      setPhase('Presigning…');
      const pre = await apiClient.post<PresignResponse>('/api/admin/scenes/presign', {
        name: name.trim(),
      });
      if (!pre.success || !pre.uploads) throw new Error(pre.error || 'presign failed');

      const files: [['image', File], ['thumb', File]] = [
        ['image', image as File],
        ['thumb', thumb as File],
      ];
      for (const [kind, file] of files) {
        setPhase(`Uploading ${kind} (${(file.size / 1024).toFixed(0)}KB)…`);
        const u = pre.uploads[kind];
        const resp = await fetch(u.url, {
          method: 'PUT',
          headers: { 'Content-Type': u.contentType },
          body: file,
        });
        if (!resp.ok) throw new Error(`R2 upload failed for ${kind}: HTTP ${resp.status}`);
      }

      setPhase('Publishing to manifest…');
      const commit = await apiClient.post<CommitResponse>('/api/admin/scenes', {
        name: name.trim(),
        price: Number(price),
        plusOnly,
      });
      if (!commit.success) throw new Error(commit.error || 'commit failed');

      setPhase(null);
      setName('');
      setImage(null);
      setThumb(null);
      setPlusOnly(false);
      alert('Scene published — live in the app now.');
      void load();
    } catch (e) {
      setPhase(null);
      alert(errMsg(e));
    }
  };

  const remove = async (s: SceneRow) => {
    if (!confirm(`Remove "${s.name}" from the map list? Files stay in R2; users who bought it keep the unlock.`)) return;
    try {
      const d = await apiClient.delete<CommitResponse>('/api/admin/scenes', { key: s.key });
      if (!d.success) alert(d.error || 'Failed to remove');
      void load();
    } catch (e) {
      alert(errMsg(e));
    }
  };

  if (loading) return <div className="text-black">Loading scenes...</div>;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-black">Home Scenes (Maps)</h2>
        <p className="text-sm text-gray-500 mt-1">
          One combo = 2 webp files named after the scene: Stem.webp (home
          background) + Stem-Small.webp (grid thumb); spaces in the name become
          dashes. New scenes append to the end of the app grid (left-to-right).
          Publishing updates the R2 manifest — live instantly, no release.
        </p>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Scene name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lavender Garden"
              className="mt-1 block w-56 border rounded px-3 py-2 text-sm text-black"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Price (clovers)</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
              className="mt-1 block w-28 border rounded px-3 py-2 text-sm text-black"
            />
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={plusOnly} onChange={(e) => setPlusOnly(e.target.checked)} />
            <span className="text-sm text-black">Plus Only</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FilePick label="Home background (Stem.webp)" accept=".webp" file={image} onPick={setImage} />
          <FilePick label="Grid thumb (Stem-Small.webp)" accept=".webp" file={thumb} onPick={setThumb} />
        </div>

        <button
          onClick={() => void publish()}
          disabled={phase !== null}
          className="bg-black text-white rounded px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {phase ?? 'Publish Scene'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenes.map((s) => (
          <div key={s.key} className="bg-white border rounded-lg p-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.thumbUrl} alt={s.name} className="w-16 h-16 object-cover rounded" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.imageUrl} alt={`${s.name} background`} className="w-16 h-16 object-cover rounded" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-black truncate">
                {s.name}
                {s.plusOnly && (
                  <span className="ml-2 text-[10px] font-bold text-amber-600 border border-amber-400 rounded px-1 py-0.5 align-middle">
                    PLUS
                  </span>
                )}
              </div>
              <div className="text-sm text-green-700 font-semibold">🍀 {s.price}</div>
            </div>
            <button onClick={() => void remove(s)} className="text-xs text-red-600 border border-red-300 rounded px-2 py-1">
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilePick({
  label,
  accept,
  file,
  onPick,
}: {
  label: string;
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  return (
    <label className="block border rounded p-3 cursor-pointer hover:bg-gray-50">
      <span className="text-xs font-semibold text-gray-600 block mb-1">{label}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <span className="text-sm text-black">
        {file ? `${file.name} (${(file.size / 1024).toFixed(0)}KB)` : 'Choose file…'}
      </span>
    </label>
  );
}
