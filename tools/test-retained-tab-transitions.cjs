const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const api=load('apps/mobile/src/lib/retained-tab-layers.ts');
const edge=load('apps/mobile/src/lib/page-edge-gesture.ts');
const routes=['index','burrow','shop','friends','collection','quests'].map(name=>({key:name,name}));
const state=(selected,trail=[selected],preloaded=[])=>({index:routes.findIndex(r=>r.key===selected),routes,
  history:trail.map(key=>({type:'route',key})),preloadedRouteKeys:preloaded});

function harness(initial=state('index')) {
  const h=hooks(),animations=[],events=[];let current=initial,focused=true,helpers=null;
  const jsx=(type,props,key)=>({type,props,key});
  const navigation={canGoBack:()=>current.history.length>1,goBack(){current=state(current.history.at(-2).key,current.history.slice(0,-1).map(it=>it.key));},navigate:name=>current=state(name),emit:event=>events.push(event)};
  const descriptors=Object.fromEntries(routes.map(route=>[route.key,{render:()=>({screen:route.key})}]));
  const component=load('apps/mobile/src/components/main/retained-tabs-navigator.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Animated:{Value:class {constructor(value){this.value=value;this.writes=[];}setValue(value){this.value=value;this.writes.push(value);}stopAnimation(){}
      interpolate(config){const parent=this;return{config,get value(){const [a,b,c]=config.inputRange,[x,y,z]=config.outputRange;return parent.value<=b?x:(parent.value>=c?z:y+(z-y)*(parent.value-b)/(c-b));}};}},View:'AnimatedView',
      timing(value,options){const job={value,options};animations.push(job);return {start(done){job.done=done;},stop(){job.stopped=true;}};}},
      Easing:{out:fn=>fn,cubic:t=>t*t*t},PanResponder:{create:handlers=>({panHandlers:handlers})},StyleSheet:{create:s=>s,absoluteFillObject:{position:'absolute',top:0,bottom:0,left:0,right:0}},View:'View',useWindowDimensions:()=>({width:400})},
    '@react-navigation/native':{createNavigatorFactory:fn=>()=>({Navigator:fn}),TabRouter:'TabRouter',useIsFocused:()=>focused,
      useNavigationBuilder:()=>({state:current,descriptors,navigation:helpers??navigation,NavigationContent:'NavigationContent'})},
    'expo-router':{withLayoutContext:fn=>fn},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34,left:0,right:0})},
    '@/lib/burrow-home-layout':{homeTabBarHeight:()=>92},'@/lib/retained-tab-layers':api,'./bottom-tab-bar':{BottomTabBar:'BottomTabBar'},
    '@/lib/page-edge-gesture':edge,
  },{requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){}});
  const render=()=>h.render(()=>component.RetainedTabs({})).props.children;
  const scenes=tree=>tree.props.children[0].filter(Boolean);
  const scene=(tree,key)=>scenes(tree).find(item=>item.key===key);
  const style=item=>Object.assign({},...item.props.style);
  const finish=()=>{const job=animations.at(-1);job.value.setValue(job.options.toValue);job.done({finished:true});return render();};
  return {render,scene,style,scenes,finish,animations,events,navigation,current:()=>current,renewNavigation:()=>helpers={...navigation},go:next=>current=next,focus:next=>focused=next,unmount:h.unmount};
}

test('warm Burrow keeps one native AnimatedProps graph through preload, entry, exit and re-entry',()=>{
  const h=harness(state('index',['index'],['burrow']));let tree=h.render();
  const node=h.style(h.scene(tree,'burrow')).transform[0].translateX;
  assert.equal(typeof node.setValue,'function','even a hidden scene must bind an Animated node, never numeric zero');
  h.go(state('burrow',['index','burrow']));tree=h.render();
  assert.equal(h.style(h.scene(tree,'burrow')).transform[0].translateX,node);
  assert.equal(node.value,400);
  tree=h.finish();assert.equal(h.style(h.scene(tree,'burrow')).transform[0].translateX,node);
  h.go(state('index'));h.render();tree=h.finish();
  assert.equal(h.style(h.scene(tree,'burrow')).transform[0].translateX,node);
  assert.equal(node.value,400,'closing offset remains offscreen while the layer is hidden');
  h.go(state('burrow',['index','burrow']));tree=h.render();
  assert.equal(h.style(h.scene(tree,'burrow')).transform[0].translateX,node);
  assert.equal(node.value,400);h.finish();h.unmount();
});

test('first My Room return never flushes a redundant JS-driven Home offset during navigator render',()=>{
  const h=harness(state('index',['index'],['burrow','quests']));let tree=h.render();
  const home=h.style(h.scene(tree,'index')).transform[0].translateX;
  h.go(state('burrow',['index','burrow']));h.render();h.finish();
  h.go(state('index'));tree=h.render();
  assert.deepEqual(home.writes,[],'Home stays zero without render-time Animated.setValue');
  assert.equal(h.style(h.scene(tree,'burrow')).opacity,1,'Burrow owns its complete exit');
  tree=h.finish();assert.equal(home.value,0);assert.equal(h.style(h.scene(tree,'burrow')).opacity,0);
  h.go(state('quests'));h.render();h.go(state('index'));h.render();
  assert.deepEqual(home.writes,[]);h.unmount();
});

test('swipe finishes offscreen before restoring Home focus and never starts a second close animation',()=>{
  const h=harness(state('burrow',['index','burrow']));let tree=h.render();
  const pan=h.scene(tree,'burrow').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:250});
  pan.onPanResponderRelease(null,{dx:250,vx:1});tree=h.render();
  assert.equal(h.current().routes[h.current().index].name,'burrow','no Home focus work in the exit tail');
  assert.equal(h.scene(tree,'burrow').props.pointerEvents,'box-only');
  assert.equal(h.scene(tree,'index').props.pointerEvents,'auto');
  assert.equal(h.style(h.scene(tree,'index')).opacity,1);
  const closing=h.animations.at(-1);
  assert.equal(closing.value.value,250);assert.equal(closing.options.toValue,400);
  assert.equal(closing.options.duration,150,'continue the gesture rather than restarting a fixed ease-in');
  pan.onPanResponderMove(null,{dx:80});
  assert.equal(closing.value.value,250,'late move events must not stop/reset the native exit');
  pan.onPanResponderTerminate();
  assert.equal(h.animations.length,1,'a late termination cannot reverse the committed exit');
  tree=h.finish();
  assert.equal(h.current().routes[h.current().index].name,'index');
  assert.equal(h.animations.length,1,'navigation commit consumes the completed exit');
  assert.equal(h.style(h.scene(tree,'burrow')).opacity,0);h.unmount();
});

test('cancelled or stale swipe completions never navigate a newer page',()=>{
  const h=harness(state('burrow',['index','burrow']));let tree=h.render();
  let pan=h.scene(tree,'burrow').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:60});pan.onPanResponderTerminate();
  assert.equal(h.animations.at(-1).options.toValue,0);tree=h.finish();
  pan=h.scene(tree,'burrow').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:250});pan.onPanResponderRelease(null,{dx:250,vx:1});
  const stale=h.animations.at(-1);
  h.go(state('shop',['index','burrow','shop']));h.render();
  stale.done({finished:true});h.render();
  assert.equal(h.current().routes[h.current().index].name,'shop');h.unmount();
});

test('history layers always place the real selected page above its actual previous page',()=>{
  assert.deepEqual([...api.retainedTabLayers(state('collection',['index','burrow','collection']))],['index','burrow','collection']);
  assert.deepEqual([...api.retainedTabLayers(state('shop'))],['index','shop'],'direct links still have a real Home');
  assert.deepEqual([...api.retainedTabLayers(state('index',['burrow','collection','index']))],['index']);
  assert.equal(api.retainedTabDirection(state('burrow',['index','burrow']),state('collection',['index','burrow','collection'])),'open');
  assert.equal(api.retainedTabDirection(state('collection',['index','burrow','collection']),state('burrow',['index','burrow'])),'close');
});
test('explicit back navigation truncates forward history and Home starts a fresh root',()=>{
  const previous=state('collection',['index','burrow','collection']);
  assert.deepEqual(Array.from(api.retainedTabHistory(previous,state('burrow',['index','collection','burrow'])).history,it=>it.key),['index','burrow']);
  assert.deepEqual(Array.from(api.retainedTabHistory(previous,state('index',['burrow','collection','index'])).history,it=>it.key),['index']);
});
test('opening has an offscreen FIRST frame with real Home below; preloaded scenes remain mounted and hidden',()=>{
  const h=harness(state('index',['index'],['shop','friends']));let tree=h.render();
  assert.equal(h.style(h.scene(tree,'shop')).opacity,0);
  assert.equal(h.style(h.scene(tree,'shop')).display,undefined,'hidden retained scenes keep full layout for background decode');
  const before=h.scene(tree,'index').key;
  h.go(state('shop',['index','shop']));tree=h.render();
  assert.equal(h.scene(tree,'index').key,before);assert.equal(h.style(h.scene(tree,'index')).opacity,1);
  const top=h.style(h.scene(tree,'shop'));
  assert.equal(top.transform[0].translateX.value,400,'not reset in a later effect after a visible frame');
  assert.ok(top.zIndex>h.style(h.scene(tree,'index')).zIndex);
  assert.equal(top.backgroundColor,undefined);assert.equal(tree.props.style.backgroundColor,undefined);
  assert.equal(h.animations[0].options.useNativeDriver,true);
  tree=h.finish();assert.equal(h.style(h.scene(tree,'shop')).transform[0].translateX.value,0);
  assert.equal(h.scene(tree,'shop').props.pointerEvents,'auto');h.unmount();
});
test('nested Collection reveals the real Burrow on close and hides the outgoing layer only AFTER animation',()=>{
  const h=harness(state('burrow',['index','burrow']));h.render();
  h.go(state('collection',['index','burrow','collection']));h.render();h.finish();
  h.go(state('burrow',['index','burrow']));let tree=h.render();
  assert.equal(h.style(h.scene(tree,'burrow')).opacity,1);assert.equal(h.style(h.scene(tree,'collection')).opacity,1);
  assert.ok(h.style(h.scene(tree,'collection')).zIndex>h.style(h.scene(tree,'burrow')).zIndex);
  assert.equal(h.scene(tree,'burrow').props.pointerEvents,'auto');
  assert.equal(h.scene(tree,'collection').props.pointerEvents,'box-only');
  tree=h.finish();assert.equal(h.style(h.scene(tree,'collection')).opacity,0);
  assert.equal(h.scene(tree,'burrow').props.pointerEvents,'auto');h.unmount();
});
test('edge cancel returns to zero; successful exit continues from finger position without jump/reset',()=>{
  const h=harness(state('shop',['index','shop']));let tree=h.render();let pan=h.scene(tree,'shop').props;
  pan.onStartShouldSetPanResponderCapture({nativeEvent:{touches:[{pageX:50}]}},{x0:0});
  assert.equal(pan.onMoveShouldSetPanResponder(null,{x0:50,dx:20,dy:0}),false);
  pan.onStartShouldSetPanResponderCapture({nativeEvent:{touches:[{pageX:10}]}},{x0:0});
  assert.equal(pan.onMoveShouldSetPanResponder(null,{x0:10,dx:30,dy:60}),false);
  assert.equal(pan.onMoveShouldSetPanResponder(null,{x0:10,dx:30,dy:0}),true);
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:60});pan.onPanResponderRelease(null,{dx:60,vx:0});
  assert.equal(h.animations.at(-1).options.toValue,0);tree=h.finish();pan=h.scene(tree,'shop').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:160});pan.onPanResponderRelease(null,{dx:160,vx:0});
  tree=h.render();assert.equal(h.style(h.scene(tree,'shop')).transform[0].translateX.value,160);
  assert.equal(h.style(h.scene(tree,'index')).opacity,1);assert.equal(h.animations.at(-1).options.toValue,400);
  tree=h.finish();assert.equal(h.style(h.scene(tree,'shop')).opacity,0);h.unmount();
});

test('real touch-down, not the ungranted zero x0, limits every retained card to the physical left edge',()=>{
  for(const route of ['burrow','shop','friends','collection']){
    const h=harness(state(route,['index',route])),pan=h.scene(h.render(),route).props;
    const move={x0:0,moveX:200,dx:70,dy:0,numberActiveTouches:1};
    assert.equal(pan.onMoveShouldSetPanResponderCapture(null,move),false,'a missing touch-down fails closed');
    for(const x of [25,80,180,350]){
      assert.equal(pan.onStartShouldSetPanResponderCapture({nativeEvent:{touches:[{pageX:x}]}},move),false,'start observation never steals taps');
      assert.equal(pan.onMoveShouldSetPanResponderCapture(null,move),false,route+': center drag must not pop');
    }
    for(const x of [0,12,24]){
      pan.onStartShouldSetPanResponderCapture({nativeEvent:{touches:[{pageX:x}]}},move);
      assert.equal(pan.onMoveShouldSetPanResponderCapture(null,move),true,route+': edge owns back even above a rail');
      assert.equal(pan.onMoveShouldSetPanResponderCapture(null,{...move,dx:-70}),false);
      assert.equal(pan.onMoveShouldSetPanResponderCapture(null,{...move,dy:100}),false);
      assert.equal(pan.onMoveShouldSetPanResponderCapture(null,{...move,numberActiveTouches:2}),false);
    }
    pan.onStartShouldSetPanResponderCapture({nativeEvent:{touches:[{pageX:12},{pageX:140}]}},move);
    assert.equal(pan.onMoveShouldSetPanResponderCapture(null,move),false,'pinch must not become navigation');h.unmount();
  }
});
test('native child focus return does not replay an entrance; hidden parent cannot intercept gestures',()=>{
  const h=harness(state('burrow',['index','burrow']));h.render();
  h.focus(false);let tree=h.render();assert.equal(h.scene(tree,'burrow').props.onMoveShouldSetPanResponder(null,{x0:10,dx:30,dy:0}),false);
  h.focus(true);h.render();assert.equal(h.animations.length,0);
  h.focus(false);h.go(state('collection',['index','burrow','collection']));h.render();
  h.focus(true);tree=h.render();assert.equal(h.animations.length,0,'native child already owns transition');
  assert.equal(h.style(h.scene(tree,'collection')).transform[0].translateX.value,0);h.unmount();
});
test('Home and its real footer retain the same height throughout room open/close',()=>{
  const h=harness();let tree=h.render();assert.equal(h.style(h.scene(tree,'index')).bottom,92);
  const footer=tree.props.children[1];assert.equal(footer.props.style[1].height,92);
  assert.equal(footer.props.children.props.retainedHome,true);
  h.go(state('shop',['index','shop']));tree=h.render();assert.equal(h.style(h.scene(tree,'index')).bottom,92);
  assert.equal(h.style(h.scene(tree,'shop')).bottom,0);assert.equal(tree.props.children[1].props.pointerEvents,'none');h.unmount();
});
test('deep-linked rooms can swipe back to real Home even without existing tab history',()=>{
  const h=harness(state('collection'));h.navigation.canGoBack=()=>true;
  h.navigation.goBack=()=>assert.fail('must not pop parent native stack');
  let tree=h.render();const pan=h.scene(tree,'collection').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:200});pan.onPanResponderRelease(null,{dx:200,vx:0});
  tree=h.render();assert.equal(h.style(h.scene(tree,'index')).opacity,1);
  tree=h.finish();assert.equal(h.scene(tree,'index').props.pointerEvents,'auto');h.unmount();
});
test('interrupted animation callbacks cannot hide or unlock the newer transition',()=>{
  const h=harness();h.render();h.go(state('burrow',['index','burrow']));h.render();
  const older=h.animations[0];h.go(state('collection',['index','burrow','collection']));h.render();
  assert.equal(older.stopped,true);older.done({finished:true});let tree=h.render();
  assert.equal(h.scene(tree,'collection').props.pointerEvents,'none');
  assert.equal(h.style(h.scene(tree,'collection')).transform[0].translateX.value,400);
  tree=h.finish();assert.equal(h.scene(tree,'collection').props.pointerEvents,'auto');h.unmount();
});
test('a native close has no JS-completion click lock; only the moving outgoing cover consumes touches',()=>{
  const h=harness(state('shop',['index','shop']));h.render();
  h.go(state('index'));const tree=h.render(),close=h.animations.at(-1);
  assert.equal(h.scene(tree,'index').props.pointerEvents,'auto');
  assert.equal(tree.props.children[1].props.pointerEvents,'auto');
  assert.equal(h.scene(tree,'shop').props.pointerEvents,'box-only','outgoing children cannot accidentally buy/navigate');
  const shield=tree.props.children[2],shieldX=h.style(shield).transform[0].translateX;
  assert.equal(shield.props.pointerEvents,'box-only');assert.equal(shieldX.value,0);
  close.value.value=399;assert.equal(shieldX.value,0,'even the exposed portion stays protected until the native exit endpoint');
  // Native driver reaches its endpoint while JS callback is intentionally held.
  close.value.value=400;
  assert.equal(shieldX.value,400,'native hit protection is offscreen before the delayed JS callback');
  assert.equal(h.scene(tree,'index').props.pointerEvents,'auto');
  h.go(state('burrow',['index','burrow']));h.render();close.done({finished:true});
  assert.equal(h.scene(h.render(),'burrow').props.pointerEvents,'none','old callback cannot unlock the new entrance');
  h.finish();assert.equal(h.scene(h.render(),'burrow').props.pointerEvents,'auto');h.unmount();
});
test('a committed native swipe exposes live underlying buttons without waiting for its JS completion',()=>{
  const h=harness(state('shop',['index','shop']));let tree=h.render();const pan=h.scene(tree,'shop').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:200});pan.onPanResponderRelease(null,{dx:200,vx:1});
  tree=h.render();const close=h.animations.at(-1);close.value.value=400;
  assert.equal(h.scene(tree,'shop').props.pointerEvents,'box-only');
  assert.equal(h.scene(tree,'index').props.pointerEvents,'auto');assert.equal(tree.props.children[1].props.pointerEvents,'auto');
  h.go(state('collection',['index','collection']));h.render();close.done({finished:true});h.render();
  assert.equal(h.current().routes[h.current().index].name,'collection','late swipe cannot pop the new page');h.finish();h.unmount();
});
test('late swipe completion cannot pop a newly reopened instance with the same retained route key',()=>{
  const h=harness(state('shop',['index','shop']));const pan=h.scene(h.render(),'shop').props;
  pan.onPanResponderGrant();pan.onPanResponderMove(null,{dx:250});pan.onPanResponderRelease(null,{dx:250,vx:1});h.render();
  const stale=h.animations.at(-1);h.go(state('index'));h.render();h.go(state('shop',['index','shop']));h.render();
  stale.done({finished:true});h.render();assert.equal(h.current().routes[h.current().index].name,'shop');
  h.finish();assert.equal(h.scene(h.render(),'shop').props.pointerEvents,'auto');h.unmount();
});
test('old per-page brown backdrop/gesture wrapper is no longer referenced',()=>{
  for(const file of ['burrow','shop','friends','collection'])assert.ok(!fs.readFileSync(`apps/mobile/app/(main)/(tabs)/${file}.tsx`,'utf8').includes('RetainedRoomTab'));
  const source=fs.readFileSync('apps/mobile/src/components/main/retained-tabs-navigator.tsx','utf8');
  assert.ok(!source.includes('#4D291B'));assert.ok(!source.includes('<BottomTabView'));
});

test('Home and Quests hard-switch immediately, retain their trees and never acquire a back pan',()=>{
  const h=harness();const initial=h.render();
  h.go(state('quests',['quests']));let tree=h.render();
  assert.equal(h.animations.length,0);
  assert.equal(h.scene(tree,'quests').props.onMoveShouldSetPanResponder,undefined);
  assert.equal(h.scene(tree,'quests').props.pointerEvents,'auto');
  assert.equal(h.style(h.scene(tree,'index')).opacity,0);
  h.go(state('index',['index']));tree=h.render();
  assert.equal(h.animations.length,0);
  assert.equal(h.scene(tree,'index').key,h.scene(initial,'index').key);
  assert.equal(h.scene(tree,'index').props.onMoveShouldSetPanResponder,undefined);
  assert.equal(api.retainedTabDirection(state('index'),state('quests')),null);
  assert.equal(api.retainedTabDirection(state('quests'),state('index')),null);h.unmount();
});
test('a room opened from Quests reveals Quests, not an unrelated Home',()=>{
  const h=harness(state('quests'));h.render();
  h.go(state('shop',['quests','shop']));let tree=h.render();
  assert.equal(h.style(h.scene(tree,'quests')).opacity,1);
  assert.equal(h.scene(tree,'index'),undefined);
  h.finish();h.go(state('quests'));tree=h.render();
  assert.ok(h.style(h.scene(tree,'shop')).zIndex>h.style(h.scene(tree,'quests')).zIndex);
  tree=h.finish();assert.equal(h.scene(tree,'quests').props.pointerEvents,'auto');h.unmount();
});
test('preload/cache renders and changing navigation helper identity cannot restart Burrow entrance',()=>{
  const h=harness();h.render();h.go(state('burrow',['index','burrow']));h.render();
  h.renewNavigation();h.go(state('burrow',['index','burrow'],['shop','friends']));h.render();
  assert.equal(h.animations.length,1);assert.equal(h.events.filter(e=>e.type==='transitionStart').length,1);
  h.finish();h.renewNavigation();h.render();assert.equal(h.animations.length,1);h.unmount();
});
test('POP_TO stays inside tabs, retired tab aliases canonicalize, and deep-link back cannot pop the parent',()=>{
  assert.equal(api.retainedTabAction(state('burrow'),{type:'POP_TO',payload:{name:'index'}}).type,'NAVIGATE');
  assert.equal(api.retainedTabAction(state('shop'),{type:'GO_BACK'}).payload.name,'index');
  assert.equal(api.retainedTabAction(state('shop',['quests','shop']),{type:'GO_BACK'}).type,'GO_BACK');
  assert.equal(api.retainedTabAction(state('index'),{type:'NAVIGATE',payload:{name:'bags'}}).payload.name,'collection');
  assert.equal(api.retainedTabAction(state('index'),{type:'NAVIGATE',payload:{name:'court'}}).payload.name,'index');
  assert.equal(api.retainedTabRoot(state('collection',['quests','burrow','collection'])).name,'quests');
});
test('Home entry declares tab semantics so its shortcuts navigate rather than dismiss/reopen the stack',()=>{
  const home=fs.readFileSync('apps/mobile/app/(main)/(tabs)/index.tsx','utf8');
  assert.match(home,/<BurrowScreen section="home" asTab/);
  const burrow=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(burrow,/navigateToBurrow\(destination,extra,!isTab\)/);
});

test('native handoff skips a second tab animation even if focus arrived before the tab update',()=>{
  const h=harness();h.render();
  const handed=state('collection',['index','collection']);
  handed.routes=handed.routes.map(route=>route.name==='collection'?{...route,params:{__tabHandoff:'handoff-1'}}:route);
  h.go(handed);let tree=h.render();
  assert.equal(h.animations.length,0);assert.equal(h.scene(tree,'collection').props.pointerEvents,'auto');
  h.go(state('index'));h.render();h.finish();
  h.go(handed);tree=h.render();
  assert.equal(h.animations.length,2,'an old consumed handoff must not suppress a genuine new visit');h.finish();h.unmount();
});
