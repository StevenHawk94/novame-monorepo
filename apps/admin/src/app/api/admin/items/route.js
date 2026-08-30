import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { loadCurrentItemManifest } from '@/lib/item-manifest';

export const runtime = 'nodejs';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const current = await loadCurrentItemManifest();
    return NextResponse.json({
      success: true,
      version: current.version,
      publishedAt: current.manifest?.publishedAt ?? null,
      items: current.manifest?.items ?? [],
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
