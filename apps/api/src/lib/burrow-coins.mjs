import { createHash } from 'node:crypto'
import { decodeTransaction } from 'app-store-server-api'
import { GoogleAuth } from 'google-auth-library'

export const COIN_PRODUCTS = Object.freeze({'burrow.coin.200':200,'burrow.coin.400':400,'burrow.coin.1000':1000})
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const fail = (code, status = 400) => { throw Object.assign(new Error(code), {status}) }
export const coinProduct = id => Object.hasOwn(COIN_PRODUCTS, id ?? '')
function environment(value) {
  const expected = process.env.BURROW_IAP_ENVIRONMENT
  if (!['sandbox','production'].includes(expected)) fail('store_not_configured',503)
  if (value !== expected) fail('store_environment_mismatch')
  return value
}
export function appleCoin(tx, expectedUser, notification = null) {
  if (!coinProduct(tx?.productId) || tx.type !== 'Consumable' || tx.bundleId !== 'com.novame.app') fail('invalid_store_transaction')
  if (!uuid(tx.appAccountToken) || (expectedUser && tx.appAccountToken.toLowerCase() !== expectedUser.toLowerCase())) fail('purchase_account_conflict',409)
  if (!Number.isSafeInteger(tx.quantity) || tx.quantity < 1 || tx.quantity > 100 || !/^\d+$/.test(tx.transactionId ?? '')) fail('invalid_store_transaction')
  const signed = notification?.signedDate ?? tx.signedDate
  if (!Number.isFinite(Number(signed)) || Number(signed) <= 0) fail('invalid_store_transaction')
  const refunded = notification?.notificationType === 'REFUND_REVERSED' ? 0
    : tx.revocationDate || ['REFUND','REVOKE'].includes(notification?.notificationType) ? tx.quantity : 0
  return {p_user_id:tx.appAccountToken.toLowerCase(),p_store:'apple',p_environment:environment(tx.environment === 'Sandbox' ? 'sandbox' : tx.environment === 'Production' ? 'production' : ''),
    p_credential:String(tx.transactionId),p_product_id:tx.productId,p_quantity:tx.quantity,p_refunded:refunded,p_signed_at:new Date(Number(signed)).toISOString()}
}
export function googleCoin(data, token, expectedUser, productId) {
  const line = data?.productLineItem?.[0]
  if (data?.productLineItem?.length !== 1 || !coinProduct(line?.productId) || (productId && line.productId !== productId)) fail('invalid_store_transaction')
  const user = data.obfuscatedExternalProfileId
  if (!uuid(user) || (expectedUser && user !== expectedUser) || data.obfuscatedExternalAccountId !== createHash('sha256').update(`novame:${user}`).digest('hex')) fail('purchase_account_conflict',409)
  const state = data.purchaseStateContext?.purchaseState
  if (state === 'PENDING') fail('purchase_pending',409)
  if (!['PURCHASED','CANCELLED'].includes(state)) fail('invalid_store_transaction')
  const quantity = line.productOfferDetails?.quantity
  const refundable = line.productOfferDetails?.refundableQuantity
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || !Number.isSafeInteger(refundable) || refundable < 0 || refundable > quantity) fail('invalid_store_transaction')
  return {p_user_id:user,p_store:'google',p_environment:environment(data.testPurchaseContext ? 'sandbox' : 'production'),
    p_credential:createHash('sha256').update(token).digest('hex'),p_product_id:line.productId,p_quantity:quantity,
    p_refunded:state === 'CANCELLED' ? quantity : quantity-refundable,p_signed_at:new Date().toISOString()}
}
export async function applyCoin(supabase, args, webhook = false) {
  const {data,error} = await supabase.rpc('apply_burrow_coin_purchase_v1',args)
  if (error) fail('purchase_credit_unavailable',503)
  // Account deletion must not make a store retry forever; the receipt tombstone
  // still prevents anyone else claiming it. Never ignore conflicts for clients.
  if (webhook && data?.error === 'profile_not_found') return {deleted:true}
  if (webhook && data?.error === 'purchase_account_conflict') {
    const profile = await supabase.from('profiles').select('id').eq('id',args.p_user_id).maybeSingle()
    if (!profile.error && !profile.data) return {deleted:true}
  }
  if (data?.error) fail(data.error,409)
  if (!data) fail('purchase_credit_unavailable',503)
  return data
}
async function googleAccessToken() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT
  let credentials
  try { credentials = raw ? JSON.parse(raw) : {client_email:process.env.GOOGLE_PLAY_SA_EMAIL,private_key:process.env.GOOGLE_PLAY_SA_PRIVATE_KEY?.replace(/\\n/g,'\n')} } catch { fail('store_not_configured',503) }
  if (!credentials?.client_email || !credentials.private_key) fail('store_not_configured',503)
  const auth = new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/androidpublisher']})
  const token = await auth.getAccessToken()
  if (!token) fail('store_unavailable',503)
  return token
}
export async function verifyGoogleCoin(supabase, token, expectedUser, productId, webhook = false) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 12000) fail('invalid_request')
  const access = await googleAccessToken()
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.burrow.app/purchases`
  const headers = {Authorization:`Bearer ${access}`}
  const response = await fetch(`${base}/productsv2/tokens/${encodeURIComponent(token)}`,{headers,signal:AbortSignal.timeout(15000)})
  if (!response.ok) fail('store_verification_unavailable',503)
  const purchase = await response.json()
  if (webhook && purchase.productLineItem?.length === 1 && !coinProduct(purchase.productLineItem[0].productId)) return {ignored:true}
  if (webhook && purchase.purchaseStateContext?.purchaseState === 'PENDING') return {pending:true}
  const args = googleCoin(purchase,token,expectedUser,productId)
  const result = await applyCoin(supabase,args,webhook)
  // Server consumption closes the grant/acknowledge gap. Duplicate attempts
  // re-read authoritative consumption state before trying again.
  if (purchase.purchaseStateContext.purchaseState === 'PURCHASED' && purchase.productLineItem[0].productOfferDetails.consumptionState !== 'CONSUMPTION_STATE_CONSUMED') {
    const consumed = await fetch(`${base}/products/${encodeURIComponent(args.p_product_id)}/tokens/${encodeURIComponent(token)}:consume`,{method:'POST',headers,signal:AbortSignal.timeout(15000)})
    if (!consumed.ok) fail('purchase_acknowledgement_pending',503)
  }
  return result
}
export async function verifyAppleCoin(supabase, jws, user, product) {
  let tx
  try { tx = await decodeTransaction(jws) } catch { fail('invalid_store_signature') }
  const args = appleCoin(tx,user)
  if (product !== args.p_product_id) fail('invalid_store_transaction')
  return applyCoin(supabase,args)
}
