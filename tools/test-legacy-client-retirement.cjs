const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const read=file=>fs.readFileSync(file,'utf8');

test('only Menu.png is retained in the legacy Icons folder; current Plus remains WebP',()=>{
  assert.deepEqual(fs.readdirSync('apps/mobile/assets/Icons').filter(name=>!name.startsWith('.')).sort(),['Menu.png']);
  assert.equal(fs.existsSync('apps/mobile/assets/burrow-webp/affection page icons/plus.webp'),true);
  assert.equal(fs.existsSync('apps/mobile/src/lib/icons.ts'),false);
  const home=read('apps/mobile/src/components/burrow/home-art-scene.tsx');
  assert.ok(home.includes('styles.menuBar'),'current menu stays code-drawn, not replaced with old art');
});
test('privacy consent uses current icon.png and retains its allow/deny and measurement controls',()=>{
  const source=read('apps/mobile/src/components/privacy/meta-privacy-provider.tsx');
  assert.ok(source.includes("require('../../../assets/icon.png')"));
  for(const code of ['ensureConsentBeforeHome','initializeAdMeasurement()','disableAdMeasurement()','kAdsPrivacyChoice','onAllow','onDeny'])
    assert.ok(source.includes(code),code);
  assert.doesNotMatch(source,/obBunnyHead|lib\/icons/);
});
test('retired client modules are removed without touching current Release or durable Adventure recovery',()=>{
  for(const file of ['components/main/reflect-settlement.tsx','components/main/good-vibes.tsx','components/main/clover-burst.tsx',
    'components/main/item-sheet.tsx','components/main/cave-shell.tsx','lib/lens-api.ts','lib/true-north-api.ts',
    'lib/quiet-wins-api.ts','lib/master-api.ts','lib/guess-api.ts','lib/tame-enemy-api.ts'])
    assert.equal(fs.existsSync('apps/mobile/src/'+file),false,file);
  for(const file of ['lib/reflect-settlement-outbox.ts','lib/adventure-journal-jobs.ts','lib/release-room-api.ts',
    'components/burrow/release-room-screen.tsx','components/tame-enemy/swipe-attack-layer.tsx'])
    assert.equal(fs.existsSync('apps/mobile/src/'+file),true,file);
});
test('old pages forward to current tabs without legacy network requests or mutations',()=>{
  for(const [route,target]of [['true-north','burrow'],['new-lens','burrow'],['quiet-wins','burrow'],
    ['friend-add','burrow'],['friends-list','burrow'],['friend-profile','burrow'],['their-patterns','burrow'],
    ['friend-detail','burrow'],['my-logs','friends'],['reflect-detail','friends'],['friend-reflect-detail','friends'],['item-sheet','collection']]){
    const file='apps/mobile/app/(main)/'+route+'.tsx';
    const screen=load(file,{'react/jsx-runtime':{jsx,jsxs:jsx},'@/components/main/native-tab-redirect':{NativeTabRedirect:'Redirect'}});
    assert.equal(screen.default().props.href,'/(main)/(tabs)/'+target);
    assert.doesNotMatch(read(file),/fetch|purchase|submit|require\(/);
  }
});
test('Tap Your Day retains draft checkpoint and the same durable save before entering result',()=>{
  const source=read('apps/mobile/app/(main)/reflect-guided.tsx');
  for(const code of ['readBurrowTextDraft','keepBurrowTextDraft','queueAdventureJournal','idempotencyKey: local.key',
    'shareToPartner: !!burrow?.partner && shareToPartner','submitLock.current','sessionEpoch()','MAX_TAP_YOUR_DAY_SELECTIONS'])
    assert.ok(source.includes(code),code);
  assert.ok(source.indexOf('queueAdventureJournal(')<source.indexOf('setJournalJobId(id)'));
  assert.doesNotMatch(source,/ReflectSettlementView|prepareReflect|useMajorUpdateEnabled/);
  const shared=read('apps/mobile/src/components/main/reflect-shared.tsx');
  assert.doesNotMatch(shared,/ReflectResultView|SelectableItemGrid|MemoryEditSheet|lib\/icons/);
});
