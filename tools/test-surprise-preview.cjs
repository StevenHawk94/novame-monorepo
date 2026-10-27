const{test}=require('node:test'),assert=require('node:assert/strict');
const{load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
function harness({renderPending,decodePending}={}){
 const h=hooks(),renders=[],decoded=[],deleted=[];let epoch=1,identity;
 const api=load('apps/mobile/src/lib/surprise-preview.ts',{
  react:h.react,'react-native':{Image:{resolveAssetSource:()=>({uri:'bundled-default.webp'})}},
  'expo-file-system/legacy':{cacheDirectory:'cache/',deleteAsync:async uri=>deleted.push(uri)},
  './surprise-frame-assets':{SURPRISE_DEFAULT_FACE:7,SURPRISE_FRAME_OPTIONS:[{id:'santa'},{id:'heart'}]},
  './surprise-portrait-renderer':{renderSurprisePortrait:async(...args)=>{renders.push(args);if(renderPending)await renderPending.promise;if(!args[2]())throw Error('session_changed');return args[3];}},
  './prepared-burrow-images':{prepareBurrowImages:async sources=>{decoded.push(sources);if(decodePending)await decodePending.promise;}},
  './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}},
 });
 return{...api,h,renders,decoded,deleted,signOut(){epoch++;identity();}};
}
test('quick and recorded previews composite/decode once, then all particles share the ready bitmap',async()=>{
 const p=harness();const first=p.prepareSurprisePreview('santa'),second=p.prepareSurprisePreview('santa');assert.equal(first,second);
 assert.equal(await first,'cache/surprise-default-santa.png');assert.equal(p.renders.length,1);assert.equal(p.renders[0][1],'bundled-default.webp');assert.equal(p.renders[0][4],true);
 const uri=await p.prepareSurprisePreview('santa','draft/face.jpg');assert.equal(uri,'draft/face.jpg.preview-santa.png');assert.equal(p.renders[1][4],false);
 assert.equal(await p.prepareSurprisePreview('santa','draft/face.jpg'),uri);assert.equal(p.renders.length,2);assert.equal(p.decoded.length,3,'a cache hit still checks the shared native decode cache before presentation');
 await p.releaseSurprisePreview('santa','draft/face.jpg');assert.deepEqual(p.deleted,[uri]);await p.prepareSurprisePreview('santa','draft/face.jpg');assert.equal(p.renders.length,3);p.h.unmount();
});
test('hook never exposes partially rendered or undecoded portraits and ignores a previous frame',async()=>{
 const pending=deferred(),p=harness({decodePending:pending});const render=(frame='santa')=>p.h.render(()=>p.useSurprisePreview(frame,'draft/face.jpg'));
 assert.equal(render(),undefined);await flush();assert.equal(render(),undefined);pending.resolve();await flush();assert.ok(render().endsWith('santa.png'));
 assert.equal(render('heart'),undefined);await flush();assert.ok(render('heart').endsWith('heart.png'));p.h.unmount();
});
test('supplied receiver portrait bypasses preview work; cancelled identity cannot publish late pixels',async()=>{
 const p=harness();assert.equal(p.h.render(()=>p.useSurprisePreview('santa','photo','already-decoded.png')),'already-decoded.png');assert.equal(p.renders.length,0);p.h.unmount();
 const pending=deferred(),q=harness({renderPending:pending}),work=q.prepareSurprisePreview('santa','draft/face.jpg');q.signOut();pending.resolve();await assert.rejects(work,/session_changed/);q.h.unmount();
});
test('retired historical frames retain a decoded photo without substituting a current frame',async()=>{
 const p=harness();assert.equal(await p.prepareSurprisePreview('bunny','archive/face.jpg'),'archive/face.jpg');assert.equal(p.renders.length,0);assert.equal(p.decoded[0][0].uri,'archive/face.jpg');p.h.unmount();
});
test('silent frame browsing does not composite a default/custom portrait; enabling playback prepares it only after idle',async()=>{
 const p=harness();p.h.render(()=>p.useSurprisePreview('santa','photo',undefined,false));await flush();assert.equal(p.renders.length,0);
 p.h.render(()=>p.useSurprisePreview('santa','photo',undefined,true));assert.equal(p.renders.length,0,'not in the render/entry frame');
 await flush();assert.equal(p.renders.length,1);p.h.unmount();
});
