import {appleClient,verifyAppleTransaction,currentAppleSubscription} from './apple-store-state.mjs'
import {applyStoreSnapshot} from './store-subscription-state.mjs'
import {reconcileGoogleSubscription} from './google-store-state.mjs'

/** Missing store notifications are retried independently of UI entry/coins. */
export async function drainSubscriptionChecks(db,limit=1){
 const jobs=await db.rpc('claim_subscription_checks_v1',{p_limit:limit})
 if(jobs.error)throw Error('subscription_queue_unavailable')
 let processed=0
 for(const job of jobs.data??[]){
  let done=false
  try{
   if(job.store==='google'){
    const result=await reconcileGoogleSubscription(db,job.credential,job.user_id,{acknowledge:true})
    done=!result.acknowledgementPending
   }else{
    const client=appleClient(job.environment==='sandbox'?'Sandbox':'Production')
    // Only a lookup; the returned JWS is verified before use.
    const info=await client.getTransactionInfo(job.snapshot.transactionId||job.credential)
    const tx=await verifyAppleTransaction(info.signedTransactionInfo)
    await applyStoreSnapshot(db,job.user_id,await currentAppleSubscription(tx,job.user_id,client));done=true
   }
  }catch{/* Keep the lease-bound job; never guess a paid state on outage. */}
  const saved=await db.rpc('complete_subscription_check_v1',{p_store:job.store,p_env:job.environment,
   p_credential:job.credential,p_lease:job.lease_id,p_success:done})
  if(saved.error)throw Error('subscription_queue_unavailable')
  if(done)processed++
 }
 return{checked:processed}
}
