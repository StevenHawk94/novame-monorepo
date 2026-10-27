const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
function setup(existing){
 const disk=existing||new Map(),calls=[],timers=new Map(),identity=[],activity=[];let owner='me',epoch=1,seq=0;
 const api=load('apps/mobile/src/lib/account-profile-local.ts',{
 'react-native':{AppState:{currentState:'active',addEventListener:(_,fn)=>activity.push(fn)}},
 './api':{apiClient:{post:(...args)=>{const d=deferred();calls.push({args,...d});return d.promise;}}},
 './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},
 '../shared/storage/keys':{kAccountProfile:{name:'profile'},kAccountProfileEdits:{name:'edits'}},
 './session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>identity.push(fn)},
 },{setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const base={id:'me',display_name:'Sam',birthday:'1990-01-01',gender:null};if(!disk.has('profile'))disk.set('profile',JSON.stringify(base));
 return{api,disk,calls,base,timers,activity,switch(){owner='other';epoch++;identity.forEach(fn=>fn());}};
}
test('unchanged profile projection preserves identity even with an equal pending edit',()=>{
 const h=setup();assert.equal(h.api.projectAccountProfile(h.base),h.base);
 h.api.saveAccountProfile({display_name:'Sam'},h.base);
 assert.equal(h.api.projectAccountProfile(h.base),h.base);
 h.api.saveAccountProfile({display_name:'New'},h.base);
 assert.notEqual(h.api.projectAccountProfile(h.base),h.base);
});
test('disk-first immediate projection, one serialized write, newest input survives old receipt/read',async()=>{
 const h=setup(),{api,base}=h;const started=api.accountProfileRevision();
 assert.equal(api.saveAccountProfile({display_name:'First'},base).display_name,'First');assert.equal(h.calls.length,0);
 const sync=api.syncAccountProfile();assert.equal(h.calls.length,1);
 api.saveAccountProfile({display_name:'Second',gender:'woman'},base);await api.syncAccountProfile();assert.equal(h.calls.length,1);
 h.calls[0].resolve({success:true});await sync;
 assert.equal(api.projectAccountProfile(base,started).display_name,'Second');assert.equal(api.cachedAccountProfile().display_name,'Second');
 const next=api.syncAccountProfile();assert.equal(h.calls[1].args[1].displayName,'Second');h.calls[1].resolve({success:true});await next;
 assert.equal(api.projectAccountProfile(base,started).display_name,'Second');
 const fresh=api.accountProfileRevision();assert.equal(api.projectAccountProfile({...base,display_name:'Other device'},fresh).display_name,'Other device');
});
test('offline intent persists, foreground retries, terminal rejection restores last acknowledged value',async()=>{
 const h=setup();h.api.saveAccountProfile({birthday:'1998-02-03'},h.base);let p=h.api.syncAccountProfile();
 h.calls[0].reject(Error('offline'));await p;assert.equal(JSON.parse(h.disk.get('edits')).edits.birthday.pending,true);
 assert.match(h.api.accountProfileSyncError(),/retry/);h.activity[0]('active');assert.ok(h.timers.size);
 p=h.api.syncAccountProfile();h.calls[1].reject(Object.assign(Error('invalid'),{status:400}));await p;
 assert.equal(h.api.cachedAccountProfile().birthday,'1990-01-01');assert.match(h.api.accountProfileSyncError(),/check/);
});
test('late account receipt cannot write into another session',async()=>{
 const h=setup();h.api.saveAccountProfile({display_name:'New'},h.base);const p=h.api.syncAccountProfile();h.switch();
 h.disk.set('profile',JSON.stringify({...h.base,id:'other',display_name:'Other'}));h.calls[0].resolve({success:true});await p;
 assert.equal(h.api.cachedAccountProfile().display_name,'Other');assert.equal(h.api.projectAccountProfile(h.base).display_name,'Sam');
});
test('profile journal never accepts invalid birthday or auth fields through public UI contract',()=>{
 const h=setup();assert.throws(()=>h.api.saveAccountProfile({birthday:'2026-02-30'},h.base));assert.equal(h.disk.has('edits'),false);
 assert.throws(()=>h.api.saveAccountProfile({password:'never persist this'},h.base));assert.equal(h.disk.has('edits'),false);
});
test('pending edits survive process restart and sync without reopening account editor',async()=>{
 const old=setup();old.api.saveAccountProfile({display_name:'Persistent'},old.base);
 const h=setup(old.disk);assert.equal(h.api.cachedAccountProfile().display_name,'Persistent');
 const p=h.api.syncAccountProfile();assert.equal(h.calls[0].args[1].displayName,'Persistent');h.calls[0].resolve({success:true});await p;
 assert.equal(JSON.parse(h.disk.get('edits')).edits.display_name.pending,false);
});
test('rejected older request never rolls back newer input; rejection restores acknowledged receipt',async()=>{
 const h=setup();h.api.saveAccountProfile({display_name:'First'},h.base);let p=h.api.syncAccountProfile();
 h.api.saveAccountProfile({display_name:'Second'},h.base);h.calls[0].reject(Object.assign(Error('invalid'),{status:400}));await p;
 assert.equal(h.api.cachedAccountProfile().display_name,'Second');p=h.api.syncAccountProfile();h.calls[1].resolve({success:true});await p;
 h.api.saveAccountProfile({display_name:'Third'},h.api.cachedAccountProfile());p=h.api.syncAccountProfile();h.calls[2].reject(Object.assign(Error('invalid'),{status:422}));await p;
 assert.equal(h.api.cachedAccountProfile().display_name,'Second');
});
