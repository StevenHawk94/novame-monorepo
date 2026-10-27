const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush,clock}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const {rewardHarness,nodes,jsx,motionModel}=require('./adventure-reward-test-utils.cjs');
const layout=load('apps/mobile/src/lib/adventure-screen-layout.ts');
const M=motionModel.ADVENTURE_REWARD_MOTION;
test('optional sunburst prewarming failures retain the recorded scene and release any allocated surface',()=>{
  const {api,Skia}=require('./adventure-sunburst-test-utils.cjs').sceneHarness();
  const picture=api.adventureSunburstScene(100,200,500);let disposed=0;
  Skia.Surface.MakeOffscreen=()=>null;
  assert.doesNotThrow(()=>api.warmAdventureSunburst(picture,100,200,500));
  Skia.Surface.MakeOffscreen=()=>({getCanvas:()=>{throw Error('unsupported context');},dispose:()=>disposed++});
  assert.doesNotThrow(()=>api.warmAdventureSunburst(picture,100,200,500));assert.equal(disposed,1);
  assert.ok(picture);
});
test('reward starts inside the chest, rises continuously and is fully airborne before the sunburst fades in',()=>{
  const frame=motionModel.rewardRevealFrame,glow=motionModel.rewardSunburstOpacity;
  const rise=200;
  assert.equal(frame(M.revealStart,rise).translateY,rise);
  assert.equal(frame(M.revealStart,rise).scale,0);
  assert.equal(frame(M.revealStart,rise).opacity,0);
  const emerging=frame(M.revealStart+.02,rise);
  assert.ok(emerging.translateY>rise*.8,'the first visible small item is still at the box, not its final location');
  assert.ok(emerging.scale>0&&emerging.scale<.1);assert.equal(emerging.opacity,1);
  let previous=rise;
  for(let i=0;i<=100;i++){
    const p=M.revealStart+(M.revealPeak-M.revealStart)*i/100,f=frame(p,rise);
    assert.ok(f.translateY<=previous&&f.translateY>=0);previous=f.translateY;
    assert.equal(glow(p),0,'no rays behind the box during flight');
  }
  assert.equal(frame(M.revealPeak,rise).translateY,0);assert.equal(frame(1,rise).scale,1);
  assert.equal(glow(M.burstStart),0);assert.equal(glow(M.burstEnd),1);
  assert.ok(glow((M.burstStart+M.burstEnd)/2)>.49&&glow((M.burstStart+M.burstEnd)/2)<.51);
});
for(const variant of ['treasure','gift'])test(`${variant}: the rendered reward follows the same box-to-card flight and three rebounds`,()=>{
  const x=rewardHarness({variant});x.render();
  const get=()=>x.render().find(n=>n.props.testID==='adventure-reward-product');
  const rise=variant==='gift'?motionModel.adventureGiftLayout(390,844,20,0).boxCenterY-motionModel.adventureGiftLayout(390,844,20,0).centerY:layout.adventureTreasureLayout(390,844).rewardRise;
  for(const p of [M.revealStart,M.revealStart+.02,...motionModel.REWARD_REVEAL_KEYFRAMES.map(f=>f[0]),1]){
    x.motion.values[0].current=p;
    const style=get().props.style.at(-1),expected=motionModel.rewardRevealFrame(p,rise);
    assert.equal(style.opacity,expected.opacity);assert.equal(style.transform[0].translateY,expected.translateY);
    assert.equal(style.transform[1].scale,expected.scale);
  }
  x.h.unmount();
});
for(const variant of ['treasure','gift'])test(`${variant}: bare product stays centered; rays finish appearing before copy fades in`,()=>{
  const x=rewardHarness({variant}),tree=x.render();
  const product=tree.find(n=>n.props.testID==='adventure-reward-product');
  assert.ok(product);assert.equal(product.props.style[0].backgroundColor,undefined);assert.equal(product.props.style[0].borderRadius,undefined);
  const rect=product.props.style[1],burst=tree.find(n=>n.type==='Sunburst').props;
  assert.equal(rect.left+rect.width/2,burst.centerX);assert.equal(rect.top+rect.height/2,burst.centerY);
  const art=nodes(product).find(n=>n.type==='Image'&&n.props.source==='lamp');
  assert.equal(art.props.contentFit,'contain');assert.equal(art.props.style[1].width,rect.width-36,'removing the white frame must not enlarge the product');
  const heading=()=>x.render().find(n=>n.props.testID==='adventure-reward-heading').props.style.at(-1);
  assert.ok(M.revealPeak<M.burstStart&&M.burstEnd<M.textStart);
  for(const p of [0,M.revealPeak,M.burstStart,(M.burstStart+M.burstEnd)/2,M.burstEnd,M.textStart]){
    x.motion.values[0].current=p;assert.equal(heading().opacity,0,'no settlement copy before the rays are fully visible');
  }
  x.motion.values[0].current=(M.textStart+M.textEnd)/2;
  assert.ok(Math.abs(heading().opacity-.5)<1e-8);assert.equal(heading().transform,undefined,'copy fades without shifting its layout');
  x.motion.values[0].current=1;assert.equal(heading().opacity,1);
  if(variant==='gift'){
    const headingRect=tree.find(n=>n.props.testID==='adventure-reward-heading').props.style[1];
    const name=tree.find(n=>n.props.testID==='adventure-reward-name');
    assert.ok(headingRect.top+36<rect.top,'You receive stays above the product');
    assert.ok(name.props.style[1].top>rect.top+rect.height,'name stays below the product');
    assert.equal(x.render().find(n=>n.props.testID==='adventure-reward-name').props.style.at(-1).opacity,1,'both lines share the same fade');
  }
  x.h.unmount();
});
test('settlement copy fade is smooth, bounded and cannot overtake the sunburst',()=>{
  const opacity=motionModel.rewardTextOpacity;
  assert.equal(opacity(-1),0);assert.equal(opacity(M.burstEnd),0);assert.equal(opacity(M.textStart),0);assert.equal(opacity(M.textEnd),1);assert.equal(opacity(2),1);
  let last=0;for(let i=0;i<=1000;i++){
    const p=i/1000,value=opacity(p);assert.ok(value>=last&&value<=1);last=value;
    if(value>0)assert.equal(motionModel.rewardSunburstOpacity(p),1);
  }
});
test('the UI-thread curve follows 0 → 130 → 100 → 120 → 100 → 110 → 100 with smooth bounded peaks',()=>{
  const scale=motionModel.rewardRevealScale;
  assert.equal(scale(0),0);assert.equal(scale(M.revealStart),0);assert.equal(scale(M.revealPeak),1.3);assert.equal(scale(M.revealEnd),1);assert.equal(scale(1),1);
  for(const [p,value] of motionModel.REWARD_REVEAL_KEYFRAMES) {
    assert.equal(scale(p),value);
    assert.ok(Math.abs(scale(p-.00001)-scale(p+.00001))<.00001,'all extrema join continuously');
  }
  for(let i=0;i<=1000;i++)assert.ok(scale(i/1000)>=0&&scale(i/1000)<=1.3);
  assert.ok(Math.abs(scale(M.revealPeak-.0001)-scale(M.revealPeak+.0001))<.00001);
});
for(const variant of ['treasure','gift']) {
  test(`${variant}: idle wobble repeats once per second, Open is local and rapid taps start exactly one ceremony`,()=>{
    const x=rewardHarness({variant});const tree=x.render();
    assert.equal(x.motion.values[1].loop.count,-1);
    assert.equal(x.motion.values[1].loop.animation.sequence[0].config.duration,M.idlePause);
    assert.equal(x.motion.values[1].loop.animation.sequence.reduce((sum,step)=>sum+step.config.duration,0),1000);
    const rect=tree.find(n=>n.type==='Button').props.style;
    const open=x.button().props.onPress;for(let i=0;i<50;i++)open();
    assert.equal(x.calls.filter(c=>c==='haptic').length,1);assert.equal(x.calls.includes('claim'),false);
    assert.equal(x.button().props.disabled,true);
    assert.equal(x.motion.timings.filter(t=>t.config.duration===M.opening).length,1);
    assert.equal(x.motion.values[1].loop,undefined,'idle loop stops on Open');
    assert.deepEqual(x.render().find(n=>n.type==='Button').props.style,rect,'box geometry cannot reflow during opening');
    x.motion.time.advance(M.opening-1);assert.equal(x.button().props.disabled,true);
    x.motion.time.advance(1);assert.equal(x.button().props.accessibilityLabel,'Claim');assert.equal(x.calls.includes('claim'),false);
    assert.ok(x.render().some(n=>n.type==='Image'&&n.props.source==='lamp'));x.h.unmount();
  });
  test(`${variant}: Claim is explicit, protected during pending receipt and can retry a failed attempt`,async()=>{
    const x=rewardHarness({variant,reduced:true});x.render();x.button().props.onPress();
    const claim=x.button().props.onPress;claim();claim();claim();
    assert.equal(x.calls.filter(c=>c==='claim').length,1);assert.equal(x.button().props.disabled,true);
    x.request.reject(Error('offline'));await flush();assert.equal(x.button().props.disabled,false);
    assert.equal(x.button().props.accessibilityLabel,'Claim');x.h.unmount();
  });
  test(`${variant}: blur/background mid-opening finishes visual state but never claims`,()=>{
    const x=rewardHarness({variant});x.render();x.button().props.onPress();x.active(false);
    assert.equal(x.button().props.accessibilityLabel,'Claim');assert.equal(x.motion.values[0].value,1);
    x.motion.time.advance(5000);assert.equal(x.calls.includes('claim'),false);
    assert.equal(x.render().find(n=>n.type==='Sunburst').props.active,false);
    x.active(true);assert.equal(x.button().props.accessibilityLabel,'Claim');x.h.unmount();
  });
  test(`${variant}: reduced motion disables idle loops and reveals immediately, including a mid-flight preference change`,()=>{
    const x=rewardHarness({variant,reduced:true});x.render();assert.equal(x.motion.values[1].loop,undefined);
    x.button().props.onPress();assert.equal(x.button().props.accessibilityLabel,'Claim');
    assert.equal(x.motion.timings.filter(t=>t.config.duration===M.opening).length,0);x.h.unmount();
    const y=rewardHarness({variant});y.render();y.button().props.onPress();y.reduce(true);
    assert.equal(y.button().props.accessibilityLabel,'Claim');y.h.unmount();
  });
  test(`${variant}: unmount cancels all animations and cannot navigate/award from stale callbacks`,()=>{
    const x=rewardHarness({variant});x.render();x.button().props.onPress();x.h.unmount();x.motion.time.advance(50000);
    assert.equal(x.calls.includes('closed'),false);assert.equal(x.calls.includes('claim'),false);assert.equal(x.motion.time.timers.size,0);
  });
}
test('claim keeps the complete opaque reward visible for its navigation owner; no pre-navigation fade',()=>{
  const x=rewardHarness({variant:'gift'});x.render();x.button().props.onPress();x.motion.time.advance(M.opening);
  x.button().props.onPress();assert.equal(x.calls.filter(c=>c==='claim').length,1);
  assert.ok(x.render().some(n=>n.type==='Image'&&n.props.source==='lamp'));
  assert.equal(x.motion.timings.some(t=>t.config.duration===180),false);x.h.unmount();
  const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-encounter-card.tsx','utf8');
  assert.doesNotMatch(source,/AdventureRewardPopup|<Modal|setClosing|onClosed/);
  assert.match(source,/queueAdventureDelivery\(adventure.id, \{ finish: true \}\)/);
});
test('empty gift finishes honestly without inventing a reward or playing an empty box ceremony',()=>{
  const x=rewardHarness({variant:'gift',empty:true});x.render();
  assert.equal(x.render().filter(n=>n.type==='GiftBox').length,0);assert.equal(x.button().props.accessibilityLabel,'Finish adventure');
  x.button().props.onPress();assert.equal(x.calls.filter(c=>c==='claim').length,1);x.h.unmount();
});
test('130% reward and complete footer/title fit SE, normal and tall screens in the app’s portrait orientation',()=>{
  for(const [w,h,top,bottom] of [[320,568,20,0],[375,667,20,0],[390,844,47,34],[430,932,59,34]]) {
    const g=motionModel.adventureGiftLayout(w,h,top,bottom),t=layout.adventureTreasureLayout(w,h-top-12-Math.max(16,bottom));
    assert.ok(g.cardSize*1.3<w-48);assert.ok(g.cardTop-g.cardSize*.15>g.titleTop+72);
    assert.ok(g.prizeTop+112<h-g.footerBottom-g.buttonHeight-8);
    assert.ok(t.rewardTop+t.rewardSize*1.15<t.chestTarget.top,'even the 130% peak clears the open lid');
    for(let p=M.textStart+.001;p<=1;p+=.001){
      const scale=motionModel.rewardRevealScale(p),outset=t.rewardSize*(scale-1)/2;
      assert.ok(t.rewardTop-outset>t.foundTop+58,'visible type heading clears the animated product');
      assert.ok(t.nameTop>t.rewardTop+t.rewardSize+outset,'visible style caption clears the animated product');
    }
    assert.ok(t.nameTop+46<t.chestTarget.top,'two-line style name clears the chest');
  }
});
test('sunburst prewarms one recorded two-paint picture before reveal, reuses it and cancels offscreen',()=>{
  const h=hooks(),m=motionHarness(h),scene=require('./adventure-sunburst-test-utils.cjs').sceneHarness();
  const {AdventureSunburst}=load('apps/mobile/src/components/burrow/adventure-sunburst.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{StyleSheet:{absoluteFillObject:{}}},
    'react-native-reanimated':m.reanimated,'@/lib/adventure-reward-motion':motionModel,
    '@/lib/adventure-sunburst-scene':scene.api,
    '@shopify/react-native-skia':{Canvas:'Canvas',Group:'Group',Picture:'Picture',vec:(x,y)=>({x,y})},
  });
  const props={width:375,height:667,centerX:187.5,centerY:300,progress:{value:0},active:true,reduced:false};
  const render=()=>nodes(h.render(()=>AdventureSunburst(props)));
  const tree=render(),opacity=()=>render().find(n=>n.type==='AnimatedView').props.style.at(-1).opacity;
  assert.equal(opacity(),0);assert.equal(scene.paths.length,1);assert.equal(scene.paths[0].moves.length,12);
  assert.equal(scene.gradients.length,2);assert.equal(scene.calls.filter(c=>c[0]==='warm-picture').length,1);
  assert.equal(scene.calls.filter(c=>c[0]==='path').length,1);
  assert.equal(scene.calls.filter(c=>c[0]==='circle').length,1);
  assert.equal(tree.filter(n=>n.type==='Picture').length,1);
  props.progress.value=M.revealPeak;assert.equal(opacity(),0);
  props.progress.value=(M.burstStart+M.burstEnd)/2;assert.ok(Math.abs(opacity()-.5)<1e-8);
  props.progress.value=1;assert.equal(opacity(),1);
  assert.equal(tree.find(n=>n.type==='Group').props.opacity,undefined,'recorded pictures must fade through their native wrapper, not inherited paint opacity');
  for(const gradient of scene.gradients){
    assert.ok(gradient.colors.at(-1).endsWith('00'));assert.equal(gradient.positions.at(-1),1);
    assert.ok(gradient.radius<=props.centerY&&gradient.radius<=props.height-props.centerY);
  }
  assert.equal(m.values[0].loop.animation.config.duration,36000);render();assert.equal(scene.paths.length,1);
  assert.equal(scene.calls.filter(c=>c[0]==='warm-picture').length,1,'Open must not trigger another shader warmup');
  props.active=false;render();assert.equal(m.values[0].loop,undefined);
  props.reduced=true;props.active=true;render();assert.equal(m.values[0].loop,undefined);h.unmount();
});
test('reward title reserves two lines and animates its container rather than relaying out fitted text',()=>{
  const x=rewardHarness();const tree=x.render();
  const title=tree.find(n=>n.type==='Text'&&n.props.children==='You found new Floor Lamps');
  assert.ok(title);assert.equal(title.props.numberOfLines,2);assert.equal(title.props.style.fontSize,22);
  const container=tree.find(n=>n.type==='AnimatedView'&&nodes(n.props.children).includes(title));
  assert.equal(container.props.style[0].height,58);x.h.unmount();
});
test('treasure heading reuses every Shop category name, with style name separate below the product',()=>{
  const {BURROW_SHOP_CATEGORIES,burrowShopCategoryName}=load('apps/mobile/src/lib/burrow-shop-categories.ts');
  for(const category of BURROW_SHOP_CATEGORIES){
    const x=rewardHarness();x.props.item.category=category;const tree=x.render();
    const heading=tree.find(n=>n.props.testID==='adventure-reward-heading');
    assert.equal(nodes(heading).find(n=>n.type==='Text').props.children,`You found new ${burrowShopCategoryName(category)}`);
    const name=tree.find(n=>n.props.testID==='adventure-reward-name');
    assert.equal(nodes(name).find(n=>n.type==='Text').props.children,'Classic Lantern');
    const product=tree.find(n=>n.props.testID==='adventure-reward-product').props.style[1];
    assert.ok(name.props.style[1].top>product.top+product.height);x.h.unmount();
  }
  const empty=rewardHarness({empty:true}),tree=empty.render();
  assert.equal(tree.some(n=>n.props.testID==='adventure-reward-name'),false,'no invented style for an exhausted treasure collection');empty.h.unmount();
});
test('sunburst fade radius cannot expose the top or bottom canvas edge on compact or tall screens',()=>{
  for(const [w,h] of [[320,500],[375,620],[390,760],[430,850]])for(const y of [h*.2,h*.35,h*.47]){
    const r=motionModel.adventureSunburstRadius(w,h,y);
    assert.ok(r>0&&r<=y&&r<=h-y);
  }
});
test('the reward rises in front of the open lid but behind the chest front, with identical artwork registration',()=>{
  const x=rewardHarness();let tree=x.render();
  const reward=tree.find(n=>n.props.testID==='adventure-reward-product');
  const front=tree.find(n=>n.type==='View'&&n.props.style?.some?.(s=>s?.overflow==='hidden'&&s?.position==='absolute'));
  const chest=tree.find(n=>n.type==='Button'&&n.props.accessibilityLabel==='Tap to open treasure chest');
  assert.ok(tree.indexOf(chest)<tree.indexOf(reward)&&tree.indexOf(reward)<tree.indexOf(front));
  assert.equal(front.props.pointerEvents,undefined,'ancestor disables hit testing so Open/Claim remain reachable');
  for(const [w,h] of [[320,500],[390,760],[430,850]]){
    const t=layout.adventureTreasureLayout(w,h),clip=t.chestFrontClip,img=t.chestFrontImage;
    assert.equal(clip.left+img.left,t.chestImage.left);
    assert.ok(Math.abs(clip.top+img.top-t.chestImage.top)<1e-8);
    assert.equal(img.width,t.chestImage.width);assert.equal(img.height,t.chestImage.height);
    assert.ok(t.rewardTop+t.rewardSize/2+t.rewardRise>t.chestTarget.top+clip.top,'starting point is inside the body, behind the front lip');
  }
  x.h.unmount();
});
function nativeRevealHarness(){
  const time=clock(),timings=[],values=[];
  class Value{
    constructor(value){this.value=value;values.push(this);}
    stopAnimation(){time.globals.clearTimeout(this.timer);}
    setValue(value){this.value=value;}
    interpolate({outputRange}){return{source:this,outputRange};}
  }
  return{time,timings,values,native:{Animated:{Value,timing(value,options){const job={options,stopped:false};
    return{start(done){timings.push(job);job.done=done;value.timer=time.globals.setTimeout(()=>{value.value=options.toValue;done({finished:true});},(options.delay||0)+options.duration);},
      stop(){job.stopped=true;value.stopAnimation();}};
  }},Easing:{out:curve=>curve,cubic:'cubic'}}};
}
test('reply reveal notifies only after native entrance completion, once, and never after leaving the scene',()=>{
 const h=hooks(),m=nativeRevealHarness();let active=true,calls=0;
 const {AdventureReveal}=load('apps/mobile/src/components/burrow/adventure-reveal.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':m.native,'../ui/native-animated-content':{NativeAnimatedContent:'AnimatedView'},
  '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active,reduced:false})},'@/lib/adventure-reward-motion':motionModel,
 });
 const render=()=>h.render(()=>AdventureReveal({children:'First reply',delay:90,onVisible:()=>calls++}));
 render();m.time.advance(90+M.entrance-1);assert.equal(calls,0);m.time.advance(1);assert.equal(calls,1);
 render();active=false;render();active=true;render();assert.equal(calls,1);
 h.unmount();m.time.advance(1000);assert.equal(calls,1);
 const hidden=hooks();let hiddenCalls=0;
 const other=load('apps/mobile/src/components/burrow/adventure-reveal.tsx',{
  react:hidden.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':m.native,'../ui/native-animated-content':{NativeAnimatedContent:'AnimatedView'},
  '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active:true,reduced:false})},'@/lib/adventure-reward-motion':motionModel,
 });
 hidden.render(()=>other.AdventureReveal({children:'Reply',onVisible:()=>hiddenCalls++}));hidden.unmount();m.time.advance(1000);assert.equal(hiddenCalls,0);
});
test('staggered entrances reserve geometry, hide touch/accessibility until visible and do not restart on refresh',()=>{
  const h=hooks(),m=nativeRevealHarness();let active=true,reduced=false;
  const {AdventureReveal}=load('apps/mobile/src/components/burrow/adventure-reveal.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':m.native,'../ui/native-animated-content':{NativeAnimatedContent:'AnimatedView'},
    '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active,reduced})},'@/lib/adventure-reward-motion':motionModel,
  });
  const render=()=>h.render(()=>AdventureReveal({children:'button',delay:300,style:{height:60}}));
  let tree=render();assert.equal(tree.props.pointerEvents,'none');assert.equal(tree.props.accessibilityElementsHidden,true);assert.equal(tree.props.style[0].height,60);
  render();assert.equal(m.timings.length,1);assert.equal(m.timings[0].options.useNativeDriver,true);
  assert.equal(m.timings[0].options.easing,'cubic');m.time.advance(559);assert.equal(render().props.pointerEvents,'none');
  m.time.advance(1);assert.equal(render().props.pointerEvents,'auto');render();assert.equal(m.timings.length,1);
  active=false;render();active=true;render();assert.equal(m.timings.length,1);h.unmount();
});
test('staggered entrance cannot leave invisible controls after backgrounding or reduced-motion changes',()=>{
  for(const mode of ['background','reduce']){
    const h=hooks(),m=nativeRevealHarness();let active=true,reduced=false;
    const {AdventureReveal}=load('apps/mobile/src/components/burrow/adventure-reveal.tsx',{
      react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':m.native,'../ui/native-animated-content':{NativeAnimatedContent:'AnimatedView'},
      '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active,reduced})},'@/lib/adventure-reward-motion':motionModel,
    });const render=()=>h.render(()=>AdventureReveal({children:'button',delay:300}));render();
    if(mode==='background')active=false;else reduced=true;render();assert.equal(render().props.pointerEvents,'auto');assert.equal(m.values[0].value,1);h.unmount();
  }
});
test('native reveal preserves live content and cannot expose controls from a cancelled completion after unmount',()=>{
  const h=hooks(),m=nativeRevealHarness();let child='old';
  const {AdventureReveal}=load('apps/mobile/src/components/burrow/adventure-reveal.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':m.native,'../ui/native-animated-content':{NativeAnimatedContent:'AnimatedView'},
    '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active:true,reduced:false})},'@/lib/adventure-reward-motion':motionModel,
  });
  const render=()=>h.render(()=>AdventureReveal({children:child,delay:300}));
  let tree=render();const nativeNode=tree.props.style[1].opacity;
  child='latest';tree=render();assert.equal(tree.props.renderScene(),'latest');assert.equal(tree.props.style[1].opacity,nativeNode);
  assert.equal(m.timings.length,1);h.unmount();assert.equal(m.timings[0].stopped,true);assert.equal(m.time.timers.size,0);
  m.timings[0].done({finished:true});assert.equal(tree.props.pointerEvents,'none');
  const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-reveal.tsx','utf8');
  assert.doesNotMatch(source,/useSharedValue|useAnimatedStyle|progress\.value/,'no per-frame Reanimated/Fabric prop commits or synchronous UI reads');
});
test('current reward background and entrance primitives remain; the digging page is immediately visible inside its existing stage transition',()=>{
  assert.ok(fs.existsSync('apps/mobile/assets/burrow-webp/adventure finish-bg.webp.webp'));
  assert.match(fs.readFileSync('apps/mobile/src/lib/burrow-art-assets.ts','utf8'),/adventure finish-bg\.webp\.webp/);
  for(const f of ['entry','record-completion','encounter-layout','encounter-card','reward-screen'])assert.match(fs.readFileSync(`apps/mobile/src/components/burrow/adventure-${f}.tsx`,'utf8'),/AdventureReveal/);
  const progress=fs.readFileSync('apps/mobile/src/components/burrow/adventure-progress-screen.tsx','utf8');
  assert.match(progress,/AdventureDiggingRoute/);assert.doesNotMatch(progress,/AdventureReveal|AdventureVideo/);
  assert.match(fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8'),/<AdventureStageTransition stageKey="ongoing">\s*<AdventureProgressScreen/);
});
