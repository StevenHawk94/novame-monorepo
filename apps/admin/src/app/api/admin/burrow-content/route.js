import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
export const runtime = 'nodejs'
const tables = { catalog: 'catalog_items', friends: 'friend_definitions', dialogue: 'friend_content', prompts: 'memory_prompts' }
const reply = (body,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(request) {
  const auth=await requireAdmin();if(auth.error)return auth.error
  try {
    const q=new URL(request.url).searchParams,kind=q.get('kind'),id=q.get('id')
    if(!Object.hasOwn(tables,kind))return reply({error:'invalid_request'},400)
    const db=createAdminClient()
    if(id){
      const {data,error}=await db.rpc('edit_burrow_content_v1',{p_admin:auth.user.id,p_kind:kind,p_id:id,p_action:'read'})
      if(error)throw error
      return reply(data,data.error?400:200)
    }
    const columns=kind==='catalog'?'stable_id,title,status':kind==='friends'?'stable_id,name,status':kind==='dialogue'?'id,friend_id,prompt,status':'stable_id,prompt,status'
    const {data,error}=await db.from(tables[kind]).select(columns).order(kind==='dialogue'?'id':'stable_id').limit(1000)
    if(error)throw error
    return reply({rows:data})
  } catch {return reply({error:'content_unavailable'},503)}
}
export async function POST(request) {
  const auth=await requireAdmin();if(auth.error)return auth.error
  // Cookie-authenticated writes must originate on this admin host.
  if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'invalid_origin'},403)
  try {
    const body=await request.text();if(body.length>70000)return reply({error:'too_large'},413)
    const input=JSON.parse(body)
    if(!Object.hasOwn(tables,input.kind)||typeof input.id!=='string'||input.id.length>200
      ||!['stage','publish'].includes(input.action)||!Number.isInteger(input.version)||input.version<0)return reply({error:'invalid_request'},400)
    const {data,error}=await createAdminClient().rpc('edit_burrow_content_v1',{
      p_admin:auth.user.id,p_kind:input.kind,p_id:input.id,p_action:input.action,
      p_payload:input.payload??null,p_version:input.version,p_base_hash:input.baseHash??null,
    })
    if(error)return reply({error:error.code==='23514'?'content_validation_failed':'publish_failed'},400)
    return reply(data,data.error==='content_conflict'?409:data.error?400:200)
  } catch{return reply({error:'invalid_request'},400)}
}
