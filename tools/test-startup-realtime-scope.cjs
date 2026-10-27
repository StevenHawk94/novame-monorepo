const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,flush,deferred}=require('./lifecycle-test-utils.cjs');
function harness({modern=true,configured=true}={}) {
  const calls=[],channels=[];let owner='me',paired=true,slow=null;
  const tracked=(name,value)=>async()=>{calls.push(name);return typeof value==='function'?value():value;};
  const api=load('apps/mobile/src/lib/pairing-realtime.ts',{
    './friends-api':{
      fetchPairing:tracked('pairing',()=>slow?slow.promise:{paired,partner:paired?{userId:'partner'}:undefined}),
      fetchFriends:tracked('friends',{inviteCode:'ABC123'}),fetchFriendFeed:tracked('feed',[]),
      fetchConnectionHistory:tracked('history',{ok:true,cards:[]}),fetchInsights:tracked('insights',{ok:true}),
      getCachedConnectionHistory:()=>null,getCachedPairing:()=>({paired,partner:{userId:'partner'}}),
      invalidatePairingCache:()=>calls.push('invalidate-pairing'),notifyRemoteSharedBoxChanged(){},
      markConnectionDashboardRefreshed(){},shouldRefreshConnectionDashboard:()=>true,
    },
    './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'token'}}})},
      realtime:{setAuth:async()=>{}},removeChannel:async()=>{},channel:()=>{
        const entry={events:{},status:null,on(_type,{event},fn){entry.events[event]=fn;return entry;},subscribe(fn){entry.status=fn;return entry;}};
        channels.push(entry);return entry;
      }}},
    './connection-analysis-cache':{invalidateConnectionDashboard(){}},'./bags-api':{fetchBags:tracked('bags',[])},
    './subscription':{getCachedSubscriptionTier:()=> 'plus'},
    './partner-reflect-paywall':{requestPartnerReflectPaywall:()=>calls.push('legacy-paywall')},
    './burrow-store':{invalidateBurrowPair:()=>calls.push('invalidate-room')},
    './app-config-api':{hasCachedConfig:()=>configured,getCachedConfig:()=>({app_major_update_enabled:modern})},
  });
  return {api,calls,channels,setPaired:v=>paired=v,setOwner:v=>owner=v,setSlow:v=>slow=v};
}
for(const configured of [true,false])test(`modern/unresolved rollout (${configured}) preserves pairing and invites without legacy requests`,async()=>{
  const h=harness({configured});const snapshots=[];h.api.subscribePairingRealtime(s=>snapshots.push(s));
  h.api.subscribeConnectionRealtime(()=>{});
  await h.api.startPairingRealtime('me');const ch=h.channels[0];ch.status('SUBSCRIBED');await flush();
  assert.deepEqual(h.calls,['pairing','friends']);assert.equal(snapshots.at(-1).pairing.paired,true);
  ch.events.connection_changed();ch.events.reflect_feed_changed({payload:{reflect_id:'old'}});await flush();
  assert.deepEqual(h.calls,['pairing','friends']);
  ch.events.friendship_invited();await flush();assert.equal(h.calls.at(-1),'friends');
  h.setPaired(false);ch.events.pairing_changed();await flush();
  assert.ok(h.calls.includes('invalidate-room'));assert.ok(h.calls.includes('invalidate-pairing'));
  assert.equal(snapshots.at(-1).pairing.paired,false);
  h.setPaired(true);ch.events.pairing_changed();await flush();assert.equal(snapshots.at(-1).pairing.paired,true);
  assert.ok(h.calls.every(name=>!['feed','bags','history','insights','legacy-paywall'].includes(name)));
  await h.api.stopPairingRealtime();
});
test('stale legacy rollout cannot revive old histories or feeds after client UI retirement',async()=>{
  const h=harness({modern:false});await h.api.startPairingRealtime('me');h.channels[0].status('SUBSCRIBED');await flush();
  assert.deepEqual(h.calls,['pairing','friends']);
  const off=h.api.subscribeConnectionRealtime(()=>{});await flush();
  h.api.subscribePairingRealtime(()=>{});h.channels[0].events.pairing_changed();await flush();
  assert.ok(h.calls.every(name=>!['history','insights','feed','bags'].includes(name)));
  off();h.calls.length=0;h.channels[0].events.connection_changed();await flush();assert.deepEqual(h.calls,[]);
  await h.api.stopPairingRealtime();
});
test('a response or broadcast from a stopped account cannot publish or start legacy work',async()=>{
  const h=harness({modern:false}),snapshots=[];h.api.subscribePairingRealtime(s=>snapshots.push(s));h.api.subscribeConnectionRealtime(()=>{});
  await h.api.startPairingRealtime('me');const old=h.channels[0],slow=deferred();h.setSlow(slow);old.status('SUBSCRIBED');await flush();
  await h.api.stopPairingRealtime();h.setSlow(null);h.setOwner('new');await h.api.startPairingRealtime('new');
  h.calls.length=0;old.events.pairing_changed();old.events.connection_changed();old.events.friendship_invited();old.events.reflect_feed_changed({payload:{reflect_id:'old'}});
  slow.resolve({paired:true,partner:{userId:'old-partner'}});await flush();
  assert.deepEqual(h.calls,[]);assert.deepEqual(snapshots,[]);await h.api.stopPairingRealtime();
});
