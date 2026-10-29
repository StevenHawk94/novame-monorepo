const {presentationImports}=require('./motion-test-utils.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, flush, deferred } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const flat=style=>Object.assign({},...(Array.isArray(style)?style:[style]));
function entryFixture({width=390,season='autumn',period='day',top=44}={}){
 return load('apps/mobile/src/components/burrow/adventure-entry.tsx',{
  react:{useEffect(){}},'./adventure-reveal':{AdventureReveal:'Reveal'},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Pressable:'Button',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}}},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top,bottom:34})},
  '@/lib/app-viewport':{useAppViewport:()=>({width,height:844})},
  '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season,period,banner:season+'-'+period})},
  '@/lib/prepared-burrow-images':{prepareBurrowImages:async()=>{}},
  '@/lib/adventure-entry-layout':load('apps/mobile/src/lib/adventure-entry-layout.ts'),
  '@/lib/burrow-ui-assets':{BURROW_ADVENTURE_ENTRY_ART:{compass:'compass-art',write:'write-art',tap:'tap-art'},
   BURROW_ADVENTURE_BANNERS:Object.fromEntries(['spring','summer','autumn','winter'].flatMap(s=>['day','night'].map(p=>[s+'-'+p,s+'-'+p+'-art'])))},
  './burrow-image':{Image:'Image'},
 }).AdventureEntry;
}
const draft = { draftId: 'durable-draft', reflectId: 'record', matchedItems: [{ itemId: 'laundry', label: 'Doing Laundry' }] };
// Save/Start sequencing, retry, restart and account isolation now run in the
// durable worker; behavioral coverage lives in test-adventure-instant-flow.cjs.
test('waiting UI has no Logs and retains completed-open; Write Freely does not import keyword matching', () => {
  const src = fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx', 'utf8');
  assert.doesNotMatch(src, /Adventure Logs|trail!\.logs|logCard/);
  assert.match(src, /completion.current\)return <AdventureStageTransition[^]*?<AdventureCompletionScreen/);
  assert.match(src, /adventure\?\.status==='in_progress'\)return <AdventureStageTransition[^]*?<AdventureProgressScreen/);
  const text = fs.readFileSync('apps/mobile/src/components/burrow/adventure-journal-screen.tsx', 'utf8');
  assert.doesNotMatch(text, /matchItems|itemRuleContext|MatchedItemsReviewSheet/);
  assert.match(text, /maxLength=\{5000\}/); assert.match(text, /keepBurrowTextDraft/);
  const proposal = require('../docs/tap-your-day-icon-proposal.json');
  assert.equal(proposal.appliedToApp, true); assert.equal(proposal.physicalDeletionApproved, false);
});

test('Adventure uses the new natural-ratio banner, local icons and exact copy without a duplicate heading', () => {
  const routes=[];
  const AdventureEntry=entryFixture();
  const tree=AdventureEntry({onWrite:()=>routes.push('write'),onTap:()=>routes.push('tap')});
  const [hero,content]=tree.props.children;
  const image=nodes(hero).find(n=>n.type==='Image');
  assert.equal(image.props.source,'autumn-day-art');
  assert.equal(image.props.contentPosition,'center');assert.equal(flat(hero.props.style).width,'100%');
  assert.equal(flat(image.props.style).height,'100%');
  assert.equal(image.props.contentFit,'contain');
  assert.equal(flat(hero.props.style).aspectRatio,1528/1029);assert.equal(flat(hero.props.style).position,undefined);
  assert.equal(tree.props.style.backgroundColor,'#5c2c19');
  assert.equal(nodes(hero).find(n=>n.type==='Text').props.children,'Start Today’s Adventure');
  assert.deepEqual(nodes(content).filter(n=>n.type==='Text').map(n=>n.props.children),[
    'Log a moment to begin','Write Freely','Anything worth remembering today',
    'Tap your day','Select items that tell your day.',
  ]);
  assert.deepEqual(nodes(content).filter(n=>n.type==='Image').map(n=>n.props.source),['compass-art','write-art','tap-art']);
  nodes(content).filter(n=>n.type==='Image').forEach(n=>assert.equal(n.props.contentFit,'contain'));
  const buttons=nodes(content).filter(n=>n.type==='Button');assert.equal(buttons.length,2);
  buttons.forEach(n=>{assert.equal(n.props.style({pressed:false})[0].position,undefined);n.props.onPress();});
  assert.deepEqual(routes,['write','tap']);
  const parent=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(parent,/!adventureEntry&&.*?<Image source=\{background\}/);
  assert.match(parent,/adventureEntry\?adventureStyles\.entryScroll/);
  assert.match(parent,/entryScroll:\{paddingHorizontal:0,flexGrow:1\}/);
  assert.match(parent,/paddingBottom:adventureEntry\?insets.bottom/,'no asymmetric extra footer padding on the entry');
  assert.match(parent,/burrowFlatSurface\(section,adventureEntry\|\|adventureLogged\)/);
  assert.equal(load('apps/mobile/src/lib/burrow-surface.ts').burrowFlatSurface('adventure',true),'#5c2c19');
  assert.match(parent,/!adventureEntry&&.*?<View style=\{\[s.header/,'entry has no overlaid title or wallet');
  assert.match(parent,/\(section==='burrow'\|\|\(adventureEntry&&!isTab\)\)&&<BurrowBackButton/,'safe-area back navigation retained; Burrow cards also expose back');
  assert.match(parent,/onWrite=\{\(\)=>\{prefetchAdventureRewards\(data.adventureCollection\?\.enabled\);router.push\('\/\(main\)\/reflect-typing'/);
  assert.match(parent,/onTap=\{\(\)=>\{prefetchAdventureRewards\(data.adventureCollection\?\.enabled\);router.push\('\/\(main\)\/reflect-guided'/);
});

test('Adventure content follows the banner without consuming tall-screen space; short screens retain scrolling',()=>{
  const AdventureEntry=entryFixture({width:600});
  const tree=AdventureEntry({onWrite(){},onTap(){}});
  const [hero,content]=tree.props.children;
  assert.equal(tree.props.style.flexGrow,1);
  assert.equal(tree.props.style.flexShrink,0,'root must expand beyond the viewport when content does not fit');
  assert.equal(flat(hero.props.style).flexShrink,0,'banner must retain its source ratio on short screens');
  assert.equal(flat(content.props.style).flexGrow,undefined);
  assert.equal(flat(content.props.style).flexShrink,0,'choices and text must not collapse on short screens');
  assert.equal(flat(content.props.style).justifyContent,'flex-start');
  assert.equal(flat(content.props.style).paddingTop,28,'reference banner-to-content spacing is independent of viewport height');
  assert.equal(flat(content.props.style).height,undefined,'remaining height is not hard-coded per device');
  assert.equal(flat(content.props.style).marginTop,undefined);
  assert.equal(flat(content.props.children[0].props.style).flexDirection,'column','compass is above the copy, not inline');
});
test('all eight Adventure banners follow the shared environment and use period-specific heading colors',()=>{
 for(const season of ['spring','summer','autumn','winter'])for(const period of ['day','night']){
  const tree=entryFixture({season,period})({onWrite(){},onTap(){}}),hero=tree.props.children[0];
  assert.equal(nodes(hero).find(n=>n.type==='Image').props.source,season+'-'+period+'-art');
  assert.equal(flat(nodes(hero).find(n=>n.type==='Text').props.style).color,period==='night'?'#FFFFFF':'#4c341b');
 }
 const entry=fs.readFileSync('apps/mobile/src/components/burrow/adventure-entry.tsx','utf8');
 assert.match(entry,/useBurrowEnvironment\(timeZone, now\)/);
 assert.doesNotMatch(entry,/setInterval|setTimeout|DateTimeFormat|new Date\(/);
 const layout=load('apps/mobile/src/lib/adventure-entry-layout.ts').adventureEntryLayout;
 assert.equal(layout(390,59).bannerGap,layout(390,0).bannerGap);
 assert.ok(layout(320,59).titleTop>=69,'header stays below the safe area');
});
test('Tap Your Day and native input transitions use the same soil, without a background image',()=>{
 const tap=fs.readFileSync('apps/mobile/app/(main)/reflect-guided.tsx','utf8');
 assert.match(tap,/backgroundColor: ADVENTURE_LOG_BACKGROUND/);
 assert.doesNotMatch(tap,/ExpoImage|BURROW_BACKGROUNDS|#925735/);
 const options=load('apps/mobile/src/lib/main-navigation-options.ts',{
  './page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
  './burrow-surface':load('apps/mobile/src/lib/burrow-surface.ts'),
 });
 assert.equal(options.MAIN_ADVENTURE_INPUT_OPTIONS.contentStyle.backgroundColor,'#5c2c19');
});

function journalHarness(platform,paired=false,initial={}){
  const h=hooks(),calls=[],writes=[],request=deferred();let epoch=1;
  const {AdventureJournalScreen}=load('apps/mobile/src/components/burrow/adventure-journal-screen.tsx',{
    ...presentationImports(h),
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{ActivityIndicator:'Spinner',Keyboard:{dismiss(){}},KeyboardAvoidingView:'KeyboardView',Platform:{OS:platform},
      Pressable:'Button',ScrollView:'Scroll',Text:'Text',TextInput:'Input',View:'View',StyleSheet:{create:x=>x,absoluteFill:{}}},
    'expo-image':{Image:'Image'},'expo-router':{useRouter:()=>({back(){}}),useLocalSearchParams:()=>({})},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
    'expo-crypto':{randomUUID:()=> 'receipt'},
    '@/lib/adventure-journal-jobs':{queueAdventureJournal:args=>{calls.push(args);return 'job';}},
    '@/lib/burrow-store':{useBurrowSnapshot:()=>({data:{partner:paired?{id:'partner'}:null}})},
    '@/lib/adventure-prefetch':{prefetchAdventureRewards(){}},
    '@/lib/burrow-text-drafts':{readBurrowTextDraft:()=>({body:JSON.stringify(initial)}),
      keepBurrowTextDraft:(...args)=>{writes.push(args);return {key:'durable-key'};},removeBurrowTextDraft(){}},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=> 'me'},
    '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{common:'basic-bg',adventureFinish:'old-art'}},
    '@/lib/use-reflect-exit-guard':{useReflectExitGuard(){}},
    '@/lib/reflect-settlement-outbox':{releaseReflectSettlement(){}},
    './adventure-record-completion':{AdventureRecordCompletion:'Ready'},'./burrow-back-button':{BurrowBackButton:'Back'},
  });
  return {render:()=>h.render(AdventureJournalScreen),calls,writes,request,unmount:h.unmount,changeAccount:()=>epoch++};
}
for(const platform of ['ios','android'])test(`${platform}: Write Freely uses solid soil and gold Save, auto-focuses and preserves draft privacy`,async()=>{
  const h=journalHarness(platform,true,{body:'Kept words',shared:false});
  let tree=h.render();
  assert.equal(nodes(tree).filter(n=>n.type==='Image').length,0,'no old background artwork covers the solid requested color');
  assert.ok(nodes(tree).some(n=>n.type==='View'&&n.props.style?.backgroundColor==='#5c2c19'));
  assert.equal(nodes(tree).find(n=>n.type==='KeyboardView').props.behavior,platform==='ios'?'padding':'height');
  let input=nodes(tree).find(n=>n.type==='Input');assert.equal(input.props.autoFocus,true);assert.equal(input.props.value,'Kept words');
  assert.equal(input.props.maxLength,5000);assert.equal(input.props.multiline,true);
  assert.equal(nodes(tree).some(n=>/Your private day|Share this day|Nothing is shared/.test(n.props?.children)),false);
  input.props.onChangeText('My updated day');tree=h.render();
  assert.equal(JSON.parse(h.writes.at(-1)[2]).body,'My updated day');
  const save=nodes(tree).find(n=>n.type==='Button');assert.equal(save.props.style[0].backgroundColor,'#FFC13D');save.props.onPress();save.props.onPress();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body,'My updated day');
  assert.equal(h.calls[0].shareToPartner,false,'removing display copy must not override a private draft');
  assert.equal(nodes(h.render()).find(n=>n.type==='Ready').props.jobId,'job');h.unmount();
});
test('Tap Your Day uses the same fixed soil on selection and note phases without a backdrop',()=>{
  const source=fs.readFileSync('apps/mobile/app/(main)/reflect-guided.tsx','utf8');
  assert.match(source,/backgroundColor: ADVENTURE_LOG_BACKGROUND/);
  assert.doesNotMatch(source,/ExpoImage|BURROW_BACKGROUNDS|styles.scrim/);
  assert.match(source,/phase === 'steps'/);assert.match(source,/phase === 'note'/);
});

test('Tap Your Day note page has no sharing row and preserves existing draft privacy',()=>{
  const source=fs.readFileSync('apps/mobile/app/(main)/reflect-guided.tsx','utf8');
  assert.doesNotMatch(source,/RecordSharing|record-sharing|setShareToPartner|Share this day|Your private day|<Switch/);
  assert.match(source,/<Text style=\{styles.count\}>\{note.length\} \/ \{MAX_CHARS\}<\/Text>\s*<Text style=\{styles.matchLabel\}>Items You Selected<\/Text>/,
    'selected items follow the character count without a sharing row or spacer');
  assert.match(source,/const shareToPartner = restored.shared;/);
  assert.match(source,/shared: value.shared !== false/);
  assert.match(source,/shareToPartner: !!burrow\?\.partner && shareToPartner/,
    'removing the control must not turn an existing private draft into a shared journal');
  assert.match(source,/>Save<\/Text>/);
  assert.equal(fs.existsSync('apps/mobile/src/components/burrow/record-sharing.tsx'),false,
    'unused sharing control is removed');
});
