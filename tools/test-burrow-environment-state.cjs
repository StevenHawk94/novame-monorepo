const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,clock,deferred,flush,hooks}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/burrow-map-model.ts');
const context={owner:'me',timeZone:'UTC',country:'US'};
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(start=Date.UTC(2026,9,17,12)){
 const time=clock(start),resident=new Set(),jobs=[],pins=[];
 const sets=Object.fromEntries(['spring','summer','autumn','winter'].map(s=>[s,{source:s+'-day-home',nightSource:s+'-night-home'}]));
 const api=load('apps/mobile/src/lib/burrow-environment-state.ts',{
  './burrow-map-model':model,'./burrow-art-assets':{HOME_BACKGROUND_FLOOR:{source:'floor'},HOME_SEASON_BACKGROUNDS:sets,
   HOME_WINDOW_LANDSCAPES:Object.fromEntries(Object.keys(sets).map(s=>[s,{day:s+'-day-window',night:s+'-night-window'}]))},
  './burrow-map-assets':{BURROW_MAP_ART:{banners:Object.fromEntries(Object.keys(sets).flatMap(s=>['day','night'].map(p=>[s+'-'+p,s+'-'+p+'-map']))) }},
  './prepared-burrow-images':{preparedBurrowImage:s=>resident.has(s)?{}:undefined,retainEnvironmentImages:s=>pins.push([...s]),
   prepareBurrowImages:s=>{const task=deferred();jobs.push({sources:[...s],task});return task.promise;}},
 },time.globals);
 const done=async(index=jobs.length-1)=>{jobs[index].sources.forEach(s=>resident.add(s));jobs[index].task.resolve();await flush();};
 return{api,time,resident,jobs,pins,done};
}
test('one shared decode prepares Home + map and BOTH periods, never publishing a partial scene',async()=>{
 const h=harness(),states=[];h.api.subscribeBurrowEnvironment(()=>states.push(h.api.getBurrowEnvironment()));
 const a=h.api.prepareBurrowEnvironment(context),b=h.api.prepareBurrowEnvironment(context);
 assert.equal(a,b);assert.equal(h.jobs.length,1);assert.equal(h.api.getBurrowEnvironment().environment,null);
 assert.deepEqual(h.jobs[0].sources,['floor','autumn-day-home','autumn-night-home','autumn-day-window','autumn-night-window','autumn-day-map','autumn-night-map']);
 assert.equal(h.api.burrowEnvironmentIsReady(context),false);await h.done();await a;
 assert.equal(h.api.burrowEnvironmentIsReady(context),true);assert.equal(h.api.getBurrowEnvironment().environment.banner,'autumn-day');
 assert.ok(states.filter(s=>s.environment).every(s=>!s.pending));
});
test('06:00 / 18:00 switch synchronously using decoded refs; stale retained-tab clocks cannot change the shared scene',async()=>{
 const h=harness(Date.UTC(2026,9,17,5,59,59));let work=h.api.prepareBurrowEnvironment(context);await h.done();await work;
 assert.equal(h.api.getBurrowEnvironment().environment.period,'night');
 h.time.advance(1000);work=h.api.refreshBurrowEnvironment();assert.equal(h.api.getBurrowEnvironment().environment.period,'day');await work;
 h.time.advance(12*3600000);work=h.api.refreshBurrowEnvironment();assert.equal(h.api.getBurrowEnvironment().environment.period,'night');await work;
 assert.equal(h.jobs.length,1,'no new decoder or HTTP work for the other period');
 const hks=hooks();const hook=load('apps/mobile/src/lib/use-burrow-environment.ts',{
  react:{...hks.react,useSyncExternalStore:(_s,get)=>get()},'react-native':{AppState:{}},'./burrow-map-model':model,
  './use-burrow-storefront':{useBurrowStorefront:()=> 'US'},'./burrow-environment-state':h.api,
 });
 const home=hks.render(()=>hook.useBurrowEnvironment('UTC',Date.UTC(2026,9,17,12)));
 const map=hks.render(()=>hook.useBurrowEnvironment('UTC',Date.UTC(2026,9,17,3)));
 assert.equal(home,map);assert.equal(home.period,'night');hks.unmount();
});
test('decoding across a season boundary prepares the NEW season before resolving launch readiness',async()=>{
 const h=harness(Date.UTC(2026,10,30,23,59,59));const work=h.api.prepareBurrowEnvironment(context);
 h.time.advance(2000);await h.done(0);assert.equal(h.jobs.length,2);assert.equal(h.api.getBurrowEnvironment().environment,null);
 await h.done(1);await work;assert.equal(h.api.getBurrowEnvironment().environment.banner,'winter-night');assert.equal(h.api.burrowEnvironmentIsReady(context),true);
});
test('foreground after months offline retains the old complete scene until both new variants are decoded',async()=>{
 const h=harness();let work=h.api.prepareBurrowEnvironment(context);await h.done();await work;
 const old=h.api.getBurrowEnvironment().environment;h.time.advance(100*86400000);
 work=h.api.refreshBurrowEnvironment();assert.equal(h.api.getBurrowEnvironment().environment,old);assert.equal(h.api.getBurrowEnvironment().pending,true);
 assert.ok(h.pins.at(-1).includes('autumn-day-map'));assert.ok(h.pins.at(-1).includes('winter-day-map'));
 await h.done();await work;assert.equal(h.api.getBurrowEnvironment().environment.season,'winter');assert.equal(h.api.burrowEnvironmentIsReady(context),true);
 assert.equal(h.pins.at(-1).includes('autumn-day-map'),false,'release outgoing pins only after the atomic commit');
});
test('late prior-account/region decodes cannot overwrite the current environment',async()=>{
 const h=harness(),a=h.api.prepareBurrowEnvironment(context);const rejected=assert.rejects(a,/environment_superseded/);
 const b=h.api.prepareBurrowEnvironment({...context,owner:'new',country:'AU'});
 await h.done(1);await b;assert.equal(h.api.getBurrowEnvironment().environment.season,'spring');
 await h.done(0);await rejected;assert.equal(h.api.getBurrowEnvironment().context.owner,'new');assert.equal(h.api.getBurrowEnvironment().environment.season,'spring');
});
test('decoder failure cannot mark entry ready; retry is local and can complete',async()=>{
 const h=harness(),a=h.api.prepareBurrowEnvironment(context);h.jobs[0].task.reject(Error('decode failed'));await assert.rejects(a);
 assert.equal(h.api.getBurrowEnvironment().failed,true);assert.equal(h.api.burrowEnvironmentIsReady(context),false);
 const b=h.api.refreshBurrowEnvironment();await h.done(1);await b;assert.equal(h.api.getBurrowEnvironment().failed,false);
});
test('a synchronous cache winner does not turn the original same-key preparation into a false failure',async()=>{
 const h=harness(),a=h.api.prepareBurrowEnvironment(context);h.jobs[0].sources.forEach(s=>h.resident.add(s));
 await h.api.refreshBurrowEnvironment();h.jobs[0].task.resolve();await a;assert.equal(h.api.burrowEnvironmentIsReady(context),true);
});
test('a partial cache never counts as ready, and a changed timezone uses the same country/hemisphere rules',async()=>{
 const h=harness();let work=h.api.prepareBurrowEnvironment(context);await h.done();await work;
 h.resident.delete('autumn-night-map');assert.equal(h.api.burrowEnvironmentIsReady(context),false);
 work=h.api.refreshBurrowEnvironment();assert.equal(h.api.getBurrowEnvironment().pending,true);await h.done();await work;
 const next={...context,timeZone:'Pacific/Auckland',country:'NZ'};work=h.api.prepareBurrowEnvironment(next);await h.done();await work;
 assert.deepEqual(plain(h.api.getBurrowEnvironment().environment),plain(model.burrowMapEnvironment(h.time.globals.Date.now(),next.timeZone,next.country)));
});
test('missing window landscape decoding keeps launch blocked even when Home and map are ready',async()=>{
 const h=harness();let work=h.api.prepareBurrowEnvironment(context);await h.done();await work;
 for(const source of ['autumn-day-window','autumn-night-window']){
  h.resident.delete(source);assert.equal(h.api.burrowEnvironmentIsReady(context),false);
  work=h.api.refreshBurrowEnvironment();assert.equal(h.api.getBurrowEnvironment().pending,true);
  await h.done();await work;assert.equal(h.api.burrowEnvironmentIsReady(context),true);
 }
});
