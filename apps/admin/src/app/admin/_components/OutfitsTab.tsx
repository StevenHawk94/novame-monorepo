'use client';

import { useEffect, useState } from 'react';

import { apiClient, ApiError } from '@/lib/api-client';

/**
 * OutfitsTab — Bunny Closet catalog management (2026-07-30).
 *
 * Lists the outfits currently in R2's video-manifest and publishes new ones.
 * Publishing = one 3-asset combo per outfit, all named after the display name:
 *   <Name>.webp (closet thumb) / <Name>-Bunny.webp (worn preview) /
 *   <Name>.mov (transparent Home loop video).
 *
 * Upload flow: presign → browser PUTs the 3 files straight to R2 (videos are
 * too big for the serverless body limit) → commit verifies all 3 landed and
 * merges the manifest entry. The mobile app reads the manifest at runtime, so
 * a published outfit is live in the app immediately — no app release.
 */

type OutfitRow = {
  key: string;
  name: string;
  price: number;
  plusOnly: boolean;
  thumbUrl: string;
  bunnyUrl: string;
  videoUrl: string;
};

type GetResponse = { success: boolean; outfits?: OutfitRow[]; error?: string };
type PresignResponse = {
  success: boolean;
  uploads?: Record<'thumb' | 'bunny' | 'video', { url: string; contentType: string }>;
  error?: string;
};
type CommitResponse = { success: boolean; error?: string };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}: ${JSON.stringify(e.body)}`;
  return e instanceof Error ? e.message : 'Network error';
}

export default function OutfitsTab() {
  const [loading, setLoading] = useState(true);
  const [outfits, setOutfits] = useState<OutfitRow[]>([]);

  // upload form
  const [name, setName] = useState('');
  const [price, setPrice] = useState('500');
  const [plusOnly, setPlusOnly] = useState(false);
  const [thumb, setThumb] = useState<File | null>(null);
  const [bunny, setBunny] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiClient.get<GetResponse>('/api/admin/outfits');
      if (d.success && d.outfits) setOutfits(d.outfits);
      else alert(d.error || 'Failed to load outfits');
    } catch (e) {
      alert(errMsg(e));
    }
    setLoading(false);
  };

  const validate = (): string | null => {
    if (!name.trim()) return 'Enter the outfit name.';
    const p = Number(price);
    if (!Number.isInteger(p) || p <= 0) return 'Price must be a positive integer.';
    if (!thumb || !bunny || !video) return 'Pick all three files.';
    if (!thumb.name.endsWith('.webp') || thumb.size > MAX_IMAGE_BYTES) return 'Thumb must be .webp ≤ 2MB.';
    if (!bunny.name.endsWith('.webp') || bunny.size > MAX_IMAGE_BYTES) return 'Bunny preview must be .webp ≤ 2MB.';
    if (!video.name.endsWith('.mov') || video.size > MAX_VIDEO_BYTES) return 'Video must be .mov ≤ 100MB.';
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
      const pre = await apiClient.post<PresignResponse>('/api/admin/outfits/presign', {
        name: name.trim(),
      });
      if (!pre.success || !pre.uploads) throw new Error(pre.error || 'presign failed');

      const files: ['thumb' | 'bunny' | 'video', File][] = [
        ['thumb', thumb as File],
        ['bunny', bunny as File],
        ['video', video as File],
      ];
      for (const [kind, file] of files) {
        setPhase(`Uploading ${kind} (${(file.size / 1024 / 1024).toFixed(1)}MB)…`);
        const u = pre.uploads[kind];
        const resp = await fetch(u.url, {
          method: 'PUT',
          headers: { 'Content-Type': u.contentType },
          body: file,
        });
        if (!resp.ok) throw new Error(`R2 upload failed for ${kind}: HTTP ${resp.status}`);
      }

      setPhase('Publishing to manifest…');
      const commit = await apiClient.post<CommitResponse>('/api/admin/outfits', {
        name: name.trim(),
        price: Number(price),
        plusOnly,
      });
      if (!commit.success) throw new Error(commit.error || 'commit failed');

      setPhase(null);
      setName('');
      setThumb(null);
      setBunny(null);
      setVideo(null);
      setPlusOnly(false);
      alert('Outfit published — live in the app now.');
      void load();
    } catch (e) {
      setPhase(null);
      alert(errMsg(e));
    }
  };

  const remove = async (o: OutfitRow) => {
    if (!confirm(`Remove "${o.name}" from the closet? Files stay in R2; users who bought it keep the unlock.`)) return;
    try {
      const d = await apiClient.delete<CommitResponse>('/api/admin/outfits', { key: o.key });
      if (!d.success) alert(d.error || 'Failed to remove');
      void load();
    } catch (e) {
      alert(errMsg(e));
    }
  };

  if (loading) return <div className="text-black">Loading outfits...</div>;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-black">Bunny Closet Outfits</h2>
        <p className="text-sm text-gray-500 mt-1">
          One combo = 3 files named after the outfit: Name.webp (closet thumb),
          Name-Bunny.webp (worn preview), Name.mov (transparent Home loop).
          Publishing updates the R2 manifest — live in the app instantly, no release.
        </p>
      </div>

      {/* upload form */}
      <div className="bg-white border rounded-lg p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Outfit name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Granny Sweater"
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FilePick label="Closet thumb (Name.webp)" accept=".webp" file={thumb} onPick={setThumb} />
          <FilePick label="Worn preview (Name-Bunny.webp)" accept=".webp" file={bunny} onPick={setBunny} />
          <FilePick label="Home video (Name.mov)" accept=".mov,video/quicktime" file={video} onPick={setVideo} />
        </div>

        <button
          onClick={() => void publish()}
          disabled={phase !== null}
          className="bg-black text-white rounded px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {phase ?? 'Publish Outfit'}
        </button>
      </div>

      {/* catalog list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {outfits.map((o) => (
          <div key={o.key} className="bg-white border rounded-lg p-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.thumbUrl} alt={o.name} className="w-16 h-16 object-contain bg-amber-50 rounded" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.bunnyUrl} alt={`${o.name} worn`} className="w-16 h-16 object-contain bg-amber-50 rounded" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-black truncate">
                {o.name}
                {o.plusOnly && (
                  <span className="ml-2 text-[10px] font-bold text-amber-600 border border-amber-400 rounded px-1 py-0.5 align-middle">
                    PLUS
                  </span>
                )}
              </div>
              <div className="text-sm text-green-700 font-semibold">🍀 {o.price}</div>
              <a href={o.videoUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">
                video
              </a>
            </div>
            <button onClick={() => void remove(o)} className="text-xs text-red-600 border border-red-300 rounded px-2 py-1">
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
        {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)` : 'Choose file…'}
      </span>
    </label>
  );
}
