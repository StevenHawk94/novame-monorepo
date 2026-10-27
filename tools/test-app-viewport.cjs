const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/app-viewport-layout.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
test('compact portrait phones remain pixel-for-pixel full window',()=>{
 for(const [w,h]of [[320,568],[375,667],[390,844],[430,932],[520,1000]])
  assert.deepEqual(plain(model.appViewportLayout(w,h)),{constrained:false,width:w,height:h,left:0,top:0});
});
test('unfolded, landscape, tablet and desktop windows fit a centered 9:16–9:20 canvas without stretching',()=>{
 for(let w=600;w<=1800;w+=73)for(let h=240;h<=1800;h+=79){
  const r=model.appViewportLayout(w,h),ratio=r.width/r.height;
  assert.ok(r.constrained);assert.ok(r.width<=520&&r.width<=w&&r.height<=h);
  assert.ok(ratio>=9/20-1e-10&&ratio<=9/16+1e-10);
  assert.ok(Math.abs(r.left*2+r.width-w)<1e-8);assert.ok(Math.abs(r.top*2+r.height-h)<1e-8);
 }
 for(const [w,h]of [[568,320],[500,320],[900,600]])assert.ok(model.appViewportLayout(w,h).width<=h*9/16);
});
test('full material is preferred on tall displays, while limited height permits a wider phone frame',()=>{
 const tall=model.appViewportLayout(800,900);assert.equal(tall.width,405);assert.equal(tall.height,900);
 const short=model.appViewportLayout(900,600);assert.equal(short.width,337.5);assert.equal(short.height,600);
 const huge=model.appViewportLayout(1200,1600);assert.equal(huge.width,520);assert.ok(huge.top>0);assert.ok(Math.abs(huge.width/huge.height-9/20)<1e-10);
});
test('keyboard resize preserves canvas width; fold/unfold with a new width is still resolved immediately',()=>{
 for(const [w,h]of [[390,844],[800,900],[1200,1600]]){
  const previous={windowWidth:w,frame:model.appViewportLayout(w,h)};
  const r=model.keyboardViewportLayout(w,300,previous,true);assert.equal(r.width,previous.frame.width);assert.ok(r.height<=300);
  assert.deepEqual(plain(model.keyboardViewportLayout(w,h,previous,false)),plain(model.appViewportLayout(w,h)));
  assert.deepEqual(plain(model.keyboardViewportLayout(1000,700,previous,true)),plain(model.appViewportLayout(1000,700)));
 }
});
test('actual hook uses inherited canvas dimensions, while prewarm computes the same geometry outside React',()=>{
 let native={width:1200,height:1600,scale:3,fontScale:1.2},context=null;
 const api=load('apps/mobile/src/lib/app-viewport.ts',{
  react:{createContext:()=>({Provider:'Provider'}),useContext:()=>context},
  'react-native':{useWindowDimensions:()=>native,Dimensions:{get:()=>native}},'./app-viewport-layout':model,
 });
 assert.equal(api.getAppViewport().width,520);assert.equal(api.useAppViewport().width,520);
 context={...native,width:390,height:600};assert.equal(api.useAppViewport().width,390);assert.equal(api.useAppViewport().height,600);
 assert.equal(api.useAppViewport().fontScale,1.2);assert.equal(api.useAppViewport().scale,3);
 const before=api.useAppWindowGeometry();native={...native,width:1400};const after=api.useAppWindowGeometry();
 assert.equal(after.left-before.left,100,'native anchors remeasure even if logical canvas width stays unchanged');
 context=null;native={...native,width:390,height:844};assert.deepEqual(plain(api.getAppViewport()),{...native,constrained:false,left:0,top:0});
});
test('native modal wrapper preserves presentation and onDismiss callbacks instead of changing avatar/camera lifecycle',()=>{
 const jsx=(type,props)=>({type,props}),dismiss=()=>{},close=()=>{};
 const {AppModal}=load('apps/mobile/src/components/layout/app-modal.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Modal:'NativeModal',View:'View',StyleSheet:{absoluteFill:{position:'absolute'}}},
  './app-window-layer':{AppWindowLayer:'CanvasLayer'},'@/lib/app-viewport-layout':model,
 });
 const tree=AppModal({visible:true,transparent:true,animationType:'slide',presentationStyle:'overFullScreen',onDismiss:dismiss,onRequestClose:close,children:'camera-choice'});
 assert.equal(tree.type,'NativeModal');assert.equal(tree.props.onDismiss,dismiss);assert.equal(tree.props.onRequestClose,close);
 assert.equal(tree.props.animationType,'slide');assert.equal(tree.props.presentationStyle,'overFullScreen');
 assert.equal(tree.props.children.props.children.type,'CanvasLayer');assert.equal(tree.props.children.props.children.props.children,'camera-choice');
});
test('window overlay reapplies both horizontal and vertical letterboxing at native-window boundaries',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),canvas=model.appViewportLayout(1200,1600);
 const {AppWindowLayer}=load('apps/mobile/src/components/layout/app-window-layer.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{absoluteFill:{}},useWindowDimensions:()=>({width:1200,height:1600})},
  '@/lib/app-viewport':{useAppViewport:()=>canvas,AppViewportContext:{Provider:'Provider'}},
 });
 let tree=h.render(()=>AppWindowLayer({children:'gift'}));const style=tree.props.children.props.style;
 assert.equal(style.left,canvas.left);assert.equal(style.top,canvas.top);assert.equal(style.width,canvas.width);assert.equal(style.height,canvas.height);assert.equal(style.overflow,'hidden');
 tree.props.onLayout({nativeEvent:{layout:{width:1200,height:1100}}});tree=h.render(()=>AppWindowLayer({children:'gift'}));
 assert.equal(tree.props.children.props.style.height,1100);assert.equal(tree.props.children.props.children.props.value.height,1100);h.unmount();
});
test('ordinary phone overlays retain native fill bounds rather than imposing window pixels on an Android Dialog',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),native={width:390,height:844};
 const {AppWindowLayer}=load('apps/mobile/src/components/layout/app-window-layer.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{absoluteFill:{position:'absolute',top:0,left:0,right:0,bottom:0}},useWindowDimensions:()=>native},
  '@/lib/app-viewport':{useAppViewport:()=>native,AppViewportContext:{Provider:'Provider'}},
 });
 const tree=h.render(()=>AppWindowLayer({children:'native-dialog'}));assert.equal(tree.props.children,'native-dialog');assert.equal(tree.props.style.height,undefined);assert.equal(tree.props.style.width,undefined);h.unmount();
});
test('status-bar contrast changes only on dark letterbox margins, not on existing phone layouts',()=>{
 const jsx=(type,props)=>({type,props});let geometry={left:0,top:0};
 const {AppStatusBar}=load('apps/mobile/src/components/layout/app-status-bar.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'expo-status-bar':{StatusBar:'StatusBar'},'@/lib/app-viewport':{useAppWindowGeometry:()=>geometry},
 });
 assert.equal(AppStatusBar().props.style,'dark');geometry={left:100,top:0};assert.equal(AppStatusBar().props.style,'light');geometry={left:0,top:100};assert.equal(AppStatusBar().props.style,'light');
});
test('real root frame changes geometry without remounting navigation or losing children',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props});let native={width:390,height:844,scale:3,fontScale:1};
 const context={Provider:'ViewportProvider'},keyboard=new Map();
 const {AdaptiveAppFrame}=load('apps/mobile/src/components/layout/adaptive-app-frame.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',StyleSheet:{create:x=>x},useWindowDimensions:()=>native,Keyboard:{isVisible:()=>false,addListener:(event,fn)=>{keyboard.set(event,fn);return{remove:()=>keyboard.delete(event)};}}},
  '@/lib/app-viewport':{AppViewportContext:context},'@/lib/app-viewport-layout':model,
 });
 const children={type:'RetainedNavigator',props:{draft:'unchanged'}};
 let tree=h.render(()=>AdaptiveAppFrame({children}));assert.equal(tree.props.style.backgroundColor,'#3f150b');
 native={...native,width:1200,height:1600};tree=h.render(()=>AdaptiveAppFrame({children}));
 const provider=tree.props.children.props.children;assert.equal(provider.props.children,children);assert.equal(provider.props.value.width,520);
 assert.ok(tree.props.children.props.style[1].height<1600);
 native={...native,width:1400};tree=h.render(()=>AdaptiveAppFrame({children}));assert.equal(tree.props.children.props.children.props.value,provider.props.value,'unchanged canvas does not invalidate all retained pages just because its side margins changed');
 keyboard.get('keyboardDidShow')();native={...native,height:700};tree=h.render(()=>AdaptiveAppFrame({children}));assert.equal(tree.props.children.props.children.props.value.width,520);
 h.unmount();assert.equal(keyboard.size,0);
});
test('all app-owned hook consumers and native Modals use shared canvas boundaries; system/window coordinate adapters are explicit exceptions',()=>{
 const allowed=new Set(['adaptive-app-frame.tsx','app-window-layer.tsx','app-modal.tsx','screen-overlay.tsx','coin-reward-banner.tsx','app-viewport.ts']);
 function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):/\.tsx?$/.test(e.name)?[path.join(p,e.name)]:[]);}
 let consumers=0;
 for(const file of [...walk('apps/mobile/src'),...walk('apps/mobile/app')]){
  const source=fs.readFileSync(file,'utf8');if(source.includes('useAppViewport'))consumers++;
  if(allowed.has(path.basename(file)))continue;
  for(const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g)){
   const names=match[1].split(',').map(n=>n.trim());assert.ok(!names.includes('useWindowDimensions')&&!names.includes('Modal'),file);
  }
 }
 assert.ok(consumers>=50);
});
