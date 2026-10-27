const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
function decoder(loadAsync){return load('apps/mobile/src/lib/native-image-decoder.ts',{
 'expo-image':{Image:{loadAsync}},'react-native':{Image:{resolveAssetSource:()=>({uri:'bundled-seed'})}},
 './coin-ui-asset':{COIN_UI_ASSET:7},
});}
test('concurrent feature warmers initialize the native decoder once then decode in parallel',async()=>{
 const seed=deferred(),work=deferred(),calls=[];
 const {decodeNativeImage}=decoder((source,options)=>{calls.push([source,options]);return source.uri==='bundled-seed'?seed.promise:work.promise;});
 const requests=['home','game','plushie'].map(uri=>decodeNativeImage({uri}));
 await flush();assert.equal(calls.length,1);assert.equal(calls[0][1].maxWidth,8);
 seed.resolve({});await flush();assert.equal(calls.length,4,'real decodes must remain concurrent');
 work.resolve({width:96});await Promise.all(requests);
 await decodeNativeImage({uri:'later'});assert.equal(calls.length,5);
});
test('failed initialization rejects all waiters safely and can be retried without poisoning the loader',async()=>{
 const seed=deferred();let seeds=0,real=0;
 const {decodeNativeImage}=decoder(source=>{
  if(source.uri==='bundled-seed')return ++seeds===1?seed.promise:Promise.resolve({});
  real++;return Promise.resolve({});
 });
 const first=Promise.allSettled([decodeNativeImage({uri:'a'}),decodeNativeImage({uri:'b'})]);
 await flush();seed.reject(Error('seed_failed'));
 assert.ok((await first).every(result=>result.status==='rejected'));assert.equal(real,0);
 await decodeNativeImage({uri:'retry'});assert.equal(seeds,2);assert.equal(real,1);
});
