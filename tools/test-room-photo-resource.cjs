const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
function harness(){const h=hooks(),time=clock(),requests=[],listeners=[],appListeners=[];let epoch=1;
 const lib=load('apps/mobile/src/lib/use-room-photo-uri.ts',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:(_n,f)=>{appListeners.push(f);return{remove(){}};}}},
  '@react-navigation/native':{useFocusEffect:f=>h.react.useEffect(f,[f])},
  './burrow-room-photo-cache':{cachedRoomPhotoUri:()=>null,invalidateRoomPhotoCache(){},loadRoomPhoto:photo=>{const request=deferred();requests.push({photo,...request});return request.promise;}},
  './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:f=>{listeners.push(f);return()=>{};}},
 },time.globals);return {requests,time,render:p=>h.render(()=>lib.useRoomPhotoResource(p)),switch(){epoch++;listeners.forEach(f=>f());},unmount:h.unmount};}
test('photo resolution is version-bound; late old version cannot replace new face',async()=>{
 const h=harness(),a={id:'A',updatedAt:'one'},b={id:'B',updatedAt:'two'};h.render(a);h.render(b);
 h.requests[0].resolve('old');h.requests[1].resolve('new');await flush();assert.equal(h.render(b).uri,'new');h.unmount();
});
test('failed private-file load retries only twice and unmount cancels scheduled work',async()=>{
 const h=harness(),p={id:'A',updatedAt:'one'};h.render(p);
 for(let i=0;i<3;i++){h.requests[i].reject(Error('offline'));await flush();h.time.advance(2000);await flush();}
 assert.equal(h.requests.length,3);h.time.advance(60000);assert.equal(h.requests.length,3);h.unmount();assert.equal(h.time.timers.size,0);
});
test('old-identity photo completion cannot survive account replacement',async()=>{
 const h=harness(),p={id:'A',updatedAt:'one'};h.render(p);h.switch();h.requests[0].resolve('private-old-owner');await flush();assert.equal(h.render(p).uri,null);h.unmount();
});
