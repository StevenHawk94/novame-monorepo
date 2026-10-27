const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const layout=load('apps/mobile/src/lib/burrow-home-layout.ts');
const jsx=(type,props)=>({type,props});
const asset={source:'letter',width:500,height:500,bounds:[33,78,473,388]};
function nodes(tree){return Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];}
function harness(){
  const h=hooks(),m=motionHarness(h);let active=true,reduced=false;
  const {HomeLoveLetter}=load('apps/mobile/src/components/burrow/home-love-letter.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Text:'Text',View:'View'},
    'react-native-reanimated':m.reanimated,'@/lib/use-adventure-motion':{useAdventureMotion:()=>({active,reduced})},
    '@/lib/burrow-art-assets':{BURROW_FIXED_ART:{letter:asset}},'@/lib/burrow-home-layout':layout,'./burrow-image':{Image:'Image'},
  });
  return {h,m,render:(count=2,scale=390/900)=>nodes(h.render(()=>HomeLoveLetter({count,scale}))),active:v=>{active=v;},reduce:v=>{reduced=v;}};
}
test('envelope keeps original geometry; badge overlaps the actual top-left edge and shows the exact count',()=>{
  const x=harness();
  for(const scale of [320/900,390/900,430/900])for(const count of [0,1,2,10,101]){
    const tree=x.render(count,scale),root=tree[0].props.style[0],image=tree.find(n=>n.type==='Image').props.style;
    const original=layout.homeAnchoredBox(asset,layout.HOME_LETTER_PLACEMENT,scale);
    assert.ok(Math.abs(root.left+image.left-original.left)<1e-9);assert.ok(Math.abs(root.top+image.top-original.top)<1e-9);
    assert.equal(image.width,original.width);assert.equal(image.height,original.height);
    const text=tree.find(n=>n.type==='Text');assert.equal(text?.props.children,count||undefined);
    if(count){const badge=tree.find(n=>n.type==='View').props.style;assert.equal(badge.left,-badge.height/2);assert.equal(badge.top,-badge.height/2);}
  }x.h.unmount();
});
test('unread envelope shakes once per second on the UI thread, stops when read/background/blur/reduced, and cancels on unmount',()=>{
  const x=harness();x.render();const angle=x.m.values[0];assert.equal(angle.loop.count,-1);
  assert.equal(angle.loop.animation.sequence.reduce((sum,s)=>sum+s.config.duration,0),1000);
  angle.current=7;x.render(0);assert.equal(angle.loop,undefined);assert.equal(angle.value,0);
  x.render(1);assert.ok(angle.loop);x.active(false);x.render(1);assert.equal(angle.loop,undefined);assert.equal(angle.value,0);
  x.active(true);x.reduce(true);x.render(1);assert.equal(angle.loop,undefined);
  x.reduce(false);x.render(1);assert.ok(angle.loop);x.h.unmount();assert.equal(angle.loop,undefined);assert.equal(angle.value,0);assert.equal(x.m.time.timers.size,0);
});
