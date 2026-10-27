import {appMajorUpdateServiceClient} from '@/lib/app-major-update'
import {drainStoreFinishJobs} from '@/lib/store-finish-jobs.mjs'
import {drainSubscriptionChecks} from '@/lib/store-subscription-jobs.mjs'
export const runtime='nodejs'
export const maxDuration=60
export async function GET(request){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:'Unauthorized'},{status:401})
 try{
  const db=appMajorUpdateServiceClient()
  const results=await Promise.allSettled([drainStoreFinishJobs(db,1),drainSubscriptionChecks(db,1)])
  const pending=results.some(v=>v.status==='rejected')
  return Response.json({success:!pending,...Object.assign({},...results.filter(v=>v.status==='fulfilled').map(v=>v.value))},
   {status:pending?503:200,headers:{'Cache-Control':'no-store'}})
 }
 catch{return Response.json({error:'reconciliation_pending'},{status:503})}
}
