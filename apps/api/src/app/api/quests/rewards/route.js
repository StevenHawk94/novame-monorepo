import { NextResponse } from 'next/server'
import { majorUpdateEnabled } from '@/lib/app-major-update'
import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'
import { resolveUserLocalDate } from '@/lib/user-local-date'

export const runtime = 'nodejs'

const MANIFEST_URL = 'https://media.novameapp.com/video-manifest.json'
const MANIFEST_TTL_MS = 5 * 60_000
const DAILY_ROTATION = ['good_vibe','tame_enemy','small_win','new_perspective']
const ROTATION_EPOCH = Date.UTC(2026,8,19)
let manifestCache = { at: 0, scenes: 0, outfits: 0 }

function client() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
    auth:{autoRefreshToken:false,persistSession:false},
  })
}

function isoWeek(dateStr) {
  const [year,month,day]=dateStr.split('-').map(Number)
  const date=new Date(Date.UTC(year,month-1,day))
  const weekday=date.getUTCDay()||7
  date.setUTCDate(date.getUTCDate()+4-weekday)
  const start=new Date(Date.UTC(date.getUTCFullYear(),0,1))
  const week=Math.ceil(((date-start)/86400000+1)/7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2,'0')}`
}

async function availableCosmetics() {
  const now=Date.now()
  if (manifestCache.at && now-manifestCache.at<MANIFEST_TTL_MS) return manifestCache
  try {
    const response=await fetch(`${MANIFEST_URL}?t=${now}`,{cache:'no-store'})
    if (!response.ok) throw new Error(`manifest_${response.status}`)
    const manifest=await response.json()
    manifestCache={
      at:now,
      scenes:Array.isArray(manifest.scenes)?manifest.scenes.length:0,
      outfits:Array.isArray(manifest.outfits)?manifest.outfits.length:0,
    }
  } catch (error) {
    console.warn('[quests/rewards] manifest unavailable:',error?.message||error)
  }
  return manifestCache
}

function dayNumber(dateStr) {
  const [year,month,day]=dateStr.split('-').map(Number)
  return Math.max(0,Math.floor((Date.UTC(year,month-1,day)-ROTATION_EPOCH)/86400000))
}

function milestoneTargets(step,cap=null) {
  const targets=[]
  for (let value=step;value<cap;value+=step) targets.push(value)
  if (cap>0 && targets.at(-1)!==cap) targets.push(cap)
  return targets
}

function specialState({key,title,subtitle,count,step,available=null}) {
  const capped=Number.isFinite(available)&&available!==null
  const safeCount=Math.max(0,Math.floor(Number(count)||0))
  const targets=capped?milestoneTargets(step,Math.max(0,Math.floor(available))):null
  const achieved=capped
    ? targets.filter((target)=>safeCount>=target).length
    : Math.floor(safeCount/step)
  const nextTarget=capped
    ? targets.find((target)=>safeCount<target)??null
    : (achieved+1)*step
  return {
    key,title,subtitle,count:safeCount,reward:30,step,achievedMilestones:achieved,
    nextMilestone:nextTarget,
    progress:nextTarget===null?Math.max(0,available||safeCount):safeCount,
    progressTarget:nextTarget===null?Math.max(1,available||safeCount||1):Math.max(1,nextTarget),
    available:capped?available:null,complete:capped&&nextTarget===null,
  }
}

export async function GET(request) {
  try {
    const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
    const verified=await verifyToken(token)
    if (!verified) return NextResponse.json({error:'Unauthorized'},{status:401})
    const userId=new URL(request.url).searchParams.get('userId')
    if (!userId||verified.id!==userId) return NextResponse.json({error:'Unauthorized'},{status:401})
    const supabase=client()
    if (await majorUpdateEnabled(supabase)) return NextResponse.json({error:'feature_replaced'},{status:410})
    const localDate=await resolveUserLocalDate(supabase,userId)
    const [{data:activity,error:activityError},{data:claims,error:claimsError},catalog]=await Promise.all([
      supabase.rpc('get_quest_activity_counts_v2',{p_user_id:userId,p_local_date:localDate}),
      supabase.from('quest_reward_claims').select('claim_key').eq('user_id',userId),
      availableCosmetics(),
    ])
    if (activityError) throw activityError
    if (claimsError) throw claimsError
    const dailyFlags=activity?.daily||{}
    const totals=activity?.totals||{}
    const rotationKey=DAILY_ROTATION[dayNumber(localDate)%DAILY_ROTATION.length]
    const dailyDefinitions=[
      ['reflection','Finish a reflection','/(main)/reflect'],
      ['case_sync','Finish a case to sync up','/(main)/thump'],
      rotationKey==='good_vibe'
        ? ['good_vibe','Send a Good Vibe','/(main)/(tabs)/friends']
        : rotationKey==='tame_enemy'
          ? ['tame_enemy','Tame your inner enemy','/(main)/tame-enemy']
          : rotationKey==='small_win'
            ? ['small_win','Celebrate a small win','/(main)/quiet-wins']
            : ['new_perspective','Check a new perspective','/(main)/new-lens'],
    ]
    const daily=dailyDefinitions.map(([key,title,route])=>({
      key,title,route,reward:20,done:dailyFlags[key]===true,claimKey:`${localDate}:${key}`,
    }))
    const catalogReady=Boolean(catalog.at)
    const specials=[
      specialState({key:'memory_items',title:'Collect Memory Items',subtitle:'Keep reflecting and create more memories.',count:totals.memory_items,step:20}),
      specialState({key:'cases_finished',title:'Sync Up Cases Finished',subtitle:'Finish cases together in Bunny Court.',count:totals.cases_finished,step:5}),
      specialState({key:'small_wins',title:'Collect Small Wins',subtitle:'Keep noticing the little things that count.',count:totals.small_wins,step:5}),
      specialState({key:'tame_enemy',title:'Inner Enemy Teamed',subtitle:'Keep teaming up with your inner enemies.',count:totals.tame_enemy,step:5}),
      specialState({key:'good_vibes',title:'Send Good Vibes',subtitle:'Send a little encouragement their way.',count:totals.good_vibes,step:5}),
      specialState({key:'scenes_unlocked',title:'Scenes Unlocked',subtitle:'Collect every available place for your bunny.',count:totals.scenes_unlocked,step:2,available:catalogReady?Math.max(catalog.scenes,Number(totals.scenes_unlocked)||0):null}),
      specialState({key:'outfits_unlocked',title:'Outfits Unlocked',subtitle:'Build your bunny wardrobe one look at a time.',count:totals.outfits_unlocked,step:2,available:catalogReady?Math.max(catalog.outfits,Number(totals.outfits_unlocked)||0):null}),
    ]
    const claimed=new Set((claims||[]).map((row)=>row.claim_key))
    const due=[]
    for (const quest of daily) {
      if (quest.done&&!claimed.has(quest.claimKey)) {
        due.push({kind:'daily',claimKey:quest.claimKey,questKey:quest.key})
      }
    }
    for (const quest of specials) {
      for (let milestone=1;milestone<=quest.achievedMilestones;milestone+=1) {
        const claimKey=`${quest.key}:${milestone}`
        if (!claimed.has(claimKey)) due.push({kind:'special',claimKey,questKey:quest.key,milestone})
      }
    }
    let cloversEarned=0
    if (due.length) {
      const {data:award,error:awardError}=await supabase.rpc('claim_quest_rewards_v2',{
        p_user_id:userId,p_claims:due,p_local_date:localDate,p_iso_week:isoWeek(localDate),
      })
      if (awardError) throw awardError
      if (award?.error) throw new Error(award.error)
      cloversEarned=Number(award?.clovers_earned)||0
      for (const key of award?.claimed||[]) claimed.add(key)
    }
    return NextResponse.json({
      success:true,localDate,cloversEarned,
      daily:daily.map((quest)=>({...quest,claimed:claimed.has(quest.claimKey)})),
      special:specials,
    },{headers:{'Cache-Control':'no-store'}})
  } catch (error) {
    console.error('[quests/rewards] GET:',error?.message||error)
    return NextResponse.json({error:'Internal error'},{status:500})
  }
}
