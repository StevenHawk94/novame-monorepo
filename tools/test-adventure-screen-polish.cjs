const {presentationImports}=require('./motion-test-utils.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush,deferred}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/adventure-screen-layout.ts');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
test('responsive treasure keeps one image rect/baseline; reward and footer fit small/normal/tall screens',()=>{
  for(const [w,h] of [[320,520],[390,751],[430,827]]) {
    const l=model.adventureTreasureLayout(w,h),scale=l.chest.width/600;
    assert.ok(Math.abs(l.chest.top+589*scale-l.chestBottom)<.001);
    assert.equal(l.chestTarget.width,l.chestWidth);
    assert.ok(l.rewardTop+l.rewardSize<=l.chestTarget.top+1,'reward stays above open lid');
    assert.ok(l.chestBottom<h-l.buttonHeight-40,'space for note and Claim');
    assert.ok(l.chestTarget.left>=0);assert.ok(l.chestTarget.left+l.chestWidth<=w);
    const p=model.adventureProgressLayout(w,h+48,20,16);
    assert.ok(p.routeTop+p.routeHeight<p.statusTop);
    assert.ok(p.statusTop+p.statusHeight<p.footerTop);
  }
});
test('server-time countdown and ordinal suffixes; reward preserves the full source canvas',()=>{
  assert.equal(model.adventureCountdown(8472000),'2:21:12');assert.equal(model.adventureCountdown(-10),'0:00:00');
  for(const [n,text] of [[1,'1st '],[2,'2nd '],[3,'3rd '],[11,'11th '],[12,'12th '],[13,'13th '],[21,'21st ']])assert.equal(model.adventureOrdinal(n),text);
  assert.equal(model.adventureOrdinal(null),'');
  const r=model.adventureRewardArtLayout({width:600,height:600,bounds:[200,150,400,550]},120);
  assert.equal(r.height,120);assert.equal(r.top,0);assert.equal(r.left,0);
  assert.deepEqual(r,model.adventureRewardArtLayout({width:600,height:600,bounds:[0,0,600,600]},120));
  const wide=model.adventureRewardArtLayout({width:600,height:300,bounds:[200,100,400,200]},120);
  assert.equal(wide.width,120);assert.equal(wide.height,60);assert.equal(wide.top,30);
});
// Shared treasure/gift motion coverage: test-adventure-reward-motion.cjs.
function progressHarness({width=390,height=844}={}) {
  const h=hooks(),calls=[],events={},status={};let focused=true;
  const player={play:()=>calls.push('play'),pause:()=>calls.push('pause'),addListener:(name,fn)=>{status[name]=fn;return {remove(){}};}};
  const {AdventureProgressScreen}=load('apps/mobile/src/components/burrow/adventure-progress-screen.tsx',{
    ...presentationImports(h),react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{AppState:{currentState:'active',addEventListener:(name,fn)=>{events[name]=fn;return {remove(){}};}},
      View:'View',Text:'Text',Pressable:'Button',StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width,height})},
    '@react-navigation/native':{useIsFocused:()=>focused},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
    'expo-video':{VideoView:'Video',useVideoPlayer:(source,setup)=>{setup(player);return player;}},'./burrow-image':{Image:'Image'},'./burrow-back-button':{BurrowBackButton:'Back'},
    '@/lib/adventure-progress-assets':{ADVENTURE_PROGRESS_ART:{video:'local-mp4',poster:'first-frame',start:'start',current:'current',end:'end'}},
    '@/lib/adventure-screen-layout':model,'@/lib/adventure-trail':load('apps/mobile/src/lib/adventure-trail.ts'),
    './adventure-digging-route':{AdventureDiggingRoute:'DiggingRoute'},'expo-linear-gradient':{LinearGradient:'Gradient'},
    '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>undefined,retryAdventureJournalJob(){}},
    '@/lib/burrow-store':{burrowClock:()=>0},
  });
  return {h,screen:props=>nodes(h.render(()=>AdventureProgressScreen(props)))};
}
test('progress uses the curved digging route and fixed Home button; no fabricated rewards or old video',()=>{
  const x=progressHarness(),home=[];
  const tree=x.screen({data:{profile:{id:'me'},hasPlus:true,specialQuests:[{questId:'adventures_completed',progress:4}],activeAdventure:{id:'a',started_at:'2026-10-12T00:00:00Z',ends_at:'2026-10-12T04:00:00Z'}},now:Date.parse('2026-10-12T02:00:00Z'),onHome:()=>home.push(true)});
  assert.ok(tree.some(n=>Array.isArray(n.props.children)&&n.props.children.join('')==='Your 5th adventure'));
  const route=tree.find(n=>n.type==='DiggingRoute');assert.equal(route.props.progress,.5);assert.equal(route.props.remaining,7200000);
  assert.ok(tree.some(n=>n.props.children==='02:00:00'));
  assert.equal(tree.some(n=>n.type==='Video'),false);
  assert.equal(tree[0].props.style.backgroundColor,'#360e02');
  tree.find(n=>n.type==='Back').props.onPress();assert.equal(home.length,1);x.h.unmount();
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');assert.match(source,/completion.current\)return <AdventureStageTransition[^]*?<AdventureCompletionScreen/);
  assert.match(source,/adventure\?\.status==='in_progress'\)return <AdventureStageTransition[^]*?<AdventureProgressScreen/);
  assert.ok(!source.includes('ONBOARDING_FEATURES'));
});
test('ongoing keeps a dark background and uniformly scaled vector route on compact and tall phones, with no video or deleted image dependency',()=>{
  for(const [width,height] of [[320,568],[390,844],[430,932]]){
    const x=progressHarness({width,height});
    const tree=x.screen({data:{profile:{id:'me'},hasPlus:false,specialQuests:[],activeAdventure:{id:'a',started_at:'2026-10-12T00:00:00Z',ends_at:'2026-10-12T04:00:00Z'}},now:Date.parse('2026-10-12T02:00:00Z'),onHome(){}});
    assert.equal(tree[0].props.style.backgroundColor,'#360e02');
    assert.equal(tree.some(n=>n.type==='Video'),false);
    assert.ok(tree.find(n=>n.type==='DiggingRoute').props.scale>0);
    x.h.unmount();
  }
  assert.doesNotMatch(fs.readFileSync('apps/mobile/src/lib/adventure-progress-assets.ts','utf8'),/adventure-ongoing-bg|background:/);
});
