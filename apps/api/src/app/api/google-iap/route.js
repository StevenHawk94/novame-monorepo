import {createClient} from '@supabase/supabase-js'
import {after} from 'next/server'
import {verifyToken} from '@/lib/auth-guard'
import {reconcileGoogleSubscription} from '@/lib/google-store-state.mjs'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
export const runtime='nodejs'
export const maxDuration=60
export async function POST(request){
 try{
  const user=await verifyToken((request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim())
  if(!user)return Response.json({success:false,code:'AUTH_INVALID',error:'Unauthorized'},{status:401})
  const raw=await request.text();if(raw.length>16000)return Response.json({error:'invalid_request'},{status:400})
  let body;try{body=JSON.parse(raw)}catch{return Response.json({error:'invalid_request'},{status:400})}
  if(body.userId!==user.id)return Response.json({error:'Unauthorized'},{status:401})
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  await securityRateLimit(db,request,user.id,'google-subscription',20,60)
  const result=await reconcileGoogleSubscription(db,body.purchaseToken,user.id)
  if(!['active','cancelled','grace_period'].includes(result.state))return Response.json({success:false,code:'SUBSCRIPTION_NOT_ENTITLED',error:'Subscription is not active.'},{status:409})
  if(result.acknowledgementPending)after(async()=>{try{await reconcileGoogleSubscription(db,body.purchaseToken,user.id,{acknowledge:true})}catch{/* Durable reconciliation retries. */}})
  return Response.json({success:true,...result},{headers:{'Cache-Control':'no-store'}})
 }catch(error){
  if(error.message==='purchase_pending')return Response.json({success:false,pending:true,code:'PURCHASE_PENDING'},{status:202})
  return securityFailure(error)
 }
}
