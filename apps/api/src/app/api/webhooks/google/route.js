import {after} from 'next/server'
import {createClient} from '@supabase/supabase-js'
import {OAuth2Client} from 'google-auth-library'
import {reconcileGoogleSubscription} from '@/lib/google-store-state.mjs'
import {verifyGoogleCoin} from '@/lib/burrow-coins.mjs'
import {drainStoreFinishJobs} from '@/lib/store-finish-jobs.mjs'
import {securityFailure} from '@/lib/security-boundary'
export const runtime='nodejs'
export const maxDuration=60
const oidc=new OAuth2Client({transporterOptions:{timeout:10000}})
export async function POST(request){
 try{
  const audience=process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE,email=process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL
  if(process.env.GOOGLE_PUBSUB_REQUIRE_AUTH!=='true'||!audience||!email)return Response.json({error:'webhook_auth_not_configured'},{status:503})
  const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]
  if(!token)return Response.json({error:'Unauthorized'},{status:401})
  try{
   const ticket=await oidc.verifyIdToken({idToken:token,audience}),identity=ticket.getPayload()
   if(identity?.email!==email||identity?.email_verified!==true)throw Error('invalid_identity')
  }catch{return Response.json({error:'Unauthorized'},{status:401})}
  const raw=await request.text();if(raw.length>48000)return Response.json({error:'invalid_request'},{status:400})
  const body=JSON.parse(raw),encoded=body.message?.data
  if(typeof encoded!=='string'||encoded.length>32000)return Response.json({error:'invalid_request'},{status:400})
  const notification=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'))
  if(notification.packageName!=='com.burrow.app')return Response.json({error:'invalid_package'},{status:400})
  if(notification.testNotification)return Response.json({received:true,test:true})
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  if(notification.subscriptionNotification){
   try{await reconcileGoogleSubscription(db,notification.subscriptionNotification.purchaseToken)}
   catch(error){if(error.message!=='purchase_pending')throw error}
  }else{
   const coin=notification.oneTimeProductNotification||(notification.voidedPurchaseNotification?.productType===2?notification.voidedPurchaseNotification:null)
   if(coin){
    const result=await verifyGoogleCoin(db,coin.purchaseToken,null,coin.sku,true)
    if(result.acknowledgementPending)after(async()=>{try{await drainStoreFinishJobs(db,1)}catch{}})
   }
  }
  return Response.json({received:true})
 }catch(error){return securityFailure(error)}
}
