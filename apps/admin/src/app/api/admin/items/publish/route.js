import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { compileItemBatch, publishItemManifest } from '@/lib/item-manifest';
import { r2HeadObject } from '@/lib/r2-client';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { rows, batchVersion, baseVersion } = await request.json();
    const result = await compileItemBatch(rows, batchVersion, baseVersion);
    if (result.errors.length) return NextResponse.json({ success: false, errors: result.errors }, { status: 400 });
    for (const item of result.compiled) {
      const head = await r2HeadObject(item.imageKey);
      if (!head || !head.size || head.size > 2 * 1024 * 1024 || head.contentType !== 'image/webp') {
        throw new Error(`${item.imageFile} is missing, empty, larger than 2MB, or not image/webp.`);
      }
    }
    const manifest = await publishItemManifest(batchVersion, result.nextItems);
    return NextResponse.json({ success: true, version: manifest.version, itemCount: manifest.items.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  }
}
