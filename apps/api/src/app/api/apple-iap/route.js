import {createClient} from '@supabase/supabase-js'
import {verifyToken} from '@/lib/auth-guard'
import {verifyAppleTransaction,currentAppleSubscription,assertAppleOwner,storeFailure} from '@/lib/apple-store-state.mjs'
import {applyStoreSnapshot} from '@/lib/store-subscription-state.mjs'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
export const runtime='nodejs'
export const maxDuration=60

export async function POST(request){
 try{
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  const user=await verifyToken(token)
  if(!user)storeFailure('Unauthorized',401)
  const raw=await request.text();if(raw.length>32000)storeFailure('invalid_request',400)
  let body;try{body=JSON.parse(raw)}catch{storeFailure('invalid_request',400)}
  if(body.userId!==user.id||typeof body.jws!=='string')storeFailure('invalid_request',400)
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  await securityRateLimit(db,request,user.id,'apple-subscription',20,60)
  const transaction=await verifyAppleTransaction(body.jws)
  await assertAppleOwner(db,transaction,user.id)
  const snapshot=await currentAppleSubscription(transaction,user.id)
  const result=await applyStoreSnapshot(db,user.id,snapshot)
  if(!['active','grace_period','cancelled'].includes(snapshot.state))storeFailure('SUBSCRIPTION_NOT_ENTITLED',409)
  return Response.json({success:true,...result},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return securityFailure(error)}
}
