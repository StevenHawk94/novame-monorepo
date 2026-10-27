const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/burrow-map-model.ts');
function harness(start=Date.UTC(2026,9,17,17,59,59)){
 const time=clock(start),h=hooks(),resident=new Set(),jobs=[],frames=new Map();
 let nextFrame=0,appState='active',listener,segments=['(main)','(tabs)'],overlayCount=0,missing=false;
 const data={profile:{id:'A',timezone_name:'UTC'}};
 const sets=Object.fromEntries(['spring','summer','autumn','winter'].map(s=>[s,{source:s+'-day-home',nightSource:s+'-night-home'}]));
 const api=load('apps/mobile/src/lib/burrow-environment-state.ts',{
  './burrow-map-model':model,'./burrow-art-assets':{HOME_BACKGROUND_FLOOR:{source:'floor'},HOME_SEASON_BACKGROUNDS:sets,
   HOME_WINDOW_LANDSCAPES:Object.fromEntries(Object.keys(sets).map(s=>[s,{day:s+'-day-window',night:s+'-night-window'}]))},
  './burrow-map-assets':{BURROW_MAP_ART:{banners:Object.fromEntries(Object.keys(sets).flatMap(s=>['day','night'].map(p=>[s+'-'+p,s+'-'+p+'-map']))) }},
  './prepared-burrow-images':{preparedBurrowImage:s=>resident.has(s)?{}:undefined,retainEnvironmentImages(){},prepareBurrowImages:s=>{
   const task=deferred();jobs.push({sources:[...s],task});return task.promise;
  }},
 },time.globals);
 const jsx=(type,props)=>({type,props});
 const component=load('apps/mobile/src/components/burrow/burrow-environment-gate.tsx',{
  react:{...h.react,useSyncExternalStore:(_s,get)=>get()},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{ActivityIndicator:'spinner',Pressable:'button',Text:'text',View:'view',StyleSheet:{create:x=>x,absoluteFillObject:{}},
   AppState:{get currentState(){return appState;},addEventListener:(_kind,fn)=>{listener=fn;return{remove(){listener=null;}};}}},
  'expo-router':{useSegments:()=>segments},'@/components/main/burrow-launch-screen':{BurrowLaunchScreen:'launch'},
  '@/lib/burrow-onboarding-design':{BURROW_LAUNCH_BACKGROUND:'#123'},
  '@/lib/burrow-store':{getBurrowSnapshot:()=>({data:missing?null:data}),useBurrowSnapshot:()=>({data:missing?null:data})},
  '@/lib/burrow-environment-state':api,'@/lib/use-burrow-storefront':{countryForVisit:()=> 'US',useBurrowStorefront:()=> 'US'},
  '@/lib/overlay-presence':{registerOverlay:()=>{overlayCount++;return()=>{overlayCount--;};}},'@/lib/splash':{hideSplashOnce(){}},
  '@/lib/home-entry-readiness':{HOME_RESUME_AFTER_MS:30*60_000,homeEntryRemainingMs:()=>5000},
  '@/lib/session-lifecycle':{sessionUserId:()=>data.profile.id},
 },{...time.globals,requestAnimationFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 const child={type:'retained-bunny'},render=()=>{
  const wrapper=component.BurrowEnvironmentGate({enabled:true,children:child});
  return h.render(()=>wrapper.type(wrapper.props));
 };
 const cover=tree=>tree.props.children[1]||null;
 const frame=()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());};
 const done=async(index=jobs.length-1)=>{jobs[index].sources.forEach(s=>resident.add(s));jobs[index].task.resolve();await flush();};
 return{api,data,time,resident,jobs,render,cover,frame,done,h,child,component,
  get overlayCount(){return overlayCount;},get timers(){return time.timers.size;},
  state(value){appState=value;listener(value);},route(value){segments=value;},gap(value){missing=value;}};
}
test('a same-account pair verification gap never reopens the launch screen',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.gap(true);let tree=h.render();assert.equal(h.cover(tree),null);assert.equal(tree.props.children[0].props.pointerEvents,'auto');
 h.gap(false);assert.equal(h.cover(h.render()),null);h.h.unmount();
});
test('entry cover waits for native decode AND two paint frames; scene/bunny stay mounted throughout',async()=>{
 const h=harness();let tree=h.render();assert.ok(h.cover(tree));assert.equal(h.jobs.length,1);assert.equal(h.overlayCount,1);
 const scene=tree.props.children[0];assert.equal(scene.props.children,h.child);assert.equal(scene.props.pointerEvents,'none');
 h.frame();assert.ok(h.cover(h.render()));await h.done();tree=h.render();assert.ok(h.cover(tree));
 h.frame();assert.ok(h.cover(h.render()));h.frame();tree=h.render();assert.equal(h.cover(tree),null);
 assert.equal(tree.props.children[0].props.children,h.child);assert.equal(h.overlayCount,0);h.h.unmount();assert.equal(h.timers,0);
});
test('18:00 cached period commits both scenes synchronously without covering a visible Home',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();assert.equal(h.cover(h.render()),null);
 h.time.advance(1000);assert.equal(h.api.getBurrowEnvironment().environment.period,'night');
 assert.equal(h.cover(h.render()),null);assert.equal(h.jobs.length,1);h.h.unmount();
});
test('resume after a season change keeps launch cover until current Home and map are decoded and painted',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.state('background');assert.equal(h.cover(h.render()),null);assert.equal(h.timers,0);
 h.time.advance(100*86400000);h.state('active');assert.ok(h.cover(h.render()));assert.equal(h.jobs.length,2);
 assert.equal(h.api.getBurrowEnvironment().environment.season,'autumn','old complete scene remains behind cover');
 h.frame();assert.ok(h.cover(h.render()));await h.done();h.render();h.frame();h.frame();
 assert.equal(h.cover(h.render()),null);assert.equal(h.api.getBurrowEnvironment().environment.season,'winter');h.h.unmount();
});
test('decode failure remains covered; Retry reuses only local preparation, no server refresh',async()=>{
 const h=harness();h.render();h.jobs[0].task.reject(Error('bad decode'));await flush();
 let tree=h.render();assert.ok(h.cover(tree));assert.equal(h.api.getBurrowEnvironment().failed,true);
 const find=(node,type)=>{if(!node||typeof node!=='object')return;if(node.type===type)return node;
  return [node.props?.children].flat(Infinity).map(child=>find(child,type)).find(Boolean);};
 const retry=find(tree,'button');assert.ok(retry);retry.props.onPress();await h.done();h.render();h.frame();h.frame();
 assert.equal(h.cover(h.render()),null);h.h.unmount();
});
test('missing first profile and hung decode cannot keep the inner environment cover past five seconds',async()=>{
 const h=harness();h.gap(true);assert.ok(h.cover(h.render()));
 assert.equal(h.jobs.length,1,'bundled environment prepares from local identity without a profile request');
 h.time.advance(4999);assert.ok(h.cover(h.render()));h.time.advance(1);
 let tree=h.render();assert.equal(h.cover(tree),null);assert.equal(tree.props.children[0].props.pointerEvents,'auto');
 assert.equal(h.overlayCount,0);await h.done();h.render();h.frame();h.frame();
 assert.equal(h.cover(h.render()),null,'late preparation never reopens Splash');h.h.unmount();
});
test('failed native environment decode releases the cover at deadline without cancelling retryable preparation',async()=>{
 const h=harness();h.render();h.jobs[0].task.reject(Error('bad decode'));await flush();h.render();
 h.time.advance(5000);assert.equal(h.cover(h.render()),null);assert.equal(h.jobs.length,2,'natural local preparation retry is still allowed');
 h.h.unmount();assert.equal(h.timers,0);
});
test('preparation is local while in other pages; returning to a scenic tab only reveals the current environment',async()=>{
 const h=harness();h.route(['(main)','shop-detail']);assert.equal(h.cover(h.render()),null);
 await h.done();h.render();h.frame();h.frame();h.render();
 h.route(['(main)','(tabs)','burrow']);assert.equal(h.cover(h.render()),null);
 assert.equal(h.cover(h.render()),null);h.h.unmount();
});
test('all warm Back Home and tab returns remain interactive, with no splash or extra frame wait',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();h.render();
 for(let index=0;index<20;index++){
  h.route(['(main)',index%2?'room-interaction':'burrow-detail']);assert.equal(h.cover(h.render()),null);
  h.route(['(main)','(tabs)',...(index%2?['burrow']:[])]);
  const tree=h.render();assert.equal(h.cover(tree),null);assert.equal(tree.props.children[0].props.pointerEvents,'auto');
  assert.equal(h.overlayCount,0);
 }
 assert.equal(h.jobs.length,1);h.h.unmount();
});
test('short background across day/night and repeated background events never trigger a splash',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.state('inactive');assert.equal(h.cover(h.render()),null);
 h.state('background');h.time.advance(500);h.state('background');h.time.advance(1000);
 h.state('active');assert.equal(h.cover(h.render()),null);
 assert.equal(h.api.getBurrowEnvironment().environment.period,'night');assert.equal(h.jobs.length,1);
 h.state('background');h.time.advance(30*60_000-1);h.state('active');assert.equal(h.cover(h.render()),null);
 h.h.unmount();
});
test('warm cache eviction/season preparation keeps the outgoing complete scene instead of covering navigation',async()=>{
 const h=harness(Date.UTC(2026,10,30,23,59,59));h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.route(['(main)','shop-detail']);h.render();
 h.time.advance(1000);h.render();assert.equal(h.jobs.length,2);
 h.route(['(main)','(tabs)']);assert.equal(h.cover(h.render()),null);
 assert.equal(h.api.getBurrowEnvironment().environment.season,'autumn');
 h.jobs[1].task.reject(Error('temporary decode failure'));await flush();
 assert.equal(h.cover(h.render()),null);assert.equal(h.api.getBurrowEnvironment().environment.season,'autumn');
 h.time.advance(60_000);h.render();await h.done();
 assert.equal(h.cover(h.render()),null);assert.equal(h.api.getBurrowEnvironment().environment.season,'winter');
 h.h.unmount();
});
test('a real long-background period switch still waits for the prepared scene paint',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.state('background');h.time.advance(30*60_000);h.state('active');
 assert.ok(h.cover(h.render()));h.frame();assert.ok(h.cover(h.render()));h.frame();
 assert.equal(h.cover(h.render()),null);assert.equal(h.jobs.length,1);h.h.unmount();
});
test('a short resume across a month or an evicted decode never reclassifies Back Home as launch',async()=>{
 const h=harness(Date.UTC(2026,10,30,23,59,59));h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.state('background');h.time.advance(2000);h.state('active');
 assert.equal(h.cover(h.render()),null);assert.equal(h.jobs.length,2);
 assert.equal(h.api.getBurrowEnvironment().environment.season,'autumn');
 await h.done();assert.equal(h.cover(h.render()),null);assert.equal(h.api.getBurrowEnvironment().environment.season,'winter');
 h.resident.delete('winter-night-map');h.time.advance(60_000);
 h.route(['(main)','shop-detail']);h.render();h.route(['(main)','(tabs)']);
 assert.equal(h.cover(h.render()),null);await h.done();assert.equal(h.cover(h.render()),null);h.h.unmount();
});
test('legacy layout is unchanged when the feature is disabled',()=>{
 const h=harness();assert.equal(h.component.BurrowEnvironmentGate({enabled:false,children:h.child}),h.child);
 assert.equal(h.jobs.length,0);h.h.unmount();
});
test('an account change cannot reveal a prior owner environment during its handoff',async()=>{
 const h=harness();h.render();await h.done();h.render();h.frame();h.frame();h.render();
 h.data.profile.id='B';assert.ok(h.cover(h.render()));h.render();h.frame();h.frame();
 assert.equal(h.cover(h.render()),null);assert.equal(h.api.getBurrowEnvironment().context.owner,'B');h.h.unmount();
});
