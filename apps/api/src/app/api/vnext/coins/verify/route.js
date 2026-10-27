import { after,NextResponse } from 'next/server'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
import {drainStoreFinishJobs} from '@/lib/store-finish-jobs.mjs'
import { authenticatedUserId,appMajorUpdateServiceClient,majorUpdateEnabled } from '@/lib/app-major-update'
import { coinProduct,verifyAppleCoin,verifyGoogleCoin } from '@/lib/burrow-coins.mjs'
import { readRewardWallet } from '@/lib/burrow-reward-wallet.mjs'
export const runtime = 'nodejs'
export const maxDuration=60
export async function GET(request) {
  const headers = {'Cache-Control':'no-store'}
  try {
    const user = await authenticatedUserId(request)
    if (!user) return NextResponse.json({error:'Unauthorized'},{status:401,headers})
    const platform = new URL(request.url).searchParams.get('platform')
    const db = appMajorUpdateServiceClient()
    await securityRateLimit(db,request,user,'coins-verify-read',120,60)
    const enabled = process.env.BURROW_COIN_PURCHASES_ENABLED === 'true'
      && (process.env.BURROW_COIN_PURCHASE_PLATFORMS || 'ios,android').split(',').map(p=>p.trim()).includes(platform)
      && await majorUpdateEnabled(db)
      && ((platform === 'ios' && !!process.env.APPLE_APP_ID && !!process.env.APPLE_IAP_PRIVATE_KEY && !!process.env.APPLE_IAP_KEY_ID && !!process.env.APPLE_IAP_ISSUER_ID) || (platform === 'android' && process.env.GOOGLE_PUBSUB_REQUIRE_AUTH === 'true'
        && !!process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE && !!process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL
        && !!(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT || (process.env.GOOGLE_PLAY_SA_EMAIL && process.env.GOOGLE_PLAY_SA_PRIVATE_KEY))))
    if (!enabled) return NextResponse.json({available:false},{headers})
    const schema = await db.from('burrow_coin_transactions').select('product_id').limit(1)
    const domain = await db.rpc('economic_domain_v1',{p_user:user})
    if(domain.error||!['production','sandbox'].includes(domain.data))return NextResponse.json({available:false},{headers})
    // Both store environments are verified, then admitted independently in
    // PostgreSQL. A global Sandbox switch cannot disable legitimate live IAP.
    return NextResponse.json({available:!schema.error,environment:domain.data,wallet:'room'},{headers})
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
    await securityRateLimit(db,request,user,'coins-verify',30,60)
    const result = body.platform === 'ios' ? await verifyAppleCoin(db,body.purchaseToken,user,body.productId)
      : await verifyGoogleCoin(db,body.purchaseToken,user,body.productId)
    const coinState = result.wallet === 'room' ? await readRewardWallet(db,user) : null
    if(result.acknowledgementPending)after(async()=>{try{await drainStoreFinishJobs(db,1)}catch{/* Cron retries the durable job. */}})
    return NextResponse.json({success:true,...result,...(coinState ? {coinState} : {})})
  } catch (error) {
    if(error.retryAfter||error.message==='security_check_unavailable')return securityFailure(error)
    return NextResponse.json({error:error.status ? error.message : 'store_unavailable'},{status:error.status || 503})
  }
}
