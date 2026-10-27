// The old MOV/WebP companion renderer has been retired, not restored.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const read=file=>fs.readFileSync(file,'utf8');
for(const [route,section] of [['index','home'],['bags','collection'],['friends','moments'],['quests','quests']]) {
  test(`current ${route} tab mounts only Burrow without rollout or old assets`,()=>{
    const file=`apps/mobile/app/(main)/(tabs)/${route}.tsx`;
    const screen=load(file,{'react/jsx-runtime':{jsx,jsxs:jsx},
      'expo-router':{useLocalSearchParams:()=>({care:'feed'})},
      '@/components/burrow/burrow-screen':{BurrowScreen:'Burrow'},
    });
    const tree=screen.default();assert.equal(tree.type,'Burrow');assert.equal(tree.props.section,section);
    if(route==='index')assert.equal(tree.props.homeIntent,'feed');
    assert.doesNotMatch(read(file),/Legacy|CompanionVideo|useMajorUpdateEnabled/);
  });
}
test('only the existing retained tab navigator is mounted',()=>{
  const source=read('apps/mobile/app/(main)/(tabs)/_layout.tsx');
  assert.match(source,/<RetainedTabs /);assert.doesNotMatch(source,/<Tabs|BurrowLaunchScreen|useMajorUpdateReady/);
});
test('retired companion video, card deck and guide modules stay absent',()=>{
  for(const file of ['components/main/companion-video.tsx','components/main/companion-video-source.ts',
    'components/main/companion-video-source.android.ts','components/main/companion-sheet.tsx',
    'components/main/memory-bubbles.tsx','components/main/feature-guide-modal.tsx','lib/tame-cards.ts'])
    assert.equal(fs.existsSync('apps/mobile/src/'+file),false,file);
  for(const file of ['default.mov','default.webp'])assert.equal(fs.existsSync('apps/mobile/assets/videos/'+file),false);
});
test('old entry aliases redirect without fetching or spending currency',()=>{
  for(const [route,href]of [['visit-master','/(main)/(tabs)'],['companion-sheet','/(main)/(tabs)'],
    ['quest-custom','/(main)/(tabs)/quests'],['quest-pick','/(main)/(tabs)/quests'],['quest-write-own','/(main)/(tabs)/quests'],
    ['(modals)/skin-select','/(main)/(tabs)/shop'],['(modals)/scene-select','/(main)/(tabs)/shop']]){
    const file='apps/mobile/app/(main)/'+route+'.tsx';
    const screen=load(file,{'react/jsx-runtime':{jsx,jsxs:jsx},'@/components/main/native-tab-redirect':{NativeTabRedirect:'Redirect'}});
    assert.equal(screen.default().props.href,href);assert.doesNotMatch(read(file),/fetch|purchase|submit|require\(/);
  }
});
test('preset journal deep links preserve their prompt; plain Reflect opens Adventure',()=>{
  let params={presetPrompt:'A new perspective',sourceKit:'new_lens'};
  const screen=load('apps/mobile/app/(main)/reflect.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},
    'expo-router':{Redirect:'Redirect',useLocalSearchParams:()=>params}});
  assert.equal(screen.default().props.href.pathname,'/(main)/reflect-typing');
  assert.equal(screen.default().props.href.params,params);
  params={};assert.equal(screen.default().props.href,'/(main)/burrow-detail?section=adventure');
});
