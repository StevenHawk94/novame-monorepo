import {googleAccessToken,coinProduct} from './burrow-coins.mjs'

/** Durable leased retry, never a second grant. No tokens or user content in logs. */
export async function drainStoreFinishJobs(db,limit=5){
 const claimed=await db.rpc('claim_store_finish_jobs_v1',{p_limit:limit})
 if(claimed.error)throw Error('finish_queue_unavailable')
 if(!claimed.data?.length)return{processed:0}
 const access=await googleAccessToken();let processed=0
 for(const job of claimed.data){
  let done=false
  try{
   if(!coinProduct(job.product_id)||!job.purchase_token)throw Error('invalid_finish_job')
   const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.burrow.app/purchases'
   const headers={Authorization:`Bearer ${access}`}
   const read=await fetch(`${base}/productsv2/tokens/${encodeURIComponent(job.purchase_token)}`,{headers,signal:AbortSignal.timeout(10000)})
   if(!read.ok)throw Error('store_read_unavailable')
   const purchase=await read.json(),line=purchase.productLineItem?.[0]
   if(purchase.productLineItem?.length!==1||line?.productId!==job.product_id)throw Error('store_product_mismatch')
   done=purchase.purchaseStateContext?.purchaseState==='CANCELLED'||line.productOfferDetails?.consumptionState==='CONSUMPTION_STATE_CONSUMED'
   if(!done&&purchase.purchaseStateContext?.purchaseState==='PURCHASED'){
    const response=await fetch(`${base}/products/${encodeURIComponent(job.product_id)}/tokens/${encodeURIComponent(job.purchase_token)}:consume`,{method:'POST',headers,signal:AbortSignal.timeout(10000)})
    done=response.ok
   }
  }catch{/* The persisted job remains retryable. */}
  const saved=await db.rpc('complete_store_finish_job_v1',{p_key:job.key,p_lease:job.lease_id,p_success:done})
  if(saved.error)throw Error('finish_queue_unavailable')
  if(done)processed++
 }
 return{processed}
}
