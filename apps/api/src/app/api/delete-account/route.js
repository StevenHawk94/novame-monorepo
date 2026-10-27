import {createClient} from '@supabase/supabase-js'
import {verifySensitiveSession} from '@/lib/auth-guard'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
import {createHmac,randomInt} from 'node:crypto'
export const runtime='nodejs'
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status})}

/** The confirmation is bound to one live session and expires in ten minutes.
 * Linked accounts prove mailbox ownership again. Anonymous accounts have no
 * recovery credential: they retain deletion, with explicit UI confirmation. */
export async function POST(request){
 try{
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const identity=await verifySensitiveSession(request,db)
  if(!identity)fail('Unauthorized',401)
  const raw=await request.text();if(raw.length>2000)fail('invalid_request',400)
  let body;try{body=JSON.parse(raw)}catch{fail('invalid_request',400)}
  const {user,sessionId}=identity
  if(body.userId!==user.id)fail('Unauthorized',401)
  await securityRateLimit(db,request,user.id,'delete-account',10,600)
  const proof=(id,code)=>createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY).update(`delete:${user.id}:${sessionId}:${id}:${code}`).digest('hex')
  const command=async(id,action,p_proof=null)=>{
   const result=await db.rpc('security_delete_challenge_v1',{p_user:user.id,p_session:sessionId,p_id:id,p_action:action,p_proof})
   if(result.error)fail('confirmation_unavailable',503)
   if(result.data?.error)fail(result.data.error)
   return result.data
  }
  if(body.action==='prepare'){
   const challengeId=crypto.randomUUID()
   const requiresCode=user.is_anonymous!==true
   const code=String(randomInt(10000000,100000000))
   await command(challengeId,'create',requiresCode?proof(challengeId,code):null)
   if(requiresCode){
    if(!user.email||!user.email_confirmed_at)fail('Reconnect your sign-in method before deleting this account.',403)
    if(!process.env.RESEND_API_KEY)fail('Confirmation email is temporarily unavailable.',503)
    const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
     body:JSON.stringify({from:'Burrow Security <noreply@soulsayit.com>',to:[user.email],subject:'Confirm your Burrow account deletion',
      text:`Your account deletion code is ${code}. It expires in 10 minutes. Enter it only if you want to permanently delete your Burrow account. If you did not request deletion, do not share this code.`}),signal:AbortSignal.timeout(10000)})
    if(!sent.ok)fail('Could not send the confirmation code. Please try again.',503)
   }else await command(challengeId,'authorize_guest')
   return Response.json({success:true,challengeId,requiresCode},{headers:{'Cache-Control':'no-store'}})
  }
  if(body.action!=='delete'||!uuid(body.challengeId))fail('confirmation_required')
  const previous=await command(body.challengeId,'status')
  if(!previous.authorized){
   if(typeof body.code!=='string'||!/^\d{6,8}$/.test(body.code))fail('Enter the confirmation code sent to your email.',400)
   await command(body.challengeId,'verify',proof(body.challengeId,body.code))
  }
  // No permanent mutation happens before the explicit, verified confirmation.
  // Triggers queue exact owned media for cleanup; a partial failure stays retryable.
  const profile=await db.from('profiles').delete().eq('id',user.id)
  if(profile.error)fail('Account deletion is incomplete. Please try again.',503)
  const removed=await db.auth.admin.deleteUser(user.id)
  if(removed.error)fail('Account deletion is incomplete. Please try again.',503)
  return Response.json({success:true},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return securityFailure(error)}
}
