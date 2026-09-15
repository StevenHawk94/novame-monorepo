import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getPublicUrl } from '@/lib/r2-client';
import { loadCurrentItemManifest } from '@/lib/item-manifest';
import { buildAdminItemCatalog, findAdminItem, queryAdminItemCatalog } from '@/lib/item-catalog';
import { publishManualRule, reviewSnapshot } from '@/lib/item-review';
import { buildAutoKeywordTemplateCsv, compileAutoKeywordBatchCsv } from '@/lib/item-keyword-batch';
import { ITEM_CATALOG_VERSION } from '@novame/engine';

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
    if (query.get('export') === 'auto-keyword-template') {
      return new NextResponse(buildAutoKeywordTemplateCsv(catalog), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="memory-item-auto-keywords.csv"',
          'Cache-Control': 'no-store',
        },
      });
    }
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

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  try {
    const input = await request.json();
    if (!['preview', 'apply'].includes(input.action)) throw new Error('Invalid batch action.');
    if (typeof input.csv !== 'string') throw new Error('Choose the completed CSV template.');
    const client = db();
    const catalog = await loadCatalog(client);
    const batch = compileAutoKeywordBatchCsv(input.csv, catalog);
    if (batch.errors.length) {
      return NextResponse.json({ success:false, ...batch }, { status:400 });
    }
    const summary = {
      additions:batch.additions,
      skipped:batch.skipped,
      iconCount:new Set(batch.additions.map((row) => row.itemId)).size,
      keywordCount:batch.additions.length,
      revision:catalog.revision,
    };
    if (input.action === 'preview') return NextResponse.json({ success:true, ...summary });
    if (Number(input.revision) !== catalog.revision) {
      throw new Error('Rules changed after Preview. Download/preview the file again before applying.');
    }
    if (!batch.additions.length) throw new Error('This file contains no new AUTO keywords to add.');
    const { data, error } = await client.rpc('publish_item_rules_batch', {
      p_catalog:ITEM_CATALOG_VERSION,
      p_rules:batch.additions.map((row) => ({ keyword:row.keyword, item_id:row.itemId })),
      p_expected_revision:catalog.revision,
      p_admin:auth.user.id,
    });
    if (error) throw error;
    return NextResponse.json({ success:true, ...summary, revision:data?.revision, applied:data?.count });
  } catch (error) {
    return NextResponse.json({ success:false, error:error.message }, { status:409 });
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
