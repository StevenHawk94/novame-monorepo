const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, clock, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const lib = 'apps/mobile/src/lib/';

function navigation(time = clock()) {
  const api = load(lib+'rating-navigation.ts', { react: { useSyncExternalStore() {} } }, time.globals);
  let focused = 'home';
  const events = api.ratingNavigationListeners({ navigation: { getState: () => ({index:0,routes:[{key:focused}]}) } });
  return { api, events, time, focus: id=>focused=id };
}
test('missing native end callbacks recover instead of leaving a permanent tap or prompt lock', () => {
  const n=navigation();
  n.api.markNavigationTransitionPending('gone');
  n.events.transitionStart({target:'home',data:{closing:false}});
  n.time.advance(1199);assert.equal(n.api.isNativeNavigationTransitionBusy(),true);
  n.time.advance(1);assert.equal(n.api.isNativeNavigationTransitionBusy(),false);
  assert.equal(n.api.isNavigationTransitionBusy(),false);
  assert.equal(n.time.timers.size,0);
  n.events.transitionStart({target:'home',data:{closing:false}});
  n.events.transitionEnd({target:'home',data:{closing:false}});
  assert.equal(n.api.isNavigationTransitionBusy(),false,'normal completion has no timeout wait');
  assert.equal(n.time.timers.size,0);
});
test('Home duplicate-tap guard releases on focus and timeout; errors and pending prompts cannot strand it', () => {
  const h=hooks(), n=navigation();let focus;
  const overlays=load(lib+'overlay-presence.ts',{react:{useSyncExternalStore(){}}});
  const {useNavigationAction}=load(lib+'use-navigation-action.ts',{
    react:h.react,'expo-router':{useFocusEffect(fn){focus=fn;}},'./rating-navigation':n.api,'./overlay-presence':overlays,
  },n.time.globals);
  const act=h.render(useNavigationAction);let calls=0;
  const blur=focus();act(()=>calls++);act(()=>calls++);assert.equal(calls,1);
  blur();act(()=>calls++);assert.equal(calls,1);
  focus();n.api.markNavigationTransitionPending('removed-reflect');
  act(()=>calls++);assert.equal(calls,2,'pending paywall intent does not lock user actions');
  n.time.advance(600);assert.throws(()=>act(()=>{throw Error('rejected push');}));
  act(()=>calls++);assert.equal(calls,3);
  n.time.advance(600);const release=overlays.registerOverlay({});act(()=>calls++);assert.equal(calls,3);
  release();act(()=>calls++);assert.equal(calls,4,'overlay cleanup is immediate');
});
test('nested overlay ownership releases independently and auto prompts never preempt visible user sheets', () => {
  const time=clock(), overlays=load(lib+'overlay-presence.ts',{react:{useSyncExternalStore(){}}});
  const n=navigation(time);
  const c=load(lib+'modal-coordinator.ts',{react:{},'./overlay-presence':overlays,'./rating-navigation':n.api},time.globals);
  const outer=overlays.registerOverlay({}),inner=overlays.registerOverlay({});
  c.requestModalSlot('guide','guide:reflect');c.requestModalSlot('guide','guide:focus');
  c.requestModalSlot('announcement');time.advance(200);assert.equal(c.peekActiveModalSlot(),undefined);
  inner();time.advance(200);assert.equal(overlays.isOverlayPresent(),true);
  outer();time.advance(200);assert.equal(c.peekActiveModalSlot(),'announcement');
  c.releaseModalSlot('guide','guide:focus');assert.equal(c.peekActiveModalSlot(),'announcement');
  c.releaseModalSlot('announcement');time.advance(200);assert.equal(c.ownsModalSlot('guide:reflect'),true);
  c.requestModalSlot('announcement');time.advance(200);assert.equal(c.ownsModalSlot('guide:reflect'),true);
  c.releaseModalSlot('guide','guide:reflect');time.advance(200);assert.equal(c.peekActiveModalSlot(),'announcement');
});
test('ScreenOverlay has no hidden native exit fade and unregisters on hide/unmount, including nested sheets', () => {
  for(const platform of ['ios','android']) {
    const h=hooks(), overlays=load(lib+'overlay-presence.ts',{react:{useSyncExternalStore(){}}});let shown=0;
    const jsx=(type,props)=>({type,props});
    const {ScreenOverlay}=load('apps/mobile/src/components/ui/screen-overlay.tsx',{
      react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Modal:'Modal',Platform:{OS:platform},StyleSheet:{absoluteFill:{}},View:'View'},
      'react-native-screens':{FullWindowOverlay:'WindowOverlay'},'@/lib/overlay-presence':overlays,
    });
    const render=visible=>h.render(()=>ScreenOverlay({visible,children:'dialog',onShow:()=>shown++}));
    assert.equal(render(false),null);assert.equal(overlays.isOverlayPresent(),false);
    let tree=render(true);assert.equal(overlays.isOverlayPresent(),true);
    assert.equal(tree.type,platform==='ios'?'WindowOverlay':'Modal');
    if(platform==='android') assert.equal(tree.props.animationType,'none');
    const show=platform==='ios'?tree.props.children.props.onLayout:tree.props.onShow;
    show();show();assert.equal(shown,1);
    const releaseNested=overlays.registerOverlay({});render(false);assert.equal(overlays.isOverlayPresent(),true);
    releaseNested();assert.equal(overlays.isOverlayPresent(),false);
    render(true);h.unmount();assert.equal(overlays.isOverlayPresent(),false);
  }
});
test('same UUID auth recovery does not reset ownership; switching or signing out invalidates old work', () => {
  const session=load(lib+'session-lifecycle.ts');let changes=0;
  session.subscribeSessionIdentity(()=>changes++);
  assert.equal(session.observeSessionIdentity('A'),false);const epoch=session.sessionEpoch();
  assert.equal(session.observeSessionIdentity('A'),true);assert.equal(session.sessionEpoch(),epoch);
  session.observeSessionIdentity('B');session.observeSessionIdentity(null);assert.equal(changes,3);
});
test('screen operations cannot navigate after blur, cancellation or an account change; newer work is not released by old results', () => {
  const h=hooks(), time=clock(), session=load(lib+'session-lifecycle.ts');let focus;
  let beforeRemove;
  const async=load(lib+'async-lifecycle.ts',{},time.globals);
  session.observeSessionIdentity('A');
  const {useScreenOperation}=load(lib+'use-screen-operation.ts',{
    react:h.react,'expo-router':{useFocusEffect(fn){focus=fn;},useNavigation:()=>({addListener(event,fn){assert.equal(event,'beforeRemove');beforeRemove=fn;return()=>{};}})},'./async-lifecycle':async,'./session-lifecycle':session,
  });
  const operation=h.render(useScreenOperation);assert.equal(operation.begin(),null);
  let blur=focus(), first=operation.begin();assert.equal(operation.begin(),null);
  blur();assert.equal(first.isCurrent(),false);focus();const next=operation.begin();first.finish();
  assert.equal(operation.begin(),null,'old completion cannot unlock newer work');
  session.observeSessionIdentity('B');assert.equal(next.isCurrent(),false);
  operation.invalidate();const last=operation.begin();assert.equal(last.isCurrent(),true);
  beforeRemove();assert.equal(last.isCurrent(),false);assert.equal(operation.begin(),null);
});
test('UI deadlines recover a hung operation without cancelling background durable work or leaking timers', async () => {
  const time=clock(), async=load(lib+'async-lifecycle.ts',{},time.globals), work=deferred();
  const bounded=async.withDeadline(work.promise,50);
  const rejected=assert.rejects(bounded,/timed out/);time.advance(50);await rejected;
  work.resolve('saved later');await flush();assert.equal(time.timers.size,0);
  assert.equal(await async.withDeadline(Promise.resolve('ready'),50),'ready');await flush();assert.equal(time.timers.size,0);
});

function questHarness() {
  const time=clock(), disk=new Map(), session=load(lib+'session-lifecycle.ts');session.observeSessionIdentity('A');
  let owner='A', getSession=async()=>({data:{session:owner?{user:{id:owner}}:null}}), get=async()=>({success:true,active:true});
  const reads=[];
  const api=load(lib+'quests-api.ts',{
    '@novame/api-client':{ApiError:class extends Error{}},
    '../shared/storage/keys':{kQuestStatus:{name:'status'},kQuestCustomGeneration:{name:'custom'}},
    './api':{apiClient:{get(url){reads.push(url);return get(url);},post:async()=>({success:true})}},
    './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value),remove:key=>disk.delete(key)}},
    './supabase':{supabase:{auth:{getSession:()=>getSession()}}},
    './async-lifecycle':load(lib+'async-lifecycle.ts',{},time.globals),'./session-lifecycle':session,
  },time.globals);
  return {api,time,disk,reads,session,setGet:fn=>get=fn,setSession:fn=>getSession=fn,setOwner(id){owner=id;session.observeSessionIdentity(id);disk.clear();}};
}
test('Quest status can load after an initial anonymous-session miss and retains the existing cache TTL', async () => {
  const h=questHarness();h.setOwner(null);assert.equal((await h.api.fetchQuestStatus()).active,false);
  h.setOwner('A');assert.equal((await h.api.fetchQuestStatus()).active,true);assert.equal(h.reads.length,1);
  await h.api.fetchQuestStatus();assert.equal(h.reads.length,1,'fresh status is cache-first');
  h.time.advance(15*60*1000+1);await h.api.fetchQuestStatus();assert.equal(h.reads.length,2);
});
test('forced Quest refresh coalesces into one followup and never self-awaits', async () => {
  const h=questHarness(), response=deferred();let calls=0;
  h.setGet(()=>++calls===1?response.promise:Promise.resolve({success:true,active:false}));
  const first=h.api.fetchQuestStatus();await flush();
  const forced=h.api.fetchQuestStatus({force:true});assert.equal(forced,h.api.fetchQuestStatus({force:true}));
  response.resolve({success:true,active:true});await first;assert.equal((await forced).active,false);assert.equal(calls,2);
});
test('late Quest reads cannot overwrite mutation-confirmed cache or a different UUID', async () => {
  const h=questHarness(), stale=deferred();h.setGet(()=>stale.promise);
  const request=h.api.fetchQuestStatus();await flush();h.api.cacheQuestStatus({active:false});
  stale.resolve({success:true,active:true});assert.equal((await request).active,false);
  const old=deferred();h.setGet(()=>old.promise);const oldUser=h.api.fetchQuestStatus({force:true});await flush();
  h.setOwner('B');old.resolve({success:true,active:true});await oldUser;assert.equal(h.disk.size,0);
  h.setGet(async()=>({success:true,active:true}));await h.api.fetchQuestStatus();assert.match(h.reads.at(-1),/userId=B/);
});
test('hung session/status requests release Quest inflight state so a later attempt can recover', async () => {
  const h=questHarness(), session=deferred();h.setSession(()=>session.promise);
  const request=h.api.fetchQuestStatus();h.time.advance(15000);await request;
  h.setSession(async()=>({data:{session:{user:{id:'A'}}}}));await h.api.fetchQuestStatus();assert.equal(h.reads.length,1);
  const hung=deferred();h.setGet(()=>hung.promise);const refresh=h.api.fetchQuestStatus({force:true});await flush();
  h.time.advance(15000);await refresh;h.setGet(async()=>({success:true,active:false}));
  assert.equal((await h.api.fetchQuestStatus({force:true})).active,false);
});
