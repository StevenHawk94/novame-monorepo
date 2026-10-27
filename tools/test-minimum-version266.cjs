const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
function apiHarness({allowed=true,fail=false}={}){
 const calls=[];const api=load('apps/api/src/app/api/force-update/route.js',{
  'next/server':{NextResponse:{json:(body,opts={})=>({body,status:opts.status??200})}},
  '@/lib/auth-guard':{verifyToken:async()=>({id:allowed?'admin':'other'})},
  '@supabase/supabase-js':{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'unavailable'}}:{data:{min_version:args.p_min_version,is_active:args.p_enabled}};},from(){throw Error('non-atomic write path');}})},
 },{URL,process:{env:{ADMIN_USER_IDS:'admin'}}});
 const request=body=>({headers:{get:()=> 'Bearer token'},json:async()=>body});return {api,calls,request};
}
test('saving and pausing minimum-version policy use authenticated atomic RPCs, not separate deactivate/insert calls',async()=>{
 const h=apiHarness();assert.equal((await h.api.POST(h.request({minVersion:'1.0.26',message:' Update ',platform:'ios'}))).status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{name:'save_minimum_app_version_v1',args:{p_min_version:'1.0.26',p_message:'Update',p_platform:'ios',p_enabled:true}});
 assert.equal((await h.api.DELETE(h.request())).status,200);assert.equal(h.calls[1].args.p_enabled,false);
});
test('unauthorized, malformed and failed saves never pretend success',async()=>{
 const forbidden=apiHarness({allowed:false});assert.equal((await forbidden.api.POST(forbidden.request({}))).status,403);assert.equal(forbidden.calls.length,0);
 const bad=apiHarness();for(const body of [{minVersion:'1.2',message:'Update'},{minVersion:'1.0.26',message:'  '}])assert.equal((await bad.api.POST(bad.request(body))).status,400);
 assert.equal(bad.calls.length,0);const failed=apiHarness({fail:true});assert.equal((await failed.api.POST(failed.request({minVersion:'1.0.26',message:'Update'}))).status,500);assert.equal((await failed.api.DELETE(failed.request())).status,500);
});
test('Admin hydrates the active minimum and keeps editable controls visible; saving does not call Deactivate',async()=>{
 const h=hooks(),calls=[],jsx=(type,props)=>({type,props});const row={id:'one',min_version:'1.0.25',message:'Update',platform:'ios',is_active:true,created_at:'2026-10-23'};
 const {default:OverviewTab}=load('apps/admin/src/app/admin/_components/OverviewTab.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({push(){}})},'./shared':{StatCard:'StatCard',NavBtn:'NavBtn'},
  '@/lib/api-client':{apiClient:{get:async p=>p.includes('history')?{success:true,history:[row]}:{success:true,dashboard:{users:1,activeSubs:1},forceUpdateActive:true},
   post:async(...args)=>calls.push(['post',...args]),delete:async(...args)=>calls.push(['delete',...args])}},
 },{confirm:()=>true,alert:message=>{throw Error(message);}});
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const render=()=>nodes(h.render(OverviewTab));render();await flush();let tree=render();
 const input=tree.find(n=>n.props?.['aria-label']==='Minimum supported version');assert.equal(input.props.value,'1.0.25');
 input.props.onChange({target:{value:'1.0.26'}});tree=render();const save=tree.find(n=>n.type==='button'&&n.props.children==='Save changes');assert.ok(save);
 await save.props.onClick();await flush();assert.equal(calls.length,1);assert.equal(calls[0][0],'post');assert.equal(calls[0][2].minVersion,'1.0.26');
 assert.ok(render().some(n=>n.props?.['aria-label']==='Minimum supported version'));
});
