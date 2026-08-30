import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { compileItemBatch, newItemBatchVersion } from '@/lib/item-manifest';
import { r2PresignPut } from '@/lib/r2-client';

export const runtime = 'nodejs';

export async function POST(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { rows } = await request.json();
    const batchVersion = newItemBatchVersion();
    const result = await compileItemBatch(rows, batchVersion, null);
    if (result.errors.length) return NextResponse.json({ success: false, errors: result.errors }, { status: 400 });
    const uploads = {};
    for (const item of result.compiled) {
      uploads[item.imageFile] = {
        itemId: item.itemId,
        imageKey: item.imageKey,
        url: await r2PresignPut({ key: item.imageKey, contentType: 'image/webp', expiresIn: 3600 }),
        contentType: 'image/webp',
      };
    }
    return NextResponse.json({
      success: true, batchVersion, baseVersion: result.baseVersion,
      rows: result.compiled.map(({ keywordSafety, ...item }) => ({ ...item, safetyCount: keywordSafety.length })),
      uploads,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
