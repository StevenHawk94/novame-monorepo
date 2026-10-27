const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
function harness({disk=new Map([['pending','true']]),user='A',remaining=5000}={}){
 const time=clock(),calls=[],requests=[],owners=new Set(),identities=[];let owner=user;
 const api=load('apps/mobile/src/lib/onboarding-announcement-entry.ts',{
  react:{useSyncExternalStore:(_s,get)=>get()},'./storage':{storage:{getString:k=>disk.get(k),remove:k=>disk.delete(k)}},
  '../shared/storage/keys':{kOnboardingAnnouncementPending:{name:'pending'}},
  './announcements-api':{prepareUnreadAnnouncement:id=>{const d=deferred();requests.push(d);calls.push(id);return d.promise;}},
  './session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity:fn=>identities.push(fn)},
  './overlay-presence':{registerOverlay:o=>{owners.add(o);return()=>owners.delete(o);}},
  './home-entry-readiness':{homeEntryRemainingMs:()=>remaining},
 },{...time.globals,requestAnimationFrame:fn=>time.globals.setTimeout(fn,0)});
 return {api,time,calls,requests,owners,disk,state:()=>api.useOnboardingAnnouncementEntry(),switch:id=>{owner=id;identities.forEach(fn=>fn());}};
}
test('first Home reserves presentation synchronously, queries final account once and releases only after cover closes',async()=>{
 const h=harness();assert.equal(h.state().phase,'idle');assert.equal(h.calls.length,0,'onboarding/paywall/linking never query early');
 h.api.beginOnboardingAnnouncement();h.api.beginOnboardingAnnouncement();
 assert.equal(h.state().phase,'checking');assert.equal(h.owners.size,1);assert.deepEqual(h.calls,['A']);assert.equal(h.disk.has('pending'),false);
 h.requests[0].resolve({id:'news'});await flush();assert.equal(h.state().phase,'ready');assert.equal(h.state().announcement.id,'news');
 h.api.closeOnboardingAnnouncement();assert.equal(h.state().phase,'idle');assert.equal(h.owners.size,1);h.time.advance(0);assert.equal(h.owners.size,0);
 h.api.beginOnboardingAnnouncement();assert.equal(h.calls.length,1,'ordinary Home returns do not check again');
});
test('paid onboarding with account linking waits for first Home and uses the linked identity',()=>{
 const h=harness({user:'guest'});h.switch('linked');assert.equal(h.calls.length,0);
 h.api.beginOnboardingAnnouncement();assert.deepEqual(h.calls,['linked']);
});
test('no announcement, failed lookup, and hung lookup all release Home without late popup injection',async()=>{
 for(const outcome of ['empty','error','timeout']){
  const h=harness();h.api.beginOnboardingAnnouncement();
  if(outcome==='empty')h.requests[0].resolve(null);else if(outcome==='error')h.requests[0].reject(Error('offline'));else h.time.advance(2500);
  await flush();assert.equal(h.state().phase,'idle');h.time.advance(0);assert.equal(h.owners.size,0);
  if(outcome==='timeout'){h.requests[0].resolve({id:'late'});await flush();assert.equal(h.state().phase,'idle');}
 }
});
test('first-Home announcement cannot add another wait after the shared Splash deadline',async()=>{
 const h=harness({remaining:100});h.api.beginOnboardingAnnouncement();
 h.time.advance(99);await flush();assert.equal(h.state().phase,'checking');
 h.time.advance(1);await flush();assert.equal(h.state().phase,'idle');
 h.requests[0].resolve({id:'late'});await flush();assert.equal(h.state().phase,'idle');
});
test('account changes revoke pending private content; returning users and cold-start consumed flags cannot double-display',async()=>{
 const h=harness();h.api.beginOnboardingAnnouncement();h.switch('B');h.requests[0].resolve({id:'private-A'});await flush();
 assert.equal(h.state().phase,'idle');h.time.advance(0);assert.equal(h.owners.size,0);
 const returning=harness({disk:new Map()});returning.api.beginOnboardingAnnouncement();assert.equal(returning.calls.length,0);
 const restored=harness();restored.api.clearOnboardingAnnouncementPending();restored.api.beginOnboardingAnnouncement();assert.equal(restored.calls.length,0);
});
test('no auth identity defers the handoff rather than consuming the first-Home flag',()=>{
 const h=harness({user:null});h.api.beginOnboardingAnnouncement();assert.equal(h.disk.get('pending'),'true');assert.equal(h.calls.length,0);
 h.switch('A');h.api.beginOnboardingAnnouncement();assert.deepEqual(h.calls,['A']);
});
test('real onboarding completion arms once; retrying completion cannot re-arm an already consumed handoff',()=>{
 const disk=new Map();
 const api=load('apps/mobile/src/lib/onboarding.ts',{
  './api':{apiClient:{}},'./storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},
  '../shared/storage/keys':{kOnboardingIntroSeen:{name:'seen'},kOnboardingState:{name:'state'},kOnboardingAnnouncementPending:{name:'pending'}},
 });
 api.markIntroSeen();assert.equal(disk.get('seen'),'true');assert.equal(disk.get('pending'),'true');
 disk.delete('pending');api.markIntroSeen();assert.equal(disk.has('pending'),false);
});
test('first-Home layout is the entry trigger; app root places its cover alongside cold-start announcements',()=>{
 const gate=fs.readFileSync('apps/mobile/src/components/main/home-entry-gate.tsx','utf8');assert.match(gate,/useLayoutEffect\(\(\)=>\{if\(atHome\)beginOnboardingAnnouncement\(\)/);
 assert.match(fs.readFileSync('apps/mobile/app/_layout.tsx','utf8'),/<OnboardingAnnouncementGate\/>/);
});
