const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const designFile='apps/mobile/src/lib/burrow-onboarding-design.ts';
const assets=Object.fromEntries([...fs.readFileSync(designFile,'utf8').matchAll(/require\('([^']+)'\)/g)].map(m=>[m[1],m[1]]));
const design=load(designFile,assets);
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const style=x=>Object.assign({},...[x].flat(Infinity).filter(Boolean));
function render(width,height,top,bottom,step='decorate'){
  const {BurrowOnboardingPages}=load('apps/mobile/src/components/onboarding/burrow-onboarding-pages.tsx',{
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Pressable','ScrollView','Text','TextInput','View'].map(k=>[k,k])),Platform:{OS:'ios'},StyleSheet:{create:x=>x,absoluteFill:{position:'absolute',top:0,left:0,right:0,bottom:0}},useWindowDimensions:()=>({width,height})},
    'expo-image':{Image:'Image'},'expo-status-bar':{StatusBar:'StatusBar'},'expo-linear-gradient':{LinearGradient:'Gradient'},
    'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},'@expo/vector-icons':{MaterialIcons:'Icon'},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top,bottom})},
    '@/components/paywall/burrow-paywall-page':{BurrowPaywallPage:'Paywall'},'@/lib/burrow-onboarding-design':design,
    './onboarding-pager':{OnboardingImage:'Art',OnboardingPage:'Page',OnboardingPager:'Pager'},
    './partner-pairing-ui':{PairingCodeSheet:'PairingCodeSheet',PairingConnectedPage:'PairingConnectedPage',PairingInviteCard:'PairingInviteCard'},
  });
  const actions=[];
  const tree=BurrowOnboardingPages({step,next:()=>actions.push('next'),saveDate:()=>actions.push('date'),dateInput:jsx('DateWheel',{value:'14/10/2024'}),validDate:true,firstName:'',pairCode:''});
  return {tree,actions,page:id=>nodes(tree).find(n=>n.type==='Page'&&n.props.id===id)};
}
const sizes=[[320,568,20,0],[375,667,20,0],[390,844,47,34],[430,932,59,34],[440,956,62,34]];
for(const [width,height,top,bottom] of sizes)test(`${width}×${height}: welcome logo, bunny and tagline follow the reference composition`,()=>{
 const h=render(width,height,top,bottom,'start'),page=h.page('start'),all=nodes(page),m=design.onboardingWelcomeMetrics(width,height);
 assert.equal(page.props.imageCount,2);
 const logo=all.find(n=>n.type==='Art'&&n.props.source===design.ONBOARDING_ART.wordmark),bunny=all.find(n=>n.type==='Art'&&n.props.source===design.ONBOARDING_ART.welcome);
 for(const image of [logo,bunny]){assert.equal(image.props.contentFit,'contain');assert.equal(image.props.contentPosition,'center');
  assert.equal(image.props.style.left+image.props.style.width/2,width/2);}
 assert.equal(logo.props.style.top,m.wordmarkTop);assert.equal(bunny.props.style.top,m.bunnyTop);
 const copy=all.find(n=>n.type==='Text'&&String(n.props.children).startsWith('Build a cozy'));
 assert.equal(style(copy.props.style).top,m.copyTop);
 assert.ok(m.copyTop+design.onboardingMetrics(width,height,top,bottom).body*1.4*3<height-design.onboardingMetrics(width,height,top,bottom).footer);
 assert.equal(all.some(n=>n.props?.accessibilityLabel?.startsWith('Page ')),false,'welcome does not show a progress indicator');
});
for(const [width,height,top,bottom] of sizes)test(`${width}×${height}: six complete illustrations and identical title/copy anchors above the footer`,()=>{
  const h=render(width,height,top,bottom),m=design.onboardingMetrics(width,height,top,bottom),f=design.onboardingFeatureMetrics(width,height,top,bottom);
  assert.ok(f.artTop>=top);
  assert.ok(f.artWidth<=width*.92+.001);
  assert.equal(f.artWidth,f.artHeight);
  assert.ok(f.titleTop>=f.artTop+f.artHeight+width*.1-.001);
  assert.ok(f.titleTop+f.title*1.2+f.copyGap+m.body*1.35*3+24<=height-f.footer+.001,'reserve space for the longest three-line description');
  assert.ok(f.title*10.217<=width-2*m.padding,'widest Inter ExtraBold title fits without page-specific autosizing');
  for(const feature of design.ONBOARDING_FEATURES){
    const page=h.page(feature.id),all=nodes(page),art=all.find(n=>n.type==='Art'),box=all.find(n=>n.props?.children===art);
    assert.equal(page.props.imageCount,1,'keep staged image readiness');
    assert.equal(art.props.source,feature.image);
    assert.equal(art.props.contentFit,'contain');
    assert.equal(box.props.style.width,f.artWidth);assert.equal(box.props.style.height,f.artHeight);
    assert.ok(!all.some(n=>n.type==='Svg'||(typeof n.type==='function'&&n.type.name==='Curve')),'no lower-edge masking of new artwork');
    const title=all.find(n=>n.type==='Text'&&n.props.children===feature.title),copy=all.find(n=>n.type==='Text'&&n.props.children===feature.description);
    assert.equal(style(title.props.style).fontSize,f.title);assert.equal(style(title.props.style).lineHeight,f.title*1.2);
    assert.equal(title.props.adjustsFontSizeToFit,undefined,'titles must not shrink to a different size on individual pages');
    const copyBox=all.find(n=>nodes(n.props?.children).includes(title)&&n.type==='View'&&style(n.props.style).paddingBottom===24);
    assert.ok(copyBox);
    assert.equal(f.artTop+box.props.style.height+style(copyBox.props.style).marginTop,f.titleTop);
    assert.equal(style(copy.props.style).marginTop,f.copyGap);
    assert.equal(style(copy.props.style).fontSize,m.body);
    assert.equal(all.find(n=>n.props?.accessibilityLabel===`Page ${design.ONBOARDING_FEATURES.indexOf(feature)+1} of 6`).props.children.length,6);
  }
  assert.equal(nodes(h.tree).find(n=>n.type==='StatusBar').props.style,'dark','cream area remains legible for status-bar icons');
});
test('relationship date has no scrollable ancestor, preserves the wheel and its Continue action',()=>{
  const h=render(320,568,20,0,'relationship-date'),page=h.page('relationship-date'),all=nodes(page);
  assert.ok(!all.some(n=>n.type==='ScrollView'),'only embedded month/day/year wheels should scroll');
  assert.equal(all.filter(n=>n.type==='DateWheel').length,1);
  const body=page.props.children[0];assert.equal(body.type,'View');assert.equal(body.props.style.flex,1);
  const button=all.find(n=>typeof n.type==='function'&&n.props.label==='Continue');
  assert.equal(button.props.disabled,false);button.props.onPress();assert.deepEqual(h.actions,['date']);
});
test('updated feature assets all retain their 800×800 canvas and reference copy',async()=>{
  const {sharp}=require('../apps/mobile/plugins/branding-assets.cjs');
  for(const feature of design.ONBOARDING_FEATURES){
    const source=require('node:path').resolve('apps/mobile/src/lib',feature.image);
    const meta=await sharp(source).metadata();assert.equal(meta.width,800);assert.equal(meta.height,800);
  }
  assert.equal(design.ONBOARDING_FEATURES.find(f=>f.id==='explore').description,'Let your bunny explore the burrow, find gifts and meet new friends!');
  assert.deepEqual(Array.from(design.ONBOARDING_FEATURES,f=>f.id),['decorate','toy','affection','surprise','games','explore']);
  assert.deepEqual(Array.from(design.ONBOARDING_FLOW).slice(0,4),['start','decorate','toy','affection'],'swap the first two feature pages, not the welcome artwork or image/copy bindings');
  assert.match(design.ONBOARDING_FEATURES.find(f=>f.id==='surprise').image,/ob5.webp$/);
});
