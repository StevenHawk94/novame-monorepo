const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,clock}=require('./lifecycle-test-utils.cjs');
function harness(type='kiss'){
  const h=hooks(),time=clock(),calls=[];let handlers,appListener,focused=true;
  const app={currentState:'active',addEventListener:(_name,fn)=>{appListener=fn;return {remove(){}};}};
  const jsx=(type,props)=>({type,props});
  const {AffectionGesture}=load('apps/mobile/src/components/burrow/affection-gesture.tsx',{
    react:{...h.react,useMemo:fn=>fn()},'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:app,PanResponder:{create:value=>{handlers=value;return {panHandlers:value};}},Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:value=>value}},
    '@react-navigation/native':{useIsFocused:()=>focused},'@/lib/haptics':{haptics:{light:async()=>{}}},'react-native-svg':{default:'Svg',Path:'Path'},
  },{...time.globals,performance:{now:()=>time.globals.Date.now()},setInterval:()=>1,clearInterval(){}});
  const render=()=>h.render(()=>AffectionGesture({type,disabled:false,onComplete:metrics=>calls.push(metrics)}));
  function find(node,label){if(!node)return;if(Array.isArray(node))return node.map(n=>find(n,label)).find(Boolean);if(node.props?.accessibilityLabel===label)return node;return find(node.props?.children,label);}
  return {time,calls,render,handlers:()=>handlers,press:label=>{const node=find(render(),label);assert.ok(node,label);node.props.onPress();},background:()=>{app.currentState='background';appListener('background');},blur:()=>{focused=false;render();}};
}
test('accessible affection requires 3 seconds and explicit confirmation',()=>{
  const h=harness();h.press('Use accessible gesture');h.render();h.time.advance(2999);
  h.press('Cancel accessible gesture');assert.equal(h.calls.length,0);
  h.press('Use accessible gesture');h.render();h.time.advance(3000);assert.equal(h.calls.length,0);
  h.press('Send love');assert.equal(h.calls.length,1);assert.equal(h.calls[0].assistedHoldMs,3000);
});
test('background cancels accessible countdown and cannot implicitly send',()=>{
  const h=harness();h.press('Use accessible gesture');h.render();h.background();h.render();h.time.advance(10000);
  assert.equal(h.calls.length,0);h.press('Use accessible gesture');assert.equal(h.calls.length,0);
});
test('background or blur prevents an old hold release from completing',()=>{
  for(const change of ['background','blur']){
    const h=harness('hug');h.render();h.handlers().onPanResponderGrant();h.render();h.time.advance(5000);h[change]();h.handlers().onPanResponderRelease();assert.equal(h.calls.length,0);
  }
});
