const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
function harness(){
 const time=clock(),saved=new Map(),files=new Map(),events=[],identities=[],active=[];let owner='me',epoch=1,sequence=0;
 let prepare=async()=>({kind:'success',path:'me/a.jpg',token:'signed'}),upload=async()=>({}),complete=async()=>({kind:'success',avatarUrl:'https://new'});
 const imports={
 'base64-arraybuffer':{decode:()=>new ArrayBuffer(4)},'expo-crypto':{randomUUID:()=>`key-${++sequence}`},
 'expo-file-system/legacy':{EncodingType:{Base64:'base64'},makeDirectoryAsync:async()=>{},copyAsync:async({from,to})=>{if(!files.has(from))throw Error('no file');files.set(to,files.get(from));},readAsStringAsync:async uri=>{if(!files.has(uri))throw Error('no file');return files.get(uri);},deleteAsync:async uri=>{events.push(['delete',uri]);files.delete(uri);}},
 'react-native':{AppState:{currentState:'active',addEventListener:(_,fn)=>active.push(fn)}},
 '../shared/storage/artifacts':{PROFILE_AVATAR_DIRECTORY:'file:///private/avatar/',waitForProfileAvatarCleanup:async()=>{}},
 '../shared/storage/keys':{kProfileAvatar:{name:'avatar'}},'./storage':{storage:{getString:key=>saved.get(key),set:(key,value)=>saved.set(key,value),remove:key=>saved.delete(key)}},
 './account-api':{prepareProfileAvatarUpload:(...args)=>{events.push(['prepare',...args]);return prepare(...args);},completeProfileAvatarUpload:(...args)=>{events.push(['complete',...args]);return complete(...args);}},
 './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner,subscribeSessionIdentity:fn=>identities.push(fn)},
 './supabase':{supabase:{storage:{from:()=>({uploadToSignedUrl:(...args)=>{events.push(['upload',...args]);return upload(...args);}})}}},
 './async-lifecycle':{withDeadline:promise=>promise},
 './avatar-upload-queue':{supersedeOnboardingAvatar:async()=>{}},
 };
 const read=()=>load('apps/mobile/src/lib/profile-avatar-local.ts',imports,time.globals);let api=read();
 return{time,saved,files,events,get api(){return api;},state:()=>JSON.parse(saved.get('avatar')||'null'),
 save:async(value='first',previous='https://old')=>{files.set('file:///crop',value);return api.saveLocalProfileAvatar(owner,'file:///crop',previous);},
 prepare:fn=>{prepare=fn;},upload:fn=>{upload=fn;},complete:fn=>{complete=fn;},
 account:()=>{owner='other';epoch++;identities.forEach(fn=>fn());},reload:()=>{api=read();},
 };
}
test('local crop is durable and visible before any network request; committed local image stays cached',async()=>{
 const h=harness(),uri=await h.save();assert.equal(h.events.length,0);assert.equal(h.api.localProfileAvatarUri('me','https://old'),uri);
 assert.equal(h.api.localProfileAvatarUri('other','https://old'),null);await h.api.syncLocalProfileAvatar();
 assert.equal(h.state().pending,false);assert.equal(h.api.localProfileAvatarUri('me','https://new'),uri);
 assert.equal(h.api.localProfileAvatarUri('me','https://other-device'),null);
});
test('offline upload retries silently with same key, and restart restores pending local preview',async()=>{
 const h=harness();h.prepare(async()=>({kind:'error'}));const uri=await h.save();await h.api.syncLocalProfileAvatar();
 assert.equal(h.state().pending,true);assert.equal(h.state().attempts,1);h.reload();assert.equal(h.api.localProfileAvatarUri('me','https://old'),uri);
 h.prepare(async()=>({kind:'success',path:'me/a.jpg',token:'signed'}));await h.api.syncLocalProfileAvatar();
 assert.equal(h.state().pending,false);const keys=h.events.filter(e=>e[0]==='prepare').map(e=>e[2]);assert.equal(new Set(keys).size,1);
});
test('newer crop immediately wins while old upload is in flight; old file retained until flight finishes',async()=>{
 const h=harness(),pending=deferred();h.upload(()=>pending.promise);const first=await h.save();const flight=h.api.syncLocalProfileAvatar();await flush();
 const second=await h.save('second');assert.ok(h.files.has(first));assert.equal(h.api.localProfileAvatarUri('me','https://old'),second);
 pending.resolve({});await flight;assert.equal(h.state().localUri,second);assert.equal(h.state().pending,true);assert.ok(!h.files.has(first));
 assert.equal(h.events.filter(e=>e[0]==='complete').length,0);
});
test('account switch ignores old receipt and never publishes old local image into new account',async()=>{
 const h=harness(),pending=deferred();h.complete(()=>pending.promise);await h.save();const flight=h.api.syncLocalProfileAvatar();await flush();h.account();
 pending.resolve({kind:'success',avatarUrl:'https://old-account'});await flight;
 assert.equal(h.api.localProfileAvatarUri('other','https://old'),null);assert.equal(h.state().pending,true);
});
test('lost commit response and duplicate upload retry preserve image without repeating a new intent',async()=>{
 const h=harness();let calls=0;h.complete(async()=>++calls===1?{kind:'error'}:{kind:'success',avatarUrl:'https://new'});
 await h.save();await h.api.syncLocalProfileAvatar();h.upload(async()=>({error:{message:'The resource already exists'}}));await h.api.syncLocalProfileAvatar();
 assert.equal(h.state().pending,false);assert.equal(h.events.filter(e=>e[0]==='prepare').length,1);
});
test('superseded response removes rejected local preview and refreshes remote profile once',async()=>{
 const h=harness();let committed=0;h.api.onProfileAvatarCommitted(()=>committed++);h.complete(async()=>({kind:'success',superseded:true,avatarUrl:'https://other-device'}));
 const uri=await h.save();await h.api.syncLocalProfileAvatar();assert.equal(h.state(),null);assert.equal(h.files.has(uri),false);assert.equal(committed,1);
});
test('unfinished onboarding prepare is cancelled without recreating old job or publishing its image',async()=>{
 const pending=deferred(),saved=new Map([['onboarding',JSON.stringify({userId:'me',localUri:'file:///old.jpg'})]]),calls=[];
 const api=load('apps/mobile/src/lib/avatar-upload-queue.ts',{
 'base64-arraybuffer':{decode(){}},'expo-file-system/legacy':{readAsStringAsync:async()=>{calls.push('read');return'';}},
 '../shared/storage/artifacts':{ONBOARDING_AVATAR_PATH:'file:///old.jpg',deleteOnboardingAvatar:async()=>{}},'../shared/storage/keys':{kOnboardingAvatarUpload:{name:'onboarding'}},
 './account-api':{prepareProfileAvatarUpload:()=>pending.promise,completeProfileAvatarUpload:async()=>{calls.push('commit');return{kind:'success'};}},
 './storage':{storage:{getString:key=>saved.get(key),set:(key,value)=>saved.set(key,value),remove:key=>saved.delete(key)}},'./supabase':{supabase:{}},
 });
 const flight=api.syncProfileAvatar('me');const barrier=api.supersedeOnboardingAvatar('me');pending.resolve({kind:'success',path:'me/old.jpg',token:'old'});
 await flight;await barrier;assert.equal(saved.size,0);assert.deepEqual(calls,[]);
});
test('observer failure cannot delete accepted local file or turn a committed avatar into a retry',async()=>{
 const h=harness();h.api.subscribeLocalProfileAvatar(()=>{throw Error('observer');});h.api.onProfileAvatarCommitted(()=>{throw Error('observer');});
 const uri=await h.save();await h.api.syncLocalProfileAvatar();assert.equal(h.files.has(uri),true);assert.equal(h.state().pending,false);
});
