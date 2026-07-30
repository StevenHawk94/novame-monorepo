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
 * /api/admin/scenes — Home scene ("Maps") catalog management (2026-07-30).
 *
 * The scene catalog lives in R2's video-manifest.json under `scenes`; the
 * mobile app reads it at runtime, so publishing here goes live without an
 * app release. Each scene is an asset pair at fixed keys derived from the
 * display name (spaces → dashes):
 *   Maps/<Stem>.webp        home background
 *   Maps/<Stem>-Small.webp  Unlock New Scenes grid thumb
 *
 * Upload flow (see ./presign): browser PUTs the two files straight to R2,
 * then POSTs here to verify both landed and merge the catalog entry. New
 * entries append to the END of the list — the app renders left-to-right
 * in publish order.
 *
 * GET    → { scenes: [entry + publicUrls] }
 * POST   → body { name, price, plusOnly } — verify assets, upsert entry
 * DELETE → body { key } — remove entry from the catalog (files stay in R2)
 */

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const manifest = await r2GetManifest();
    const base = getPublicUrl();
    const scenes = (manifest.scenes ?? []).map((s) => ({
      ...s,
      imageUrl: `${base}/${encodeKey(s.image)}`,
      thumbUrl: `${base}/${encodeKey(s.thumb)}`,
    }));
    return NextResponse.json({ success: true, scenes });
  } catch (e) {
    console.error('[admin/scenes] GET:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to load scenes' }, { status: 500 });
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

    const stem = trimmed.replace(/\s+/g, '-');
    const image = `Maps/${stem}.webp`;
    const thumb = `Maps/${stem}-Small.webp`;
    const heads = await Promise.all([r2HeadObject(image), r2HeadObject(thumb)]);
    const missing = ['background', 'small thumb'].filter((_, i) => !heads[i]);
    if (missing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Assets not uploaded yet: ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    const entry = {
      key: stem.toLowerCase(),
      name: trimmed,
      price: priceNum,
      plusOnly: !!plusOnly,
      image,
      thumb,
    };

    const manifest = await r2GetManifest();
    const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
    const idx = scenes.findIndex((s) => s.key === entry.key);
    if (idx >= 0) scenes[idx] = entry;
    else scenes.push(entry);
    manifest.scenes = scenes;
    manifest.scenesUpdatedAt = new Date().toISOString();
    await r2PutManifest(manifest);

    return NextResponse.json({ success: true, scene: entry });
  } catch (e) {
    console.error('[admin/scenes] POST:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to publish scene' }, { status: 500 });
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
    const before = (manifest.scenes ?? []).length;
    manifest.scenes = (manifest.scenes ?? []).filter((s) => s.key !== key);
    if (manifest.scenes.length === before) {
      return NextResponse.json({ success: false, error: 'Scene not found' }, { status: 404 });
    }
    manifest.scenesUpdatedAt = new Date().toISOString();
    await r2PutManifest(manifest);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[admin/scenes] DELETE:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to remove scene' }, { status: 500 });
  }
}
