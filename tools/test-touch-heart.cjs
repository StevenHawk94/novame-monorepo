const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const motion=load('apps/mobile/src/lib/touch-heart-motion.ts');
test('whole heart count growth is monotonic, capped at 999, with exactly 50% linear size difference',()=>{
 const {touchHeartScale:s}=motion;assert.equal(s(999)/s(0),1.5);assert.equal(s(-1),s(0));assert.equal(s(1000),s(999));assert.equal(s(NaN),s(0));
 for(let i=1;i<=999;i++)assert.ok(s(i)>s(i-1));
});
test('six fixed flight slots land at meter, pop only on arrival, freeze with logical clock and settle',()=>{
 const {touchHeartFlight:f,touchHeartCollectScale:p,TOUCH_HEART_FLIGHT_MS:d}=motion;
 const bursts=[100,200,300,400,500,600];assert.equal(p(100,bursts),1);assert.equal(p(100+d-1,bursts),1);assert.ok(p(100+d+40,bursts)>1);
 for(let i=0;i<6;i++){const end=f(d,i,-330);assert.ok(Math.abs(end.x)<1e-8);assert.equal(end.y,-330);assert.equal(end.opacity,0);assert.equal(f(-1,i,-330).opacity,0);}
 assert.equal(p(1100,bursts),p(1100,bursts));assert.equal(p(10000,bursts),1);
 for(let t=0;t<3000;t++)assert.ok(p(t,bursts)>=1&&p(t,bursts)<=1.09);
});
test('dense feedback never recycles a flying heart before landing, so collection pops still happen at 999 input density',()=>{
 const q=motion.queueTouchHeartBursts,p=motion.touchHeartCollectScale;let slots=[-1e6,-1e6,-1e6,-1e6,-1e6,-1e6];
 slots=q(slots,0,6);for(let t=100;t<850;t+=100)slots=q(slots,t,6);
 assert.deepEqual(Array.from(slots),[0,0,0,0,0,0]);assert.ok(p(890,slots)>1);
 slots=q(slots,1270,6);assert.deepEqual(Array.from(slots),[1270,1270,1270,1270,1270,1270]);
});
test('actual native heart uses a closed filled silhouette, no progress stroke, count semantics and Reduce Motion',()=>{
 const h=hooks(),styles=[],jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const mod=load('apps/mobile/src/components/burrow/plushie-touch-heart.tsx',{
  react:h.react,'react/jsx-runtime':jsx,'react-native':{View:'View',Text:'Text',StyleSheet:{absoluteFillObject:{}}},
  'react-native-svg':{default:'Svg',Defs:'Defs',LinearGradient:'Gradient',RadialGradient:'Radial',Stop:'Stop',Path:'Path'},
  'react-native-reanimated':{default:{View:'AnimatedView',Text:'AnimatedText'},useAnimatedStyle:fn=>{styles.push(fn);return{};}},'@/lib/touch-heart-motion':motion,
 });
 const clock={value:990},bursts={value:[100,-1e6,-1e6,-1e6,-1e6,-1e6]},all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const tree=h.render(()=>mod.TouchHeartMeter({count:999,clock,bursts,size:160}));
 assert.equal(tree.props.accessibilityLabel,'999 touches collected');assert.ok(styles.at(-1)().transform[0].scale>1);
 const paths=all(tree).filter(n=>n.type==='Path');assert.ok(paths.every(n=>n.props.d.endsWith('Z')));assert.ok(paths.every(n=>!n.props.strokeDasharray));
 assert.equal(paths.length,4);assert.ok(paths.slice(0,3).every(n=>n.props.fill==='#403B30'&&n.props.transform.startsWith('translate(0 ')));
 assert.equal(paths.at(-1).props.fill,'url(#touchHeartBody)');assert.equal(paths.at(-1).props.stroke,undefined);
 assert.ok(!JSON.stringify(tree).includes('touchHeartShine'));assert.ok(!JSON.stringify(tree).includes('touchHeartGlow'));
 h.render(()=>mod.TouchHeartMeter({count:999,clock,bursts,size:160,reduced:true}));assert.equal(styles.at(-1)().transform[0].scale,1);
 const flying=mod.TouchFlyingHearts({clock,bursts,size:300,travelY:-330});assert.equal(flying.props.children.length,6);
 const particle=flying.props.children[0],text=particle.type(particle.props),box=text.props.style[0];
 assert.equal(box.fontSize,30*1.5);assert.equal(box.width,45);assert.equal(box.left+box.width/2,150);assert.equal(box.top+box.height/2,300*.42);h.unmount();
});
