import { NextResponse } from 'next/server'
import { appMajorUpdateServiceClient } from '@/lib/app-major-update'
import { photoUUID } from '@/lib/burrow-photo.mjs'
import { SURPRISE_BUCKET } from '@/lib/burrow-surprise.mjs'
export const runtime = 'edge'
export const maxDuration = 60
export async function GET(request) {
  if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const db=appMajorUpdateServiceClient()
    const {data,error}=await db.rpc('collect_surprise_garbage_v1')
    if(error||!Array.isArray(data)||data.length>100)throw Error('invalid_garbage')
    for(const path of data){
      const parts=typeof path==='string'?path.split('/'):[]
      if(parts.length!==3||!photoUUID(parts[0])||!photoUUID(parts[1])||!['face.jpg','voice.m4a'].includes(parts[2]))throw Error('invalid_garbage')
    }
    if(data.length){const removed=await db.storage.from(SURPRISE_BUCKET).remove(data);if(removed.error)throw removed.error}
    return NextResponse.json({success:true,removed:data.length},{headers:{'Cache-Control':'no-store'}})
  }catch{return NextResponse.json({error:'cleanup_failed'},{status:503})}
}
