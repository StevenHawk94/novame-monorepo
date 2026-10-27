import {STORE_PRODUCTS,storeFailure} from './apple-store-state.mjs'

/** All subscription entry points commit a verified current snapshot here. */
export async function applyStoreSnapshot(db,user,snapshot){
 if(!STORE_PRODUCTS[snapshot.productId])storeFailure('unsupported_product',400)
 const result=await db.rpc('reconcile_store_subscription_v3',{p_user:user,p_snapshot:snapshot})
 if(result.error)storeFailure('subscription_commit_pending')
 if(!result.data?.success)storeFailure(result.data?.error||'subscription_commit_pending',
  ['purchase_account_conflict','sandbox_account_conflict','production_account_conflict'].includes(result.data?.error)?409:503)
 return result.data
}

export function googleSubscriptionSnapshot(sub,user,credential,observedAt){
 if(['SUBSCRIPTION_STATE_PENDING','SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'].includes(sub.subscriptionState))storeFailure('purchase_pending',409)
 const rows=(sub.lineItems??[]).filter(row=>STORE_PRODUCTS[row.productId])
 const line=rows.sort((a,b)=>Date.parse(b.expiryTime)-Date.parse(a.expiryTime))[0]
 if(!line||!Number.isFinite(Date.parse(line.expiryTime)))storeFailure('incomplete_store_response')
 const expiry=Date.parse(line.expiryTime),now=Date.now()
 const state=sub.subscriptionState
 if(!['SUBSCRIPTION_STATE_PENDING','SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED','SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD','SUBSCRIPTION_STATE_CANCELED','SUBSCRIPTION_STATE_ON_HOLD',
  'SUBSCRIPTION_STATE_PAUSED','SUBSCRIPTION_STATE_EXPIRED'].includes(state))storeFailure('incomplete_store_response')
 if(['SUBSCRIPTION_STATE_PENDING','SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'].includes(state))storeFailure('purchase_pending',409)
 const entitled=['SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_IN_GRACE_PERIOD','SUBSCRIPTION_STATE_CANCELED'].includes(state)&&expiry>now
 const normalized=entitled?state==='SUBSCRIPTION_STATE_IN_GRACE_PERIOD'?'grace_period':state==='SUBSCRIPTION_STATE_CANCELED'?'cancelled':'active'
  :state==='SUBSCRIPTION_STATE_ON_HOLD'?'on_hold':state==='SUBSCRIPTION_STATE_PAUSED'?'paused':'expired'
 return{store:'google',environment:sub.testPurchase?'sandbox':'production',credential,productId:line.productId,
  periodEnd:new Date(expiry).toISOString(),observedAt,eventAt:observedAt,state:normalized,
  basePlanId:line.offerDetails?.basePlanId??null,autoRenewing:line.autoRenewingPlan?.autoRenewEnabled??false,
  acknowledgementPending:entitled&&sub.acknowledgementState==='ACKNOWLEDGEMENT_STATE_PENDING',
  ...STORE_PRODUCTS[line.productId]}
}
