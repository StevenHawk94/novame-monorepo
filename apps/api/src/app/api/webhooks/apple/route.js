import {createClient} from '@supabase/supabase-js'
import {verifyAppleNotification,verifyAppleTransaction,currentAppleSubscription} from '@/lib/apple-store-state.mjs'
import {applyStoreSnapshot} from '@/lib/store-subscription-state.mjs'
import {coinProduct,appleCoin,applyCoin} from '@/lib/burrow-coins.mjs'
import {securityFailure} from '@/lib/security-boundary'
export const runtime='nodejs'
export const maxDuration=60
export async function POST(request){
 try{
  const raw=await request.text();if(raw.length>90000)return Response.json({error:'invalid_request'},{status:400})
  const body=JSON.parse(raw),notification=await verifyAppleNotification(body.signedPayload)
  if(!notification.data?.signedTransactionInfo)return Response.json({received:true,ignored:true})
  const transaction=await verifyAppleTransaction(notification.data.signedTransactionInfo)
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  if(coinProduct(transaction.productId)){
   await applyCoin(db,appleCoin(transaction,null,notification),true)
  }else{
   const binding=await db.from('store_credential_bindings').select('user_id').eq('store','apple').eq('credential',transaction.originalTransactionId).maybeSingle()
   if(binding.error)throw Error('credential_lookup_pending')
   const user=binding.data?.user_id??transaction.appAccountToken
   if(!user)throw Error('credential_binding_pending')
   const person=await db.from('profiles').select('id').eq('id',user).maybeSingle()
   if(person.error)throw Error('profile_lookup_pending')
   if(!person.data)return Response.json({received:true,deleted:true})
   await applyStoreSnapshot(db,user,await currentAppleSubscription(transaction,user))
  }
  return Response.json({received:true})
 }catch(error){return securityFailure(error)}
}
export function GET(){return Response.json({status:'ok',verification:'required'})}
