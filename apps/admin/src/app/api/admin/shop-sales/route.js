import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { shopPreview } from '@/lib/burrow-shop-pricing';
import { salesQuery, summarizeSales } from '@/lib/shop-sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request) {
  const auth = await requireAdmin(); if (auth.error) return auth.error;
  const query = salesQuery(new URL(request.url).searchParams);
  if (!query) return reply({ error: 'invalid_filters' }, 400);
  try {
    const { data, error } = await createAdminClient().rpc('admin_shop_sales_v1', query);
    if (error || !Array.isArray(data?.rows)) throw Error('Sales query failed');
    const rows = data.rows.map(row => ({ ...row, preview: row.item_status === 'active'
      ? shopPreview({ ...row, stable_id: row.item_id }) : null }));
    return reply({ ...summarizeSales(rows), rows, since: query.p_since, until: query.p_until, kind: query.p_kind });
  } catch {
    return reply({ error: 'shop_sales_unavailable', message: 'Purchase statistics are unavailable. Please retry or check migration 248.' }, 503);
  }
}
