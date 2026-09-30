const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,flush,deferred}=require('./lifecycle-test-utils.cjs');
const response={json:(body,options={})=>({body,status:options.status??200})};
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
for(const [path,method] of [['bubbles/pop','POST'],['quests/start','POST'],['quests/custom','GET'],['quests/custom','POST']]) {
  test(`${method} ${path}: authenticate, retire before side effects, fail closed on flag error`,async()=>{
    let authenticated=false,enabled=true,flags=0,effects=0;
    const sideEffect=()=>{effects++;throw Error('legacy path reached');};
    const route=load(`apps/api/src/app/api/${path}/route.js`,{
      'next/server':{NextResponse:response},'@/lib/auth-guard':{verifyToken:async()=>authenticated?{id:a}:null},
      '@supabase/supabase-js':{createClient:()=>({from:sideEffect,rpc:sideEffect})},
      '@/lib/app-major-update':{majorUpdateEnabled:async()=>{flags++;if(enabled===null)throw Error('config unavailable');return enabled;}},
      '@novame/domain':{PLAN_DAYS:7,CLOVERS_PER_TASK:5},'@novame/engine':{XP_RULES:{bubble:{award:5,cap:3}}},
      '@/lib/user-local-date':{resolveUserLocalDate:sideEffect},'@/lib/ai':{callAI:sideEffect,parseAIJson:sideEffect},'@/lib/rate-limit':{rateLimit:sideEffect},
    },{process:{env:{}},URL,console:{error(){}}});
    const request=()=>new Request(`https://test.invalid?userId=${a}`,{method,...(method==='POST'?{body:JSON.stringify({userId:a,friendUserId:b,itemId:'coffee',themeKey:'custom',title:'Test',tasks:['Walk'],goal:'Walk daily'})}:{})});
    assert.equal((await route[method](request())).status,401);assert.equal(flags,0);
    authenticated=true;assert.equal((await route[method](request())).status,410);assert.equal(effects,0);
    enabled=null;assert.equal((await route[method](request())).status,500);assert.equal(effects,0);
    enabled=false;await route[method](request());assert.equal(effects,1);
  });
}
test('sharing API requires generation, version and receipt key and binds actor to auth',async()=>{
  const calls=[];
  const route=load('apps/api/src/app/api/vnext/command/route.js',{
    'next/server':{NextResponse:response},'@/lib/app-major-update':{authenticatedUserId:async()=>a,majorUpdateEnabled:async()=>true,commandStatus:()=>200,
      appMajorUpdateServiceClient:()=>({rpc:async(...args)=>{calls.push(args);return {data:{shared:false,version:2}};}})},
  });
  const body={action:'set_record_sharing',recordId:a,partnerId:b,pairVersion:'a'.repeat(32),expectedVersion:1,shared:false,idempotencyKey:a,userId:b};
  const request=x=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify(x)});
  for(const field of ['partnerId','pairVersion','expectedVersion','idempotencyKey']){
    const invalid={...body};delete invalid[field];assert.equal((await route.POST(request(invalid))).status,400);
  }
  assert.equal(calls.length,0);assert.equal((await route.POST(request(body))).status,200);
  assert.equal(calls[0][0],'set_burrow_record_sharing_v2');assert.equal(calls[0][1].p_user_id,a);
  assert.equal(calls[0][1].p_expected_version,1);assert.equal(calls[0][1].p_pair_version,body.pairVersion);
});
test('history refresh preserves the frozen editor version and pair change clears it',async()=>{
  const h=hooks(),gate=deferred();let pending=false;
  const entry={id:'entry',author_id:a,body:'Original',updated_at:'v1',localDate:'2026-09-27'};
  const page={rows:[entry],hasMore:false,timezone:'UTC'};
  const jsx=(type,props,key)=>({type,props,key});
  const {BurrowHistory}=load('apps/mobile/src/components/burrow/burrow-history.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
    'react-native':{StyleSheet:{create:x=>x},AppState:{currentState:'active',addEventListener:()=>({remove(){}})},View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',Alert:{}},
    'expo-image':{Image:'Image'},'@/lib/item-images.g':{ITEM_IMAGES:{}},
    'expo-router':{router:{}},'@react-navigation/native':{useIsFocused:()=>true},'@/lib/app-major-update-api':{},'@/lib/burrow-store':{},
    '@/lib/burrow-history':{fetchBurrowHistory:async()=>pending?gate.promise:page,historyDayLabel:x=>x,mergeHistory:(a,b)=>[...a,...b]},
    './memory-composer':{MemoryComposer:'Composer'},'./memory-photos':{MemoryPhotos:'Photos'},'./history-calendar':{HistoryCalendar:'Calendar'},'@/lib/api':{},
  });
  let data={profile:{id:a},partner:{id:b},pairVersion:'pair-one',localDate:'2026-09-27',catalog:[]};
  const render=()=>h.render(()=>BurrowHistory({data,kind:'memories',busy:false}));
  function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
  render();await flush();let tree=render();nodes(tree).find(n=>n.props?.title==='Edit').props.onPress();tree=render();
  assert.equal(nodes(tree).find(n=>n.type==='Composer').props.entryId,'entry');
  pending=true;data={...data,wallet:{balance:300}};render();tree=render();
  let composer=nodes(tree).find(n=>n.type==='Composer');assert.equal(composer.props.entryId,'entry');assert.equal(composer.props.data.memoryEntries[0].updated_at,'v1');
  gate.resolve({...page,rows:[{...entry,body:'Other device',updated_at:'v2'}]});await flush();tree=render();
  composer=nodes(tree).find(n=>n.type==='Composer');assert.equal(composer.props.data.memoryEntries[0].body,'Original');
  const oldKey=composer.key;data={...data,pairVersion:'pair-two'};tree=render();composer=nodes(tree).find(n=>n.type==='Composer');
  assert.equal(composer.props.entryId,null);assert.notEqual(composer.key,oldKey);assert.equal(composer.props.data.memoryEntries.length,0);h.unmount();
});
