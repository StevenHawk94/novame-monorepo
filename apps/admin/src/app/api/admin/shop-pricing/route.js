import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { SHOP_CATEGORIES, shopPreview, shopAppVersion, validateShopPriceBatch } from '@/lib/burrow-shop-pricing';
import gameDetails from '@/generated/game-details.json';

export const runtime = 'nodejs';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  const auth = await requireAdmin(); if (auth.error) return auth.error;
  try {
    const db = createAdminClient();
    const { data: config, error: configError } = await db.from('app_config').select('value').eq('key', 'app_major_update_content_revision').single();
    if (configError || !config?.value) throw Error('No live content revision');
    const { data: rows, error } = await db.from('catalog_items')
      .select('stable_id,category,item_type,title,description,price,plus_only,tradable,metadata,asset,shop_price_version,updated_at')
      .eq('revision_id', config.value).eq('status', 'active').in('category', SHOP_CATEGORIES)
      .order('category').order('stable_id').limit(2000);
    if (error) throw error;
    const { data: history, error: historyError } = await db.from('burrow_shop_price_audit')
      .select('id,batch_id,item_id,old_price,new_price,old_plus_only,new_plus_only,version,admin_email,reason,created_at')
      .order('id', { ascending: false }).limit(100);
    if (historyError) throw historyError;
    return reply({ appVersion: shopAppVersion, rows: rows.map(row => ({ ...row, preview: shopPreview(row),
      questions: row.item_type==='game' ? gameDetails[row.metadata?.gameId] ?? [] : undefined,
      editable: (row.price > 0 || row.item_type==='game' && row.price===0) && !row.metadata?.starter && ['decor', 'outfit', 'game', 'surprise'].includes(row.item_type) })), history });
  } catch { return reply({ error: 'shop_pricing_unavailable', message: 'Product settings are unavailable. Check migrations 224, 226 and 227.' }, 503); }
}
export async function POST(request) {
  const auth = await requireAdmin(); if (auth.error) return auth.error;
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'invalid_origin' }, 403);
  try {
    const raw = await request.text(); if (raw.length > 50000) return reply({ error: 'too_large' }, 413);
    const input = JSON.parse(raw);
    if (!validateShopPriceBatch(input)) return reply({ error: 'invalid_request' }, 400);
    const { data, error } = await createAdminClient().rpc('set_burrow_shop_prices_v1', {
      p_admin: auth.user.id, p_email: auth.user.email, p_updates: input.updates, p_reason: input.reason?.trim() || null,
    });
    if (error) return reply({ error: 'price_save_failed' }, 503);
    return reply(data, data.error === 'price_conflict' ? 409 : data.error ? 400 : 200);
  } catch { return reply({ error: 'invalid_request' }, 400); }
}
