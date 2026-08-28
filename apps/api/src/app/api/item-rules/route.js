import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'
import { readItemRules } from '@/lib/item-rule-store'
import { ITEM_CATALOG_VERSION } from '@novame/engine'
export const runtime = 'nodejs'
export async function GET(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!await verifyToken(token)) return NextResponse.json({ error:'Unauthorized' }, { status:401 })
  if (new URL(request.url).searchParams.get('catalog') !== ITEM_CATALOG_VERSION) return NextResponse.json({ error:'catalog_version_mismatch' }, { status:409 })
  try { return NextResponse.json(await readItemRules(serviceClient()), { headers: { 'Cache-Control':'private, no-store' } }) }
  catch { return NextResponse.json({ error:'rules_unavailable' }, { status:503 }) }
}
