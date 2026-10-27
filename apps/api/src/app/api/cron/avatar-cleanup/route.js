import {NextResponse} from 'next/server'
import {appMajorUpdateServiceClient} from '@/lib/app-major-update'
export const runtime='nodejs'
export const maxDuration=60
export async function GET(request){
  if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401})
  try{
    const db=appMajorUpdateServiceClient();let removed=0;const started=Date.now()
    for(let batch=0;batch<10&&Date.now()-started<45000;batch++){
      const due=await db.rpc('collect_profile_avatar_garbage_v1')
      if(due.error||!Array.isArray(due.data)||due.data.length>100)throw Error('cleanup_failed')
      if(!due.data.length)break
      if(due.data.some(path=>typeof path!=='string'||! /^[0-9a-f-]{36}\/([0-9a-fA-F-]+|[0-9]+)\.(jpg|jpeg|png|webp)$/.test(path)))throw Error('invalid_paths')
      const deletion=await db.storage.from('avatars').remove(due.data);if(deletion.error)throw deletion.error
      // Keep a retirement tombstone so an old pre-rollout callback cannot
      // reattach a path after Storage deletion and acknowledgement.
      const ack=await db.from('profile_avatar_garbage').update({deleted_at:new Date().toISOString()}).in('path',due.data)
      if(ack.error)throw ack.error;removed+=due.data.length
    }
    return NextResponse.json({success:true,removed},{headers:{'Cache-Control':'no-store'}})
  }catch{return NextResponse.json({error:'cleanup_failed'},{status:503})}
}
