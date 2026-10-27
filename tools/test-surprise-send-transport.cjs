const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const KEY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function harness(options={}){
 const files=new Map(),uploads=[],deleted=[];let epoch=1,identity,cancelled=0;
 class ApiError extends Error{constructor(value){super(value.message);Object.assign(this,value);}}
 const fs={FileSystemUploadType:{BINARY_CONTENT:0},FileSystemSessionType:{BACKGROUND:0},
  makeDirectoryAsync:async()=>{},writeAsStringAsync:async(path,body)=>{files.set(path,body);await options.writing?.();},
  deleteAsync:async path=>{deleted.push(path);files.delete(path);},readDirectoryAsync:async()=>[...files.keys()].map(x=>x.slice('draft/'.length)),
  createUploadTask:(url,path,settings)=>{uploads.push({url,path,settings});return{uploadAsync:async()=>options.result?options.result():{status:200,body:JSON.stringify({id:'receipt',wallet:{balance:700,version:2}})},cancelAsync:async()=>{cancelled++;}};}};
 const api=load('apps/mobile/src/lib/surprise-send-transport.ts',{
  'expo-file-system/legacy':fs,'@novame/api-client':{ApiError},'./supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'not-persisted-in-body'}}})}}},
  '@/shared/storage/artifacts':{SURPRISE_DRAFT_DIRECTORY:'draft/',waitForSurpriseCleanup:async()=>{}},
  './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;return()=>{identity=null;};}},
  './async-lifecycle':{withDeadline:promise=>promise},'expo-crypto':{randomUUID:()=> 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},
 },{process:{env:{EXPO_PUBLIC_API_URL:'https://example.test'}}});
 return{...api,files,uploads,deleted,cancelled:()=>cancelled,signOut(){epoch++;identity?.();}};
}
test('native background upload preserves JSON transaction/key, never writes auth credentials, and cleans only its own spool',async()=>{
 const pending=deferred(),h=harness({result:()=>pending.promise}),body={key:KEY,expectedPrice:300,photo:'base64-photo',audio:'base64-audio'};
 h.files.set('draft/unrelated.m4a','voice');const task=h.uploadSurpriseInBackground(body,KEY);await flush();
 const upload=h.uploads[0];assert.equal(upload.settings.sessionType,0);assert.equal(upload.settings.httpMethod,'POST');
 assert.deepEqual(JSON.parse(h.files.get(upload.path)),body);assert.equal(h.files.get(upload.path).includes('not-persisted-in-body'),false);
 assert.equal(upload.settings.headers.Authorization,'Bearer not-persisted-in-body');pending.resolve({status:200,body:'{"id":"receipt"}'});
 assert.equal((await task).id,'receipt');await flush();assert.equal(h.files.has(upload.path),false);assert.equal(h.files.has('draft/unrelated.m4a'),true);
});
test('native upload preserves definite HTTP rejection reason; malformed/empty receipt remains unknown rather than falsely sent',async()=>{
 const h=harness({result:()=>({status:400,body:'{"error":"invalid_request","reason":"audio_too_short"}'})});
 await assert.rejects(h.uploadSurpriseInBackground({},KEY),error=>error.status===400&&error.body.reason==='audio_too_short');
 for(const result of [undefined,{status:200,body:'invalid-json'},{status:200,body:'{}'}]){
  const invalid=harness({result:()=>result});await assert.rejects(invalid.uploadSurpriseInBackground({},KEY),/send_result_unknown/);
 }
});
test('account switch during spool write cannot start an upload for the previous account',async()=>{
 const pending=deferred(),h=harness({writing:()=>pending.promise});const task=h.uploadSurpriseInBackground({},KEY);await flush();h.signOut();pending.resolve();
 await assert.rejects(task,/session_changed/);await flush();assert.equal(h.uploads.length,0);assert.equal(h.files.size,0);
});
test('account switch cancels an in-flight native upload; confirmed-receipt cleanup preserves other jobs',async()=>{
 const pending=deferred(),h=harness({result:()=>pending.promise});const task=h.uploadSurpriseInBackground({},KEY);await flush();h.signOut();assert.equal(h.cancelled(),1);
 pending.resolve({status:200,body:'{"id":"receipt"}'});await task;
 const own=`draft/${KEY}.eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.upload.json`,other='draft/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.upload.json';
 h.files.set(own,'body');h.files.set(other,'body');h.files.set('draft/photo.jpg','photo');await h.clearConfirmedSurpriseUploads(KEY);
 assert.equal(h.files.has(own),false);assert.equal(h.files.has(other),true);assert.equal(h.files.has('draft/photo.jpg'),true);
});
