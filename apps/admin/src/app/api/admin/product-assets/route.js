import { NextResponse } from 'next/server';
import {
  r2GetManifest,
  r2PutManifest,
  r2PutObject,
  getPublicUrl,
} from '@/lib/r2-client';
import { requireAdmin } from '@/lib/auth/require-admin';

/**
 * Admin product-assets endpoint -- Stage B1.2.
 *
 * Manages the 6 product images (book-cover, cards-cover, book-hero,
 * cards-hero, book-detail-1, cards-detail-1) that are stored in R2
 * and consumed by the mobile app via the asset cache.
 *
 * Architecture:
 *   - Source of truth: R2 bucket. Each upload writes the binary to
 *     {bucket}/{filename} and updates a productAssets[] array inside
 *     {bucket}/video-manifest.json.
 *   - Mobile clients pull video-manifest.json on launch (existing
 *     asset-cache logic) and detect file changes via size diff.
 *     Stage B2 will add productAssets[] support to that pipeline.
 *
 * GET  -- returns the full list of 6 expected product assets, marked
 *         { uploaded: true, size, updatedAt } when present in the
 *         manifest, or { uploaded: false } when not yet uploaded.
 *
 * POST -- multipart/form-data: { file: File, assetKey: string }
 *         Validates, uploads the file to R2, merges the manifest,
 *         and writes the manifest back.
 *
 * Runtime: Node.js (not edge). The aws-sdk client used internally has
 * Node-only transitive deps. This is the first non-edge admin route;
 * mixed runtimes are fully supported by Next.js on Vercel.
 *
 * Auth: requireAdmin() -- 401/403 on failure.
 */

export const runtime = 'nodejs';

// ============================================================
// Expected asset keys -- whitelist + mapping to R2 filenames
// ============================================================

const ASSET_KEYS = {
  'product-book-cover': 'book-cover.webp',
  'product-cards-cover': 'cards-cover.webp',
  'product-book-hero': 'book-hero.webp',
  'product-cards-hero': 'cards-hero.webp',
  'product-book-detail-1': 'book-detail-1.webp',
  'product-cards-detail-1': 'cards-detail-1.webp',
};

const ALLOWED_KEYS = new Set(Object.keys(ASSET_KEYS));

// ============================================================
// Validation
// ============================================================

const MAX_FILE_BYTES = 500 * 1024; // 500 KB
const ALLOWED_CONTENT_TYPES = new Set(['image/webp']);

// ============================================================
// GET -- list expected assets + their manifest entries
// ============================================================

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    let manifest;
    try {
      manifest = await r2GetManifest();
    } catch (e) {
      // Manifest not readable -- treat as empty. Should not happen in
      // production (manifest already exists from cards/videos era).
      console.error('[product-assets] GET manifest fetch failed:', e?.message);
      manifest = { productAssets: [] };
    }

    const existing = Array.isArray(manifest.productAssets)
      ? manifest.productAssets
      : [];
    const byId = new Map(existing.map((a) => [a.id, a]));

    // Compose the response in the canonical 6-asset order. Each entry
    // gets enriched with its expected filename (so the frontend can
    // build preview URLs even before upload) plus the live manifest
    // data when present.
    const assets = Object.entries(ASSET_KEYS).map(([id, filename]) => {
      const live = byId.get(id);
      return {
        id,
        filename,
        publicUrl: `${getPublicUrl()}/${filename}`,
        uploaded: !!live,
        size: live?.size ?? null,
        updatedAt: live?.updatedAt ?? null,
      };
    });

    return NextResponse.json({ success: true, assets });
  } catch (e) {
    console.error('[product-assets] GET unexpected error:', e?.message);
    return NextResponse.json(
      { success: false, error: e?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

// ============================================================
// POST -- upload + manifest update
// ============================================================

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    // --- 1. Parse multipart body ---
    const formData = await request.formData();
    const file = formData.get('file');
    const assetKey = formData.get('assetKey');

    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing file' },
        { status: 400 },
      );
    }
    if (typeof assetKey !== 'string' || !ALLOWED_KEYS.has(assetKey)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown assetKey: ${assetKey}. Expected one of ${[...ALLOWED_KEYS].join(', ')}`,
        },
        { status: 400 },
      );
    }

    // --- 2. Validate file type + size ---
    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: `File type ${file.type} not allowed. Expected image/webp.`,
        },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const fileSize = bytes.byteLength;
    if (fileSize > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `File too large: ${fileSize} bytes. Max ${MAX_FILE_BYTES}.`,
        },
        { status: 400 },
      );
    }

    const filename = ASSET_KEYS[assetKey];
    const body = new Uint8Array(bytes);

    // --- 3. PUT file to R2 (bucket root, matching cards/videos layout) ---
    const publicUrl = await r2PutObject({
      key: filename,
      body,
      contentType: 'image/webp',
    });

    // --- 4. Fetch + update manifest ---
    // Defensive: any missing or malformed productAssets gets normalized
    // to an empty array so we never accidentally drop video/cards data.
    let manifest;
    try {
      manifest = await r2GetManifest();
    } catch (e) {
      console.error('[product-assets] POST manifest fetch failed:', e?.message);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch manifest before update' },
        { status: 500 },
      );
    }

    if (!Array.isArray(manifest.productAssets)) {
      manifest.productAssets = [];
    }

    const updatedAt = new Date().toISOString();
    const newEntry = {
      id: assetKey,
      filename,
      size: fileSize,
      updatedAt,
    };

    const idx = manifest.productAssets.findIndex((a) => a.id === assetKey);
    if (idx >= 0) {
      manifest.productAssets[idx] = newEntry;
    } else {
      manifest.productAssets.push(newEntry);
    }

    // --- 5. PUT updated manifest back ---
    try {
      await r2PutManifest(manifest);
    } catch (e) {
      console.error('[product-assets] POST manifest write failed:', e?.message);
      // File is already uploaded but manifest write failed. We return
      // an error so the admin user knows the upload is half-applied.
      // The actual R2 file is fine and will be picked up on the next
      // successful manifest write.
      return NextResponse.json(
        {
          success: false,
          error: 'File uploaded to R2 but manifest update failed. Re-upload to retry.',
          partial: { uploadedFile: true, manifestUpdated: false },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      asset: {
        ...newEntry,
        publicUrl,
      },
    });
  } catch (e) {
    console.error('[product-assets] POST unexpected error:', e?.message);
    return NextResponse.json(
      { success: false, error: e?.message || 'Internal error' },
      { status: 500 },
    );
  }
}
