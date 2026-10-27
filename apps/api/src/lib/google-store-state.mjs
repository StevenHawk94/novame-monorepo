import {createHash} from 'node:crypto'
import {googleAccessToken} from './burrow-coins.mjs'
import {storeFailure} from './apple-store-state.mjs'
import {applyStoreSnapshot,googleSubscriptionSnapshot} from './store-subscription-state.mjs'

const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.burrow.app/purchases'
export async function readGoogleSubscription(token){
 if(typeof token!=='string'||token.length<1||token.length>12000)storeFailure('invalid_request',400)
 const observedAt=new Date().toISOString(),access=await googleAccessToken()
 const response=await fetch(`${base}/subscriptionsv2/tokens/${encodeURIComponent(token)}`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(12000)})
 if(!response.ok)storeFailure(response.status===404?'PURCHASE_NOT_FOUND':'GOOGLE_PLAY_TEMPORARY_UNAVAILABLE',response.status===404?422:503)
 return{sub:await response.json(),observedAt,access}
}
export async function reconcileGoogleSubscription(db,token,expectedUser=null,{acknowledge=false}={}){
 const {sub,observedAt,access}=await readGoogleSubscription(token)
 const ids=sub.externalAccountIdentifiers??{}
 const bindings=await db.from('store_credential_bindings').select('credential,user_id').eq('store','google')
  .in('credential',[token,...(sub.linkedPurchaseToken?[sub.linkedPurchaseToken]:[])])
 if(bindings.error)storeFailure('credential_lookup_pending')
 const owners=new Set((bindings.data??[]).map(r=>r.user_id))
 if(owners.has(null)&&!expectedUser)return{deleted:true}
 if(owners.has(null)||owners.size>1)storeFailure('purchase_account_conflict',409)
 const bound=[...owners][0]
 const user=expectedUser??bound??ids.obfuscatedExternalProfileId
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(user??''))storeFailure('purchase_account_conflict',409)
 if((bound&&bound!==user)||(ids.obfuscatedExternalProfileId&&ids.obfuscatedExternalProfileId!==user)
  ||(ids.obfuscatedExternalAccountId&&ids.obfuscatedExternalAccountId!==createHash('sha256').update(`novame:${user}`).digest('hex'))
  ||(!bound&&(!ids.obfuscatedExternalProfileId||!ids.obfuscatedExternalAccountId)))storeFailure('purchase_account_conflict',409)
 const snapshot=googleSubscriptionSnapshot(sub,user,token,observedAt)
 const result=await applyStoreSnapshot(db,user,snapshot)
 let acknowledgementPending=['active','cancelled','grace_period'].includes(snapshot.state)&&sub.acknowledgementState==='ACKNOWLEDGEMENT_STATE_PENDING'
 if(acknowledgementPending&&acknowledge){
  try{
   const ack=await fetch(`${base}/subscriptions/${encodeURIComponent(snapshot.productId)}/tokens/${encodeURIComponent(token)}:acknowledge`,{
    method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)})
   acknowledgementPending=!ack.ok
  }catch{acknowledgementPending=true}
 }
 return{...result,state:snapshot.state,acknowledgementPending}
}
