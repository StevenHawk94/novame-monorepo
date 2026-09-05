import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getPublicUrl } from '@/lib/r2-client';
import { loadCurrentItemManifest } from '@/lib/item-manifest';
import { buildAdminItemCatalog, findAdminItem, queryAdminItemCatalog } from '@/lib/item-catalog';
import { publishManualRule, reviewSnapshot } from '@/lib/item-review';

export const runtime = 'nodejs';

let remoteCache = null;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loadCatalog(client) {
  const now = Date.now();
  const remotePromise = remoteCache && now - remoteCache.at < 60_000
    ? Promise.resolve(remoteCache.value)
    : loadCurrentItemManifest().then((value) => {
      remoteCache = { at: Date.now(), value };
      return value;
    });
  const [remote, snapshot] = await Promise.all([
    remotePromise,
    reviewSnapshot(client),
  ]);
  return buildAdminItemCatalog({
    remoteManifest: remote.manifest,
    snapshot,
    publicUrl: remote.manifest?.items?.length ? getPublicUrl() : '',
  });
}

export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  try {
    const query = new URL(request.url).searchParams;
    const catalog = await loadCatalog(db());
    const itemId = query.get('itemId');
    if (itemId) {
      const result = findAdminItem(catalog, itemId);
      if (!result) return NextResponse.json({ success: false, error: 'Icon not found.' }, { status: 404 });
      return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({
      success: true,
      ...queryAdminItemCatalog(catalog, {
        q: query.get('q') || '',
        category: query.get('category') || '',
        page: query.get('page') || 1,
        limit: query.get('limit') || 120,
      }),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  try {
    const input = await request.json();
    const revision = await publishManualRule(db(), input, auth.user.id);
    return NextResponse.json({ success: true, revision });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  }
}
