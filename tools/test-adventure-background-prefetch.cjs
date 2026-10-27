const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,flush}=require('./lifecycle-test-utils.cjs');
function harness(){
  const calls=[];let reset;
  const api=load('apps/mobile/src/lib/adventure-prefetch.ts',{
    './app-major-update-api':{prepareAdventureEncounters:async()=>({gifts:[]})},
    './download-queue':{ensurePriorityR2Image:async url=>{calls.push(['remote',url]);return true;}},
    './session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity:fn=>{reset=fn;}},
    'react-native':{Image:{resolveAssetSource:source=>({uri:`file:///bundled/${source}.webp`})}},
    'expo-image':{Image:{prefetch:async(url,cache)=>{calls.push([url,cache]);return true;}}},
    './burrow-ui-assets':{burrowFriendArt:(_name,reply)=>reply?6:5},
    './burrow-art-assets':{BURROW_BACKGROUNDS:{adventureFinish:1,adventureFriends:2},BURROW_FIXED_ART:{treasureClosed:7,treasureOpen:8},burrowArtForItem:item=>item},
    './metro-asset-uri':{normalizeMetroAssetUri:url=>url},
    './prepared-burrow-images':{prepareBurrowImage:async()=>{},retainNotificationImages(){}},
  });
  return {api,calls,reset:()=>reset()};
}
test('both opaque page backgrounds warm before opening, including legacy encounters; cache reads do not refetch',async()=>{
  const h=harness();
  await h.api.warmAdventureCompletion({activeAdventure:{id:'journey'}});
  assert.deepEqual(h.calls,[1,2,7,8].map(i=>[`file:///bundled/${i}.webp`,'memory-disk']));
  h.api.warmAdventureCompletion({activeAdventure:{id:'journey'}});await flush();assert.equal(h.calls.length,4);
  h.reset();h.api.warmAdventureCompletion({activeAdventure:{id:'journey'}});await flush();assert.equal(h.calls.length,8);
});
test('new encounters still warm both rewards and character poses along with their backgrounds',async()=>{
  const h=harness();h.api.warmAdventureCompletion({activeAdventure:{id:'journey'},adventureResult:{metadata:{encounterV2:true,
    treasureSnapshot:{source:3},giftSnapshot:{source:4},friendSnapshot:{name:'Mr Mole'}}}});
  await flush();assert.deepEqual(h.calls.map(c=>c[0]),[1,2,7,8,3,4,5,6].map(i=>`file:///bundled/${i}.webp`));
});
test('running journey warms its planned furniture, gift and friend before any result exists',async()=>{
 const h=harness();h.api.warmAdventureCompletion({activeAdventure:{id:'journey'},adventureResult:null,adventurePlan:{result:{metadata:{encounterV2:true,
   treasureSnapshot:{source:3},giftSnapshot:{source:4},friendSnapshot:{name:'Mr Mole'}}}}});
 await flush();assert.deepEqual(h.calls.map(c=>c[0]),[1,2,7,8,3,4,5,6].map(i=>`file:///bundled/${i}.webp`));
});
test('Home without an active journey does not decode settlement artwork or retain reward pixels',async()=>{
 const h=harness();await h.api.warmAdventureCompletion({activeAdventure:null});assert.equal(h.calls.length,0);
});
