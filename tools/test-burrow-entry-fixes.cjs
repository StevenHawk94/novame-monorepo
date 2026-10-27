const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const products=load('apps/mobile/src/lib/burrow-products.ts');
test('Admin catalogue resolves ALL game/frame prices atomically; missing/invalid offers never default to coins',()=>{
 const data=require('../apps/admin/src/generated/shop-art.json');
 const ids=data.categories.surprises.map(f=>f.frameId);
 const catalog=[...ids.map((id,i)=>({stable_id:'surprise:'+id,item_type:'surprise',price:300+i,plus_only:i%2===0})),
  {stable_id:'game:daily_quirks_02',item_type:'game',price:450,plus_only:true}];
 const games=products.burrowProducts(catalog,'game'),frames=products.burrowProducts(catalog,'surprise');
 assert.equal(Object.keys(frames).length,36);assert.equal(games.daily_quirks_02.plus_only,true);assert.equal(games.daily_quirks_02.price,450);
 assert.deepEqual(plain(products.burrowProducts([],'game')),{});
 assert.deepEqual(plain(products.burrowProducts([{stable_id:'game:bad',item_type:'game',price:null,plus_only:false}],'game')),{});
 const content=load('apps/mobile/src/lib/burrow-game-room-content.ts',{'../../../api/src/data/burrow-game-room-v1.json':require('../apps/api/src/data/burrow-game-room-v1.json')});
 const first=content.localGameOverview({products:games}).games.find(g=>g.id==='daily_quirks_02');
 assert.equal(first.plus_only,true);assert.equal(first.price,450);
 assert.equal(content.localGameOverview({products:games}).games.find(g=>g.id==='daily_quirks_01').active,false);
 const source=fs.readFileSync('apps/mobile/src/components/burrow/game-room-screen.tsx','utf8');
 assert.match(source,/burrowProducts\(burrow\?\.catalog\?\?\[\],'game'\)/);
 assert.match(source,/localGameOverview\(\{[\s\S]*?,products\}\)/);
});
test('personal invite survives remount/restart, is independent of pairing, and cannot cross accounts',()=>{
 const disk=new Map();let owner='A';
 const imports={'./storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'../shared/storage/keys':{kPartnerInviteCode:{name:'invite'}},'./session-lifecycle':{sessionUserId:()=>owner}};
 const a=load('apps/mobile/src/lib/partner-invite-cache.ts',imports);
 assert.equal(a.cachedPartnerInvite(),null);a.rememberPartnerInvite('A','ABC123');
 assert.equal(load('apps/mobile/src/lib/partner-invite-cache.ts',imports).cachedPartnerInvite(),'ABC123');
 owner='B';assert.equal(a.cachedPartnerInvite(),null);a.rememberPartnerInvite('A','ZZZ999');assert.equal(a.cachedPartnerInvite('A'),null);
 a.rememberPartnerInvite('B','DEF456');assert.equal(a.cachedPartnerInvite(),'DEF456');
 assert.match(fs.readFileSync('apps/mobile/src/shared/storage/keys.ts','utf8'),/kPartnerInviteCode = defineKey\('burrow_partner_invite_code_v1', 'user'\)/);
});
test('cold Home restores the complete last-confirmed display catalogue; writers still validate current prices',()=>{
 const disk=new Map(),storage={getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)};
 const cache=load('apps/mobile/src/lib/burrow-cache.ts',{'./storage':{storage},'../shared/storage/keys':{kBurrowSnapshot:{name:'snapshot'},kBurrowWallet:{name:'wallet'},kBurrowActionKeys:{name:'actions'}}});
 const data={catalogComplete:true,profile:{id:'A'},partner:null,catalog:[{stable_id:'game:test',price:999,plus_only:true}],roomPhotos:[],memoryEntries:[],moments:[],inventory:[],loadouts:[]};
 cache.persistBurrowSnapshot(data);const restored=cache.readBurrowSnapshot('A');
 assert.equal(restored.data.catalogComplete,true);assert.equal(restored.data.catalog[0].price,999);assert.equal(restored.data.catalog[0].plus_only,true);
});
test('Home without a bootstrap uses a real calendar date, never monotonic uptime',()=>{
 const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
 const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression,clockExpression;
 function visit(n){if(ts.isVariableDeclaration(n)){if(n.name.getText(ast)==='now')expression=n.initializer.getText(ast);if(n.name.getText(ast)==='renderClock')clockExpression=n.initializer.getText(ast);}ts.forEachChild(n,visit);}visit(ast);
 function evaluate(data,clock,receivedAt){return vm.runInNewContext(`const renderClock=${clockExpression};${expression}`,{data,clock,receivedAt,section:'home',focused:true,burrowClock:()=>clock,Math,Number,Date:class extends Date{static now(){return Date.parse('2026-10-15T12:00:00Z');}}});}
 assert.equal(evaluate(null,12345,0),Date.parse('2026-10-15T12:00:00Z'));
 assert.equal(evaluate({serverNow:'invalid'},12345,0),Date.parse('2026-10-15T12:00:00Z'));
 assert.equal(evaluate({serverNow:'2026-10-15T12:00:00Z'},15000,10000),Date.parse('2026-10-15T12:00:05Z'));
});
for(const platform of ['ios','android'])test(`${platform}: storefront refresh cannot change the visible season; all rooms agree until next foreground`,async()=>{
 const disk=new Map(),listeners=[],identities=[],read=deferred();let epoch=1;
 const module=load('apps/mobile/src/lib/use-burrow-storefront.ts',{
  react:{useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:fn=>fn()},
  'react-native':{Platform:{OS:platform},NativeModules:{SettingsManager:{settings:{AppleLocale:'en_AU'}}},AppState:{addEventListener:(_,fn)=>{listeners.push(fn);return{remove(){}};}}},
  'expo-iap':{getStorefront:()=>read.promise},'./storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},
  '../shared/storage/keys':{kBurrowStorefrontCountry:{name:'country'}},'./session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identities.push(fn);return()=>{};}},
  './burrow-map-model':load('apps/mobile/src/lib/burrow-map-model.ts'),
 },{setTimeout,clearTimeout});
 assert.equal(module.useBurrowStorefront(),'AU');read.resolve('USA');await flush();assert.equal(disk.get('country'),'USA');
 assert.equal(module.useBurrowStorefront(),'AU','newly opened rooms use the same foreground region');
 listeners[0]('active');assert.equal(module.useBurrowStorefront(),'USA');
 epoch++;identities.forEach(fn=>fn());assert.equal(module.useBurrowStorefront(),'USA');
});
for(const platform of ['ios','android'])test(`${platform}: name input remains mounted with flexible keyboard height, title, subtitle and submit`,()=>{
 const jsx=(type,props)=>({type,props}),nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 let height=844,name='Alex';
 const module=load('apps/mobile/src/components/onboarding/burrow-onboarding-pages.tsx',{
  '@/components/paywall/burrow-paywall-page': { BurrowPaywallPage: 'Paywall' },
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n])),Platform:{OS:platform},StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390,height}),Linking:{}},
  'expo-image':{Image:'Image'},'expo-status-bar':{StatusBar:'Status'},'expo-linear-gradient':{LinearGradient:'Gradient'},'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},'@expo/vector-icons':{MaterialIcons:'Icon'},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},'@/components/ui/grid-background':{GridBackground:'Grid'},
  '@/lib/burrow-onboarding-design':{ONBOARDING_ART:{},ONBOARDING_FEATURES:[],ONBOARDING_FLOW:['self-info'],onboardingMetrics:()=>({footer:130,padding:24,body:16}),onboardingFeatureMetrics:()=>({}),onboardingWelcomeMetrics:()=>({})},
  './onboarding-pager':{OnboardingImage:'Image',OnboardingPage:'Page',OnboardingPager:'Pager'},'./plus-benefit-icon':{PlusBenefitIcon:'Benefit'},
  './partner-pairing-ui':{PairingCodeSheet:'Code',PairingConnectedPage:'Connected',PairingInviteCard:'Invite'},
 });
 function render(){const tree=module.BurrowOnboardingPages({step:'self-info',firstName:name,setFirstName:v=>name=v,validInfo:true});return nodes(tree).find(n=>n.type==='Page'&&n.props.id==='self-info');}
 for(height of [844,510,390]){
  const tree=render(),list=nodes(tree),avoid=list.find(n=>n.type==='KeyboardAvoidingView'),scroll=list.find(n=>n.type==='ScrollView');
  assert.equal(avoid.props.behavior,platform==='ios'?'padding':undefined);
  assert.equal(scroll.props.contentContainerStyle.minHeight,undefined);
  const input=list.find(n=>n.type==='TextInput');assert.equal(input.props.value,name);input.props.onChangeText('Alexis');
  assert.ok(list.some(n=>n.props?.children==='What should we call you?'));assert.ok(list.some(n=>n.props?.children==='Your partner will see this name.'));
 }
});
