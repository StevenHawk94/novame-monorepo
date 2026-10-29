const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
function harness({allowed=true,verified=true}={}){
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push([name,args]);return{data:name==='burrow_pair_economy_allowed_v1'?allowed:name==='has_own_active_plus'?true:{hasPlus:allowed}};},from:table=>{
  const builder={select:()=>builder,eq:()=>builder,maybeSingle:async()=>({data:table==='subscriptions'?{plan:'plus',plan_type:'solo',status:'active'}:table==='duo_memberships'?{owner_id:'owner',status:'claimed'}:{display_name:'Taylor'}})};return builder;
 }};
 const api=load('apps/api/src/app/api/duo/status/route.js',{
  'next/server':{NextResponse:{json:(body,opts={})=>({body,status:opts.status??200})}},
  '@/lib/secure-random':{secureCode:()=>{throw Error('No fabricated membership');}},
  '@/lib/auth-guard':{verifyToken:async()=>verified?{id:'member'}:null},
  '@supabase/supabase-js':{createClient:()=>db},
 },{process:{env:{}},URL});
 return{calls,get:()=>api.GET(new Request('https://example.test/api/duo/status?userId=member',{headers:{authorization:'Bearer synthetic'}}))};
}
test('Duo display uses authoritative pair permission, not a fake same-domain value or client dev flag',async()=>{
 const h=harness(),r=await h.get();assert.equal(r.status,200);assert.equal(r.body.asMember.ownerName,'Taylor');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c[0]==='burrow_pair_economy_allowed_v1'))),['burrow_pair_economy_allowed_v1',{p_a:'member',p_b:'owner'}]);
 assert.equal(h.calls.some(c=>c[0]==='same_economic_domain_v1'),false);
});
test('expired/denied exception leaves Duo member display empty and unauthenticated requests never query entitlements',async()=>{
 const h=harness({allowed:false});assert.equal((await h.get()).body.asMember,null);
 const u=harness({verified:false});assert.equal((await u.get()).status,401);assert.equal(u.calls.length,0);
});
test('temporary SQL preserves real domain/Store functions and uses expiry/current relation on every permission evaluation',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261028000285_temporary_paired_testing.sql','utf8');
 assert.doesNotMatch(sql,/create(?: or replace)? function public\.(?:same_economic_domain_v1|economic_domain_v1|admit_store_economic_domain_v1|has_own_active_plus|reconcile_store_subscription_v3)\(/i);
 assert.match(sql,/t\.expires_at>statement_timestamp\(\)/);assert.match(sql,/t\.pair_version=burrow_pair_version_v1\(p_a,p_b\)/);
 assert.match(sql,/'sameDomain'',same_economic_domain_v1/);assert.doesNotMatch(sql,/__DEV__|X-.*Test|update wallets|update account_economic_domains/i);
});
