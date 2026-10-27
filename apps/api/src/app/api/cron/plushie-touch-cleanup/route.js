import {NextResponse} from 'next/server'
import {appMajorUpdateServiceClient} from '@/lib/app-major-update'
export const runtime='edge'
export async function GET(request){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401})
 try{const {data,error}=await appMajorUpdateServiceClient().rpc('cleanup_plushie_touch_v1');if(error)throw error;
  return NextResponse.json({removed:data},{headers:{'Cache-Control':'no-store'}})
 }catch{return NextResponse.json({error:'cleanup_unavailable'},{status:503})}
}
