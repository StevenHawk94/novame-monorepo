import {NextResponse} from 'next/server'
import {appMajorUpdateServiceClient,authenticatedUserId,commandStatus} from '@/lib/app-major-update'
import {securityRateLimit,securityFailure} from '@/lib/security-boundary'
export const runtime='edge'
export async function GET(request){
 try{
  const user=await authenticatedUserId(request)
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const db=appMajorUpdateServiceClient()
  const {data,error}=await db.rpc('bunny_identity_v1',{p_user:user,p_finalize:request.nextUrl.searchParams.get('finalize')==='1'})
  if(error)throw error
  return NextResponse.json(data,{status:commandStatus(data?.error),headers:{'Cache-Control':'no-store'}})
 }catch(error){return securityFailure(error)??NextResponse.json({error:'identity_unavailable'},{status:503})}
}
export async function POST(request){
 try{
  const user=await authenticatedUserId(request)
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const raw=await request.text()
  if(raw.length>1000)return NextResponse.json({error:'invalid_request'},{status:400})
  let body;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:'invalid_request'},{status:400})}
  if(!['biscuit','pinky'].includes(body?.variant)||!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(body?.key??''))
   return NextResponse.json({error:'invalid_request'},{status:400})
  const db=appMajorUpdateServiceClient();await securityRateLimit(db,request,user,'bunny-selection',20,60)
  const {data,error}=await db.rpc('select_bunny_v1',{p_user:user,p_variant:body.variant,p_key:body.key})
  if(error)throw error
  return NextResponse.json(data,{status:commandStatus(data?.error),headers:{'Cache-Control':'no-store'}})
 }catch(error){return securityFailure(error)??NextResponse.json({error:'identity_unavailable'},{status:503})}
}
