'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

import { apiClient, ApiError } from '@/lib/api-client';

/**
 * AssetsTab -- Stage B2.
 *
 * Admin UI to upload / replace the 6 product images served from R2.
 * On save, the backend (/api/admin/product-assets POST) writes the
 * binary to R2 and updates productAssets[] inside the manifest, so
 * mobile clients pick up the new version on their next launch via
 * the existing size-based cache-busting in asset-cache.ts (Stage B4
 * will extend that pipeline to know about productAssets).
 *
 * UX:
 *   - 6 cards in a 2-column grid, one per asset.
 *   - Each card: current R2 preview (broken-state fallback for
 *     not-yet-uploaded assets), size, "Updated X ago", Upload button.
 *   - Upload flow: file picker -> pending preview shown inline with
 *     Confirm + Cancel. Confirm sends multipart to the backend; the
 *     whole tab refetches on success.
 *   - File validation client-side (type + 500KB) gives instant
 *     feedback; backend re-validates as defense-in-depth.
 */

type Asset = {
  id: string;
  filename: string;
  publicUrl: string;
  uploaded: boolean;
  size: number | null;
  updatedAt: string | null;
};

type GetResponse = { success: boolean; assets?: Asset[]; error?: string };
type PostResponse = {
  success: boolean;
  asset?: Asset;
  error?: string;
};

const ASSET_LABELS: Record<string, string> = {
  'product-book-cover': 'Book Cover',
  'product-cards-cover': 'Cards Cover',
  'product-book-hero': 'Book Hero',
  'product-cards-hero': 'Cards Hero',
  'product-book-detail-1': 'Book Detail 1',
  'product-cards-detail-1': 'Cards Detail 1',
};

const MAX_FILE_BYTES = 500 * 1024;

function formatBytes(n: number | null): string {
  if (n === null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never uploaded';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export default function AssetsTab() {
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiClient.get<GetResponse>('/api/admin/product-assets');
      if (d.success && d.assets) {
        setAssets(d.assets);
      } else {
        alert(d.error || 'Failed to load product assets');
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.message}: ${JSON.stringify(e.body)}`
          : e instanceof Error
            ? e.message
            : 'Network error';
      alert(msg);
    }
    setLoading(false);
  };

  if (loading) {
    return <div className="text-black">Loading product assets...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-black">Product Assets</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage the 6 product images served from R2. Mobile clients pull
          updates automatically on next launch via the manifest
          cache-busting flow. Max file size: 500 KB. Format: .webp only.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assets.map((a) => (
          <AssetCard key={a.id} asset={a} onUploaded={load} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// AssetCard -- one card per asset, self-contained upload state
// ============================================================

function AssetCard({
  asset,
  onUploaded,
}: {
  asset: Asset;
  onUploaded: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);

  const label = ASSET_LABELS[asset.id] ?? asset.id;

  const onPick = () => {
    inputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'image/webp') {
      alert(`File type ${f.type} not allowed. Expected .webp`);
      // Reset the input so the user can pick the same file again
      // after correcting it.
      e.target.value = '';
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      alert(`File too large: ${formatBytes(f.size)}. Max 500 KB.`);
      e.target.value = '';
      return;
    }
    // Revoke previous preview URL to avoid memory leak.
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(f);
    setPendingPreviewUrl(URL.createObjectURL(f));
    // Reset input so the same file can be re-picked if the user
    // cancels and reselects.
    e.target.value = '';
  };

  const onCancel = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
  };

  const onConfirm = async () => {
    if (!pendingFile || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      fd.append('assetKey', asset.id);
      const d = await apiClient.post<PostResponse>(
        '/api/admin/product-assets',
        fd,
      );
      if (d.success && d.asset) {
        if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
        setPendingFile(null);
        setPendingPreviewUrl(null);
        await onUploaded();
      } else {
        alert(d.error || 'Upload failed');
      }
    } catch (e) {
      if (e instanceof ApiError) {
        // Server error -- body usually has { error: '...' }.
        const body = e.body as { error?: string } | undefined;
        alert(body?.error || e.message);
      } else {
        alert(e instanceof Error ? e.message : 'Upload failed');
      }
    }
    setUploading(false);
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-black">{label}</h3>
        <span className="text-xs text-gray-400 font-mono">{asset.filename}</span>
      </div>

      {/* Current asset preview */}
      <div className="aspect-square bg-gray-50 rounded-lg overflow-hidden mb-3 flex items-center justify-center">
        {asset.uploaded ? (
          <img
            src={`${asset.publicUrl}?v=${asset.size ?? 0}`}
            alt={label}
            className="w-full h-full object-contain"
            onError={(e) => {
              // Hide broken image -- shouldn't happen if backend manifest
              // is in sync with R2, but defensive.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className="text-gray-400 text-sm">No image uploaded</span>
        )}
      </div>

      {/* Metadata */}
      <div className="text-xs text-gray-500 mb-3 space-y-0.5">
        <p>
          Size: <span className="text-black">{formatBytes(asset.size)}</span>
        </p>
        <p>
          Updated:{' '}
          <span className="text-black">{formatRelative(asset.updatedAt)}</span>
        </p>
      </div>

      {/* Pending upload preview */}
      {pendingFile && pendingPreviewUrl ? (
        <div className="border border-orange-300 bg-orange-50 rounded-lg p-3 mb-3">
          <p className="text-xs text-orange-700 font-medium mb-2">
            Pending: {pendingFile.name} ({formatBytes(pendingFile.size)})
          </p>
          <div className="aspect-square bg-white rounded mb-2 overflow-hidden flex items-center justify-center">
            <img
              src={pendingPreviewUrl}
              alt="Pending"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              disabled={uploading}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${
                uploading
                  ? 'bg-gray-200 text-gray-400'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {uploading ? 'Uploading...' : 'Confirm Upload'}
            </button>
            <button
              onClick={onCancel}
              disabled={uploading}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-black hover:bg-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onPick}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 hover:bg-blue-200"
        >
          Upload New Image
        </button>
      )}

      {/* Hidden file input -- triggered by Upload button */}
      <input
        ref={inputRef}
        type="file"
        accept="image/webp"
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}
