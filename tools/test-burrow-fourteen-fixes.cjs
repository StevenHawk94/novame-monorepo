const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
test('pair receipt returns profiles/version without waiting for supplementary entitlement reconciliation',async()=>{
 const tasks=[],calls=[],target={id:'them',display_name:'Sam',avatar_url:'avatar'};
 const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:target})}),rpc:async(name)=>{calls.push(name);return {data:name==='pair_immediately'?{success:true}:{userId:'me',partnerId:'them',pairVersion:'a'.repeat(32)}};}};
 const route=load('apps/api/src/app/api/friends/add/route.js',{
  'next/server':{after:fn=>tasks.push(fn),NextResponse:{json:(body,options={})=>({body,...options})}},
  '@/lib/auth-guard':{verifyToken:async()=>({id:'me'})},'@supabase/supabase-js':{createClient:()=>db},
  '@/lib/rate-limit':{rateLimit:async()=>({allowed:true}),clientIp:()=> 'qa'},
  '@/lib/duo-auto':{autoGrantDuoBothWays:async()=>{calls.push('entitlements');}},
 },{process:{env:{}}});
 const result=await route.POST({headers:{get:()=> 'Bearer qa'},json:async()=>({userId:'me',code:'ABC123'})});
 assert.equal(result.body.success,true);assert.equal(result.body.partner.displayName,'Sam');assert.equal(result.body.pairVersion,'a'.repeat(32));
 assert.deepEqual(calls,['pair_immediately','adventure_team_snapshot_v1']);assert.equal(tasks.length,1);
 await tasks[0]();assert.equal(calls.at(-1),'entitlements');
});
test('vibration confirmation survives process reload, is account isolated, and iPad is visual-only even without native capability module',()=>{
 const values=new Map(),platform={OS:'ios',isPad:false};
 const imports={'expo':{requireOptionalNativeModule:()=>null},'react-native':{Platform:platform},
  './storage':{storage:{getString:k=>values.get(k),set:(k,v)=>values.set(k,v)}},'../shared/storage/keys':{kTouchVibrationVerified:{name:'vibration'}},
  './interaction-preferences':{getInteractionPreferences:()=>({haptics:true})},'./haptics':{haptics:{touchPulse:async()=>true}}};
 const first=load('apps/mobile/src/lib/touch-note-runtime.ts',imports);assert.equal(first.touchVibrationVerified('A'),false);
 first.confirmTouchVibration('A');const restarted=load('apps/mobile/src/lib/touch-note-runtime.ts',imports);
 assert.equal(restarted.touchVibrationVerified('A'),true);assert.equal(restarted.touchVibrationVerified('B'),false);
 assert.equal(restarted.touchVisualOnly(null),false);platform.isPad=true;assert.equal(restarted.touchVisualOnly(null),true);
 platform.OS='android';assert.equal(restarted.touchVisualOnly({hasVibrator:false}),true);assert.equal(restarted.touchVisualOnly({hasVibrator:true}),false);
});
function entryHarness({seen=false,remaining=1,meta=true,version=2,sameDomain=true,sendAllowed,sendHasPlus}={}){
 const h=hooks(),time=clock(),routes=[];let focused=true,scope='A:B:pair';
 const state={scope,meta:meta?{version,sameDomain,remaining,hasPlus:false,sendAllowed,sendHasPlus}:null};
 const {TouchNoteEntry}=load('apps/mobile/src/components/burrow/touch-note-entry.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Text:'Text',Pressable:'Pressable'},
  '@novame/domain':load('packages/domain/src/plushie-touch.ts'),
  'expo-router':{router:{push:path=>routes.push(path)}},'@react-navigation/native':{useIsFocused:()=>focused},
  '@/lib/plushie-touch-store':{usePlushieTouches:()=>state,touchGuideSeen:()=>seen,acknowledgeTouchGuide:()=>seen=true,
   touchDraft:()=>null,touchRecording:()=>null,refreshPlushieTouch:async()=>{}},
  './touch-note-ui':{TouchNoteButton:'Action',TouchNoteDialog:'Dialog',TouchNoteIcon:'Icon',touchNoteStyles:{}},
  './touch-note-entry-label':{TouchNoteEntryLabel:'EntryLabel'},
 },time.globals);
 const render=()=>h.render(()=>TouchNoteEntry({scope,pairVersion:'pair'}));
 const press=label=>{const t=render(),b=nodes(t).find(n=>n.props.label===label||n.props.accessibilityLabel===label);assert.ok(b,label);b.props.onPress();return render();};
 render();return {h,time,routes,state,render,press,focus:v=>{focused=v;render();}};
}
test('first-use/quota dialogs remain on original Plushie; only explicit Start or returning valid quota navigates to recorder',()=>{
 const q=entryHarness();q.press('Touch Note');assert.equal(q.routes.length,0);assert.equal(nodes(q.render()).find(n=>n.type==='Dialog').props.visible,true);
 nodes(q.render()).find(n=>n.type==='Dialog').props.onClose();q.render();assert.equal(q.routes.length,0);
 q.press('Touch Note');q.press('Start');assert.equal(q.routes.length,1);assert.equal(q.routes[0].params.mode,'record');q.h.unmount();
 const returning=entryHarness({seen:true});returning.press('Touch Note');assert.equal(returning.routes.length,1);returning.h.unmount();
});
test('quota upgrade returns to original Plushie without auto-recording, and dismissing a pending allowance never navigates late',()=>{
 const q=entryHarness({seen:true,remaining:0});q.press('Touch Note');q.press('Join Plus');assert.equal(q.routes.length,0);q.time.advance(300);
 assert.equal(q.routes[0],'/(main)/(modals)/subscription-paywall');q.focus(false);q.state.meta={...q.state.meta,remaining:1,hasPlus:true};q.focus(true);
 assert.equal(q.routes.length,1);q.press('Touch Note');assert.equal(q.routes.length,2);q.h.unmount();
 const slow=entryHarness({seen:true,meta:false});slow.press('Touch Note');nodes(slow.render()).find(n=>n.type==='Dialog').props.onClose();slow.render();
 slow.state.meta={version:2,sameDomain:true,remaining:1};slow.render();assert.equal(slow.routes.length,0);slow.h.unmount();
});
test('not-ready copy is protocol/domain readiness, distinct from loading and exhausted quota',()=>{
 for(const settings of [{version:1},{sameDomain:false}]){
  const q=entryHarness(settings);q.press('Touch Note');
  assert.ok(nodes(q.render()).some(n=>n.props.children==='Touch Note is not ready. Please try again shortly.'));
  assert.equal(q.routes.length,0);q.press('Retry');assert.equal(q.routes.length,0);q.h.unmount();
 }
 const loading=entryHarness({meta:false});loading.press('Touch Note');
 assert.ok(nodes(loading.render()).some(n=>n.props.children==='Checking your allowance…'));loading.h.unmount();
 const quota=entryHarness({remaining:0});quota.press('Touch Note');
 assert.ok(nodes(quota.render()).some(n=>n.props.label==='Join Plus'));
 assert.ok(!nodes(quota.render()).some(n=>n.props.children==='Touch Note is not ready. Please try again shortly.'));quota.h.unmount();
});
test('server-approved transport opens only the normal intro/recorder; cross-domain quota and own-Plus copy remain authoritative',()=>{
 const q=entryHarness({sameDomain:false,sendAllowed:true});q.press('Touch Note');
 assert.ok(nodes(q.render()).some(n=>n.props.label==='Start'));assert.equal(q.routes.length,0);
 q.press('Start');assert.equal(q.routes.length,1);q.h.unmount();
 const used=entryHarness({sameDomain:false,sendAllowed:true,remaining:0});used.press('Touch Note');
 assert.ok(nodes(used.render()).some(n=>n.props.label==='Join Plus'));assert.equal(used.routes.length,0);used.h.unmount();
 const own=entryHarness({sameDomain:false,sendAllowed:true,sendHasPlus:true,remaining:0});own.press('Touch Note');
 assert.ok(nodes(own.render()).some(n=>n.props.label==='OK'));
 assert.ok(nodes(own.render()).some(n=>n.props.children==='You’ve used today’s send. Your next send is available tomorrow.'));own.h.unmount();
});
test('entry label has a bold white outline with one semantic label and non-interactive decorative copies',()=>{
 const {TouchNoteEntryLabel}=load('apps/mobile/src/components/burrow/touch-note-entry-label.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Text:'Text',View:'View',StyleSheet:{create:x=>x}},
 });
 const tree=TouchNoteEntryLabel(),texts=nodes(tree).filter(n=>n.type==='Text');
 assert.equal(tree.props.pointerEvents,'none');assert.equal(texts.length,9);
 assert.equal(texts.filter(n=>n.props.accessible!==false).length,1);
 for(const n of texts.slice(0,-1)){
  assert.equal(n.props.accessibilityElementsHidden,true);assert.equal(n.props.importantForAccessibility,'no-hide-descendants');
  assert.equal(n.props.style[0].fontWeight,'800');assert.equal(n.props.style[1].color,'#FFFFFF');
 }
 assert.equal(texts.at(-1).props.style.color,'#49321F');
});
test('Burrow tab aggregates the same ready Touch Note badge without consuming it on tab entry',()=>{
 const h=hooks();let touches=1;
 const {useBurrowTabAttention}=load('apps/mobile/src/lib/burrow-tab-attention.ts',{
  react:h.react,'./plushie-touch-store':{usePlushieTouchBadge:()=>touches},
  './burrow-store':{getBurrowSnapshot:()=>({data:null}),subscribeBurrowSnapshot:()=>()=>{}},
  './burrow-attention':{attentionRevision:()=> '1',attentionViewKey:()=> '1',subscribeAttention:()=>()=>{},burrowAttentionCounts:()=>({tabs:{burrow:2}})},
 });
 assert.equal(h.render(useBurrowTabAttention).tabs.burrow,3);assert.equal(h.render(useBurrowTabAttention).tabs.burrow,3);
 touches=0;assert.equal(h.render(useBurrowTabAttention).tabs.burrow,2);h.unmount();
});
