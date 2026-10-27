import {verifyToken} from '@/lib/auth-guard'
import {createClient} from '@supabase/supabase-js'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
export const runtime='edge'

// Legacy code entry is not an alternate way to grant arbitrary accounts Plus.
export async function POST(request){
 try{
  const user=await verifyToken((request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim())
  if(!user)return Response.json({error:'Unauthorized'},{status:401})
  const raw=await request.text()
  if(raw.length>1000)return Response.json({error:'invalid_request'},{status:400})
  let body;try{body=JSON.parse(raw)}catch{return Response.json({error:'invalid_request'},{status:400})}
  if(body?.userId!==user.id||typeof body.code!=='string'||! /^[A-Z0-9]{8}$/.test(body.code.trim().toUpperCase()))return Response.json({error:'invalid_request'},{status:400})
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  await securityRateLimit(db,request,user.id,'duo-code',10,600)
  const result=await db.rpc('join_current_partner_plus_v1',{p_user:user.id,p_code:body.code})
  if(result.error)throw Error('seat_update_pending')
  return Response.json(result.data,{status:result.data?.success?200:409,headers:{'Cache-Control':'no-store'}})
 }catch(error){return securityFailure(error)}
}
