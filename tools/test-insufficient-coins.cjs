const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
function harness(canGoBack=true){
 const h=hooks(),calls=[];
 const route=load('apps/mobile/app/(main)/insufficient-coins.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'expo-router':{router:{canGoBack:()=>canGoBack,back:()=>calls.push('back'),replace:href=>calls.push(href)}},
  'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFill:{}}},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
 });
 const render=()=>h.render(()=>route.default());
 const action=label=>nodes(render()).find(n=>n.props?.accessibilityLabel===label);
 return {render,action,calls,unmount:h.unmount};
}
test('one cream Oops dialog shows exact copy over the real page with a translucent black scrim',()=>{
 const h=harness(),tree=h.render(),all=nodes(tree);
 assert.equal(tree.props.style[0].backgroundColor,'rgba(0,0,0,0.6)');
 assert.ok(all.some(n=>n.props?.children==='Oops'));
 assert.ok(all.some(n=>n.props?.children==='You do not have enough coins.'));
 const card=all.find(n=>n.props?.accessibilityViewIsModal);assert.equal(card.props.style.backgroundColor,'#FFF8EE');
 assert.ok(all.some(n=>n.type==='Scroll'&&n.props.bounces===false));
 assert.equal(h.action('Get More').props.style({pressed:false})[0].backgroundColor,'#673019');h.unmount();
});
test('Get More replaces the prompt with Coin Shop exactly once; it never pushes a second modal or resurfaces on Back',()=>{
 const h=harness(),getMore=h.action('Get More').props.onPress;
 getMore();getMore();h.action('Dismiss insufficient coins').props.onPress();
 assert.deepEqual(h.calls,['/(main)/coin-shop']);h.unmount();
});
test('outside dismissal returns to the originating page once; standalone opening falls back to Home',()=>{
 for(const canBack of [true,false]){const h=harness(canBack),close=h.action('Dismiss insufficient coins').props.onPress;
  close();close();h.action('Get More').props.onPress();assert.deepEqual(h.calls,[canBack?'back':'/(main)/(tabs)']);h.unmount();}
});
test('shared helper navigates rather than pushes duplicates and recognizes only authoritative insufficient_balance',()=>{
 const calls=[],helper=load('apps/mobile/src/lib/insufficient-coins.ts',{'expo-router':{router:{navigate:href=>calls.push(href)}}});
 helper.showInsufficientCoins();assert.deepEqual(calls,['/(main)/insufficient-coins']);
 for(const error of ['insufficient_balance',Error('insufficient_balance'),{body:{error:'insufficient_balance'}}])assert.equal(helper.isInsufficientCoins(error),true);
 for(const error of [null,undefined,'network_error',Error('price_changed'),{body:{error:'plus_required'}}])assert.equal(helper.isInsufficientCoins(error),false);
});
test('all paid entry points use the shared prompt; true coin purchases retain their transparent native route',()=>{
 for(const file of ['burrow-shop','burrow-screen','game-room-screen','surprise-room-screen','toy-collection-screen']){
  const source=fs.readFileSync(`apps/mobile/src/components/burrow/${file}.tsx`,'utf8');
  assert.match(source,/@\/lib\/insufficient-coins/);assert.match(source,/showInsufficientCoins\(\)/);
  assert.doesNotMatch(source,/Not enough carrots|Alert\.alert\('Not enough coins'|coins needed/);
 }
 const layout=fs.readFileSync('apps/mobile/app/(main)/_layout.tsx','utf8');
 assert.match(layout,/name="insufficient-coins" options=\{\{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, contentStyle: \{ backgroundColor: 'transparent' \}/);
 const legacy=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
 assert.match(legacy,/<ScreenOverlay visible=\{!!selected\}/,'legacy native modal must not block the next checkout route');
});
