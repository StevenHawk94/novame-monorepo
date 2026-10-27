import {test} from 'node:test'
import assert from 'node:assert/strict'
import {settleBootstrapAdventure,readAdventureDisplay} from '../apps/api/src/lib/adventure-bootstrap.mjs'
function harness(rpcResult={data:{applied:true}}) {
  const calls=[]
  const result={id:'same-result',metadata:{encounterV2:true,treasureSnapshot:{stable_id:'furniture'},dialogue:{choices:[{id:'a'}]},giftSnapshot:{stable_id:'gift'}}}
  const db={rpc:async(name,args)=>{calls.push([name,args]);return name==='adventure_display_v1'
    ? {data:{activeAdventure:{id:'a',status:'in_progress'},adventureResult:null,adventurePlan:{adventureId:'a',version:'plan-1',result}}} : rpcResult},from:table=>{
    const filters=[],q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},
      single:async()=>{calls.push([table,filters]);return {data:{id:'a',user_id:'me',status:'result_ready'}}},
      maybeSingle:async()=>{calls.push([table,filters]);return {data:result}}};return q}}
  return {db,calls,result}
}
test('Home read repairs the same legacy-written result before returning actual frozen furniture and conversation',async()=>{
  const h=harness(),s={wallet:{balance:1},activeAdventure:{id:'a',status:'result_ready'},adventureResult:{id:'same-result',metadata:{itemSnapshot:{title:'Forest Letter'}}}}
  const next=await settleBootstrapAdventure(h.db,'me',s)
  assert.equal(next.adventureResult,h.result);assert.equal(next.wallet,s.wallet);assert.equal(next.adventureResult.metadata.treasureSnapshot.stable_id,'furniture')
  assert.deepEqual(h.calls[0],['adventure_command_v2',{p_user_id:'me',p_adventure_id:'a',p_action:'settle'}])
  assert.deepEqual(h.calls.find(x=>x[0]==='adventures')[1],[['id','a'],['user_id','me']])
})
test('future journey includes its preselected plan without settling; due solo settles and correct results remain unchanged',async()=>{
  const h=harness(),s={activeAdventure:{id:'a',status:'in_progress',ends_at:'2026-10-10T00:00:00Z'},adventureResult:null}
  const future=await settleBootstrapAdventure(h.db,'me',s,0);assert.equal(future.adventureResult,null);assert.equal(future.adventurePlan.result,h.result);
  assert.deepEqual(h.calls.map(c=>c[0]),['adventure_display_v1'])
  assert.equal((await settleBootstrapAdventure(h.db,'me',s,Date.parse('2026-10-11T00:00:00Z'))).adventureResult,h.result)
  const correct={activeAdventure:{id:'a',status:'result_ready'},adventureResult:h.result},count=h.calls.length
  assert.equal(await settleBootstrapAdventure(h.db,'me',correct),correct);assert.equal(h.calls.length,count)
})
test('a staggered migration fails open only for a missing display RPC; scope and other failures do not fake a plan',async()=>{
  for(const code of ['PGRST202','42883']) assert.equal(await readAdventureDisplay({rpc:async()=>({error:{code}})},'me','a'),null)
  await assert.rejects(readAdventureDisplay({rpc:async()=>({error:Error('database unavailable')})},'me','a'),/database unavailable/)
  const s={activeAdventure:{id:'a',status:'in_progress',ends_at:'2099-01-01'}}
  assert.deepEqual(await settleBootstrapAdventure({rpc:async()=>({data:{error:'adventure_cancelled'}})},'me',s),{error:'adventure_cancelled'})
})
test('scope cancellation and database failure never expose the uncorrected reward',async()=>{
  const s={activeAdventure:{id:'a'},adventureResult:{metadata:{}}},h=harness({data:{error:'adventure_cancelled'}})
  assert.deepEqual(await settleBootstrapAdventure(h.db,'me',s),{error:'adventure_cancelled'});assert.equal(h.calls.length,1)
  await assert.rejects(settleBootstrapAdventure(harness({error:Error('db failed')}).db,'me',s),/db failed/)
  assert.equal(await settleBootstrapAdventure(h.db,'me',null),null)
})
