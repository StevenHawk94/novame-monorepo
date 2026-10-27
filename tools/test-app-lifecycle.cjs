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
    const show=platform==='ios'?tree.props.children.props.children.props.onLayout:tree.props.onShow;
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
test('UI deadlines recover a hung operation without cancelling background durable work or leaking timers', async () => {
  const time=clock(), async=load(lib+'async-lifecycle.ts',{},time.globals), work=deferred();
  const bounded=async.withDeadline(work.promise,50);
  const rejected=assert.rejects(bounded,/timed out/);time.advance(50);await rejected;
  work.resolve('saved later');await flush();assert.equal(time.timers.size,0);
  assert.equal(await async.withDeadline(Promise.resolve('ready'),50),'ready');await flush();assert.equal(time.timers.size,0);
});
