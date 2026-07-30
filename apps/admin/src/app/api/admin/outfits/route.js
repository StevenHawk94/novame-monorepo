import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
  getPublicUrl,
  r2GetManifest,
  r2HeadObject,
  r2PutManifest,
} from '@/lib/r2-client';

export const runtime = 'nodejs';

/**
 * /api/admin/outfits — Bunny Closet catalog management (2026-07-30).
 *
 * The outfit catalog lives in R2's video-manifest.json under `outfits`; the
 * mobile app reads it at runtime, so publishing here goes live without an
 * app release. Each outfit is a 3-asset trio at fixed keys derived from the
 * display name:
 *   Outfits/<Name>.webp          closet grid thumb
 *   Outfits/<Name>-Bunny.webp    worn preview
 *   Character Videos/<Name>.mov  transparent Home loop
 *
 * Upload flow (see ./presign): browser PUTs the three files straight to R2
 * with presigned URLs (videos exceed Vercel's body limit), then POSTs here
 * to verify all three landed and merge the catalog entry into the manifest.
 *
 * GET    → { outfits: [entry + publicUrls + video size] }
 * POST   → body { name, price, plusOnly } — verify assets, upsert entry
 * DELETE → body { key } — remove entry from the catalog (files stay in R2)
 */

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function assetKeysFor(name) {
  return {
    thumb: `Outfits/${name}.webp`,
    bunny: `Outfits/${name}-Bunny.webp`,
    video: `Character Videos/${name}.mov`,
  };
}

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const manifest = await r2GetManifest();
    const base = getPublicUrl();
    const outfits = (manifest.outfits ?? []).map((o) => ({
      ...o,
      thumbUrl: `${base}/${encodeKey(o.thumb)}`,
      bunnyUrl: `${base}/${encodeKey(o.bunny)}`,
      videoUrl: `${base}/${encodeKey(o.video)}`,
    }));
    return NextResponse.json({ success: true, outfits });
  } catch (e) {
    console.error('[admin/outfits] GET:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to load outfits' }, { status: 500 });
  }
}

export async function POST(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { name, price, plusOnly } = await request.json();
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9 '&-]{0,40}$/.test(trimmed)) {
      return NextResponse.json({ success: false, error: 'Invalid name' }, { status: 400 });
    }
    const priceNum = Number(price);
    if (!Number.isInteger(priceNum) || priceNum <= 0 || priceNum > 100000) {
      return NextResponse.json({ success: false, error: 'Invalid price' }, { status: 400 });
    }

    // All three assets must exist before the catalog points at them.
    const keys = assetKeysFor(trimmed);
    const heads = await Promise.all([
      r2HeadObject(keys.thumb),
      r2HeadObject(keys.bunny),
      r2HeadObject(keys.video),
    ]);
    const missing = ['thumb', 'bunny', 'video'].filter((_, i) => !heads[i]);
    if (missing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Assets not uploaded yet: ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    const entry = {
      key: slug(trimmed),
      name: trimmed,
      price: priceNum,
      plusOnly: !!plusOnly,
      ...keys,
    };

    const manifest = await r2GetManifest();
    const outfits = Array.isArray(manifest.outfits) ? manifest.outfits : [];
    const idx = outfits.findIndex((o) => o.key === entry.key);
    if (idx >= 0) outfits[idx] = entry;
    else outfits.push(entry);
    manifest.outfits = outfits;
    manifest.outfitsUpdatedAt = new Date().toISOString();
    await r2PutManifest(manifest);

    return NextResponse.json({ success: true, outfit: entry });
  } catch (e) {
    console.error('[admin/outfits] POST:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to publish outfit' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { key } = await request.json();
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing key' }, { status: 400 });
    }
    const manifest = await r2GetManifest();
    const before = (manifest.outfits ?? []).length;
    manifest.outfits = (manifest.outfits ?? []).filter((o) => o.key !== key);
    if (manifest.outfits.length === before) {
      return NextResponse.json({ success: false, error: 'Outfit not found' }, { status: 404 });
    }
    manifest.outfitsUpdatedAt = new Date().toISOString();
    await r2PutManifest(manifest);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[admin/outfits] DELETE:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to remove outfit' }, { status: 500 });
  }
}
