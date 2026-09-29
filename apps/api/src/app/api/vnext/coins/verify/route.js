import { NextResponse } from 'next/server'
import { authenticatedUserId,appMajorUpdateServiceClient,majorUpdateEnabled } from '@/lib/app-major-update'
import { coinProduct,verifyAppleCoin,verifyGoogleCoin } from '@/lib/burrow-coins.mjs'
export const runtime = 'nodejs'
export async function GET(request) {
  const headers = {'Cache-Control':'no-store'}
  try {
    if (!await authenticatedUserId(request)) return NextResponse.json({error:'Unauthorized'},{status:401,headers})
    const platform = new URL(request.url).searchParams.get('platform')
    const db = appMajorUpdateServiceClient()
    const enabled = process.env.BURROW_COIN_PURCHASES_ENABLED === 'true'
      && ['production','sandbox'].includes(process.env.BURROW_IAP_ENVIRONMENT)
      && await majorUpdateEnabled(db)
      && (platform === 'ios' || (platform === 'android' && process.env.GOOGLE_PUBSUB_REQUIRE_AUTH === 'true'
        && !!process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE && !!process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL
        && !!(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT || (process.env.GOOGLE_PLAY_SA_EMAIL && process.env.GOOGLE_PLAY_SA_PRIVATE_KEY))))
    if (!enabled) return NextResponse.json({available:false},{headers})
    const schema = await db.from('burrow_coin_transactions').select('product_id').limit(1)
    return NextResponse.json({available:!schema.error},{headers})
  } catch { return NextResponse.json({available:false},{headers}) }
}
export async function POST(request) {
  try {
    const user = await authenticatedUserId(request)
    if (!user) return NextResponse.json({error:'Unauthorized'},{status:401})
    const raw = await request.text()
    if (raw.length > 32000) return NextResponse.json({error:'invalid_request'},{status:400})
    let body
    try { body = JSON.parse(raw) } catch { return NextResponse.json({error:'invalid_request'},{status:400}) }
    if (!coinProduct(body?.productId) || !['ios','android'].includes(body?.platform) || typeof body?.purchaseToken !== 'string' || !body.purchaseToken || body.purchaseToken.length > 24000)
      return NextResponse.json({error:'invalid_request'},{status:400})
    // Always settle an already-paid transaction, even during a feature rollback.
    const db = appMajorUpdateServiceClient()
    const result = body.platform === 'ios' ? await verifyAppleCoin(db,body.purchaseToken,user,body.productId)
      : await verifyGoogleCoin(db,body.purchaseToken,user,body.productId)
    return NextResponse.json({success:true,...result})
  } catch (error) {
    return NextResponse.json({error:error.status ? error.message : 'store_unavailable'},{status:error.status || 503})
  }
}
