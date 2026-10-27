const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load: loadModule, hooks, deferred, flush, clock } = require('./lifecycle-test-utils.cjs');

const jsx = (type, props, key) => ({ type, props, key });
const QuestAction=props=>jsx('Action',{...props,children:jsx('Text',{children:props.arrow?'➜':'Claim'})});
const load=(file,imports={},globals)=>loadModule(file,{'./quest-action':{QuestAction},...imports},globals);
const nodes = tree => typeof tree==='function'?nodes(tree({pressed:false})):Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.type===QuestAction?QuestAction(tree.props):tree.props?.children)] : [];
const textContent = node => Array.isArray(node.props?.children) ? node.props.children.join('') : node.props?.children;

test('Quest banner is bundled, uncropped at 2:1, and joins a full-bleed solid #844624 page',()=>{
  const fs=require('node:fs'),h=hooks();
  const {QuestBoard,QuestBanner}=load('apps/mobile/src/components/burrow/quest-board.tsx',{
    './quest-progress':{QuestProgress:'QuestProgress'},
    '@/lib/coin-reward-store':{setNextCoinRewardOrigin(){}},
    './quest-claim-confetti':{QuestClaimConfetti:'QuestClaimConfetti'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:v=>v}},
    './burrow-image':{Image:'Image'},'@/lib/burrow-ui-assets':{BURROW_QUEST_BANNER:'bundled-banner',BURROW_QUEST_ICONS:{}},
  });
  const tree=h.render(()=>QuestBoard({data:{profile:{id:'me'},localDate:'2026-10-09',quests:{quests:[]},specialQuests:[],inventory:[],discoveries:[]},
    busy:false,onGo(){},onClaim:async()=>0,onSpecialClaim:async()=>0,onSpecialGo(){}}));
  assert.equal(tree.props.style.backgroundColor,'#844624');
  assert.equal(tree.props.children[0].type,QuestBanner,'the banner is first in the scrollable quest board');
  const banner=QuestBanner();
  assert.equal(banner.props.source,'bundled-banner');assert.equal(banner.props.contentFit,'contain');
  assert.deepEqual(JSON.parse(JSON.stringify(banner.props.style)),{width:'100%',aspectRatio:2,flexShrink:0});
  const registry=fs.readFileSync('apps/mobile/src/lib/burrow-ui-assets.ts','utf8');
  assert.match(registry,/BURROW_QUEST_BANNER = require\('\.\.\/\.\.\/assets\/burrow-webp\/Quest-Page-Banner.webp'\)/);
  assert.ok(fs.existsSync('apps/mobile/assets/burrow-webp/Quest-Page-Banner.webp'));
  const screen=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.match(screen,/burrowFlatSurface\(section,adventureEntry\|\|adventureLogged\)/);
  assert.equal(load('apps/mobile/src/lib/burrow-surface.ts').burrowFlatSurface('quests',false),'#844624');
  assert.match(screen,/section!=='quests'&&.*?<Image source=\{background\}/);
  assert.match(screen,/section==='quests'\?s\.mapContent:s\.content/);
  h.unmount();
});

test('Quests scrolls the whole board including its banner without pull-to-refresh or native bounce',()=>{
  const fs=require('node:fs');
  const screen=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  assert.doesNotMatch(screen,/<QuestBanner\s*\//,'no fixed banner outside the scrollable board');
  assert.match(screen,/section==='quests'\)return <QuestBoard/);
  assert.match(screen,/<PageScrollView key=\{section\}[\s\S]*?>\{content\(\)\}<\/PageScrollView>/,'the entire quest board is inside the page scroller');
  assert.match(screen,/const PageScrollView=section==='burrow'\?BurrowMapScrollView:ScrollView/,'quests retains the ordinary native scroller');
  assert.doesNotMatch(screen,/stickyHeaderIndices|scrollEnabled=\{false\}/,'the banner must not stick or prevent scrolling');
  assert.match(screen,/\{\.\.\.burrowPageScrollBehavior\(section\)\}/);
  assert.match(screen,/refreshControl=\{section==='burrow'\|\|section==='carrot_shop'\|\|section==='quests'\?undefined:/);
  assert.deepEqual(JSON.parse(JSON.stringify(load('apps/mobile/src/lib/burrow-surface.ts').burrowPageScrollBehavior('quests'))),
    {bounces:false,alwaysBounceVertical:false,overScrollMode:'never'});
  const legacy=fs.readFileSync('apps/mobile/app/(main)/(tabs)/quests.tsx','utf8');
  assert.doesNotMatch(legacy,/RefreshControl|refreshControl=/);
  assert.match(legacy,/<BurrowScreen section="quests" asTab/,'the new quest board owns scrolling and background state');
});

test('Quest claim immediately restores gray/struck-through completed state without a check icon', async () => {
  const h = hooks(), request = deferred();
  const { QuestBoard } = load('apps/mobile/src/components/burrow/quest-board.tsx', {
    './quest-progress':{QuestProgress:'QuestProgress'},
    '@/lib/coin-reward-store':{setNextCoinRewardOrigin(){}},
    './quest-claim-confetti':{QuestClaimConfetti:'QuestClaimConfetti'},
    './burrow-image': { Image: 'Image' },
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: styles => styles } },
    '@/lib/burrow-ui-assets': { BURROW_QUEST_ICONS: {} },
    './care-quest-celebration': { QuestClaimBurst: 'QuestClaimBurst' },
  });
  const data = { profile: { id: 'me' }, localDate: '2026-10-02', quests: { quests: [{ assignmentId: 'assignment-1', questId: 'send_affection',
    target: 1, progress: 1, completedAt: 'today', claimedAt: null }] }, specialQuests: [], inventory: [], discoveries: [] };
  const render = () => h.render(() => QuestBoard({ data, busy: false, onGo() {}, onClaim: () => request.promise,
    onSpecialClaim: async () => 0, onSpecialGo() {} }));
  let tree = render();
  const card = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  assert.ok(nodes(card).some(node => node.props?.children === 'Claim'));
  assert.equal(card.props.style({ pressed: false })[1], false, 'completion alone must not recolor the card');
  assert.equal(nodes(card).find(node => node.props?.children === 'Send your person affection').props.style[1], false,
    'completion alone must not strike through the title');
  card.props.onPress();
  tree = render();
  const claimed = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  assert.equal(claimed.props.disabled, true);
  assert.equal(claimed.props.style({ pressed: false })[1].backgroundColor, '#C9B2A2');
  const title = nodes(claimed).find(node => node.props?.children === 'Send your person affection');
  assert.equal(title.props.style[1].textDecorationLine, 'line-through');
  assert.ok(!nodes(claimed).some(node => node.props?.children === '✓' || node.props?.children === 'Claim'));
  assert.ok(!nodes(tree).some(node => node.type === 'QuestClaimBurst'), 'the global banner owns currency feedback; no blocking per-card reward modal');
  assert.equal(nodes(claimed).filter(node=>node.type==='QuestClaimConfetti').length,1,'celebrates at the task before the request finishes');
  nodes(claimed).find(node=>node.type==='QuestClaimConfetti').props.onComplete();
  assert.ok(!nodes(render()).some(node=>node.type==='QuestClaimConfetti'),'small burst cleans up independently of network');
  request.resolve(10); await flush();
  assert.equal(render().type, 'View');
});

test('failed optimistic claim restores Claim without restoring an unchecked task; double taps dispatch once', async () => {
  const h = hooks(), request = deferred(), time = clock(); let calls = 0;
  const { QuestBoard } = load('apps/mobile/src/components/burrow/quest-board.tsx', {
    './quest-progress':{QuestProgress:'QuestProgress'},
    '@/lib/coin-reward-store':{setNextCoinRewardOrigin(){}},
    './quest-claim-confetti':{QuestClaimConfetti:'QuestClaimConfetti'},
    './burrow-image': { Image: 'Image' }, react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '@/lib/burrow-ui-assets': { BURROW_QUEST_ICONS: {} }, './care-quest-celebration': { QuestClaimBurst: 'QuestClaimBurst' },
  }, time.globals);
  const data = { profile: { id: 'me' }, localDate: '2026-10-05', quests: { quests: [{ assignmentId: 'one', questId: 'send_affection', target: 1, progress: 1, completedAt: 'today', claimedAt: null }] }, specialQuests: [], inventory: [], discoveries: [] };
  const render = () => h.render(() => QuestBoard({ data, busy: false, onGo() {}, onClaim: () => { calls++; return request.promise; }, onSpecialGo() {}, onSpecialClaim: async () => 0 }));
  let tree = render(), card = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  card.props.onPress(); card.props.onPress(); assert.equal(calls, 1);
  const oldBurst=nodes(render()).find(node=>node.type==='QuestClaimConfetti');
  request.reject(Error('offline')); await flush(); tree = render();
  card = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  assert.ok(nodes(card).some(node => node.props?.children === 'Claim'));
  assert.equal(nodes(card).find(node => node.props?.children === 'Send your person affection').props.style[1], false);
  assert.equal(card.props.style({ pressed: false })[1], false, 'a rejected claim restores the unclaimed visual state');
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(!nodes(tree).some(node=>node.type==='QuestClaimConfetti'),'failure removes the local flourish');
  card.props.onPress(); tree=render();
  const retryBurst=nodes(tree).find(node=>node.type==='QuestClaimConfetti');assert.ok(retryBurst);
  oldBurst.props.onComplete();
  assert.ok(nodes(render()).some(node=>node.type==='QuestClaimConfetti'),'an older animation cannot remove the retry');
  await flush();render();h.unmount();
});

test('special claim immediately raises the cumulative goal and lowers the bar without striking or graying the card', async () => {
  const h = hooks(), request = deferred();
  const { QuestBoard } = load('apps/mobile/src/components/burrow/quest-board.tsx', {
    './quest-progress':{QuestProgress:'QuestProgress'},
    '@/lib/coin-reward-store':{setNextCoinRewardOrigin(){}},
    './quest-claim-confetti':{QuestClaimConfetti:'QuestClaimConfetti'},
    './burrow-image': { Image: 'Image' }, react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '@/lib/burrow-ui-assets': { BURROW_QUEST_ICONS: {} },
  });
  const data = { profile: { id: 'me' }, localDate: '2026-10-07', quests: { quests: [] },
    specialQuests: [{ questId: 'items_collected', stage: 1, target: 10, progress: 10 }], inventory: [], discoveries: [] };
  const render = () => h.render(() => QuestBoard({ data, busy: false, onGo() {}, onClaim: async () => 0,
    onSpecialClaim: () => request.promise, onSpecialGo() {} }));
  const cardFor = tree => nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Collect Items,'));
  let card = cardFor(render());
  const progressKey=nodes(card).find(node=>node.type==='QuestProgress').key;
  assert.ok(nodes(card).some(node => node.props?.children === 'Claim'));
  assert.equal(card.props.style({ pressed: false })[0].backgroundColor, '#FFFDF8');
  assert.equal(nodes(card).find(node => node.props?.children === 'Collect Items').props.style.textDecorationLine, undefined);
  card.props.onPress(); card = cardFor(render());
  assert.equal(card.props.disabled, true);
  assert.equal(card.props.style({ pressed: false })[0].backgroundColor, '#FFFDF8');
  assert.equal(nodes(card).find(node => node.props?.children === 'Collect Items').props.style.textDecorationLine, undefined);
  assert.ok(nodes(card).some(node=>textContent(node)==='10/20'));
  assert.ok(nodes(card).some(node=>node.type==='QuestProgress'&&node.props.progress===10&&node.props.target===20));
  assert.equal(nodes(card).find(node=>node.type==='QuestProgress').key,progressKey,'milestone changes keep the existing native bar mounted');
  assert.match(card.props.accessibilityLabel,/10 of 20/);
  assert.ok(nodes(card).some(node => node.props?.children === 'Claim'));
  assert.equal(nodes(card).find(node=>node.type===QuestAction).props.ready,false,'the next stage keeps a gray Claim, not a navigation arrow');
  const originalBurst=nodes(card).find(node=>node.type==='QuestClaimConfetti');assert.ok(originalBurst);
  request.resolve(15); await flush();
  data.specialQuests = [{ questId: 'items_collected', stage: 2, target: 20, progress: 10 }];
  card = cardFor(render());
  assert.equal(card.props.disabled, true,'an incomplete next milestone cannot navigate or claim');
  assert.equal(card.props.style({ pressed: false })[1], false);
  assert.ok(nodes(card).some(node=>textContent(node)==='10/20'),'server confirmation must not advance twice');
  assert.equal(nodes(card).find(node=>node.type==='QuestProgress').key,progressKey,'receipt cannot remount the animation');
  const continuingBurst=nodes(card).find(node=>node.type==='QuestClaimConfetti');assert.ok(continuingBurst);
  assert.equal(continuingBurst.key,originalBurst.key,'fast server stage advancement must not cut off or replay the flourish');
  continuingBurst.props.onComplete();
  assert.ok(!nodes(cardFor(render())).some(node=>node.type==='QuestClaimConfetti'));
  h.unmount();
});

test('special milestone retries roll back progress, retain overflow, and never claim an unconfirmed next stage',async()=>{
  const h=hooks(),time=clock(),requests=[deferred(),deferred(),deferred()];let calls=0;
  const {QuestBoard}=load('apps/mobile/src/components/burrow/quest-board.tsx',{
    './quest-progress':{QuestProgress:'QuestProgress'},
    '@/lib/coin-reward-store':{setNextCoinRewardOrigin(){}},'./quest-claim-confetti':{QuestClaimConfetti:'QuestClaimConfetti'},
    './burrow-image':{Image:'Image'},react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
    '@/lib/burrow-ui-assets':{BURROW_QUEST_ICONS:{}},
  },time.globals);
  const data={profile:{id:'me'},localDate:'2026-10-14',quests:{quests:[]},
    specialQuests:[{questId:'friends_met',stage:2,target:4,progress:7}],inventory:[],discoveries:[]};
  const render=()=>h.render(()=>QuestBoard({data,busy:false,onGo(){},onClaim:async()=>0,
    onSpecialClaim:(id,stage)=>{assert.equal(id,'friends_met');assert.equal(stage,calls<2?2:3);return requests[calls++].promise;},onSpecialGo(){}}));
  const cardFor=()=>nodes(render()).find(n=>n.props?.accessibilityLabel?.startsWith('Meet New Friends,'));
  let card=cardFor();card.props.onPress();card.props.onPress();assert.equal(calls,1);
  card=cardFor();assert.equal(card.props.disabled,true);
  assert.ok(nodes(card).some(n=>textContent(n)==='6/6'),'overflow progress is preserved but capped for display');
  assert.equal(nodes(card).find(n=>n.type===QuestAction).props.ready,false,'next Claim stays gray until authoritative confirmation');
  requests[0].reject(Error('offline'));await flush();card=cardFor();
  assert.ok(nodes(card).some(n=>textContent(n)==='4/4'),'failed reward restores the original goal');
  assert.ok(nodes(card).some(n=>n.props?.children==='Claim'));
  assert.equal(nodes(card).find(n=>n.props?.children==='Meet New Friends').props.style.textDecorationLine,undefined);
  card.props.onPress();requests[1].resolve(15);await flush();
  data.specialQuests=[{questId:'friends_met',stage:3,target:6,progress:7}];card=cardFor();
  assert.equal(card.props.disabled,false);assert.ok(nodes(card).some(n=>n.props?.children==='Claim'));
  card.props.onPress();card=cardFor();assert.ok(nodes(card).some(n=>textContent(n)==='7/8'));
  assert.ok(nodes(card).some(n=>n.type==='QuestProgress'&&n.props.progress===7&&n.props.target===8));
  data.profile.id='other';data.specialQuests=[{questId:'friends_met',stage:2,target:4,progress:1}];render();card=cardFor();
  assert.ok(nodes(card).some(n=>textContent(n)==='1/4'),'another account cannot inherit the optimistic goal');
  requests[2].reject(Error('late'));await flush();
  assert.ok(nodes(cardFor()).some(n=>textContent(n)==='1/4'));h.unmount();
});

test('separate task bursts survive rapid claims and never replay on cached data or a different account',async()=>{
  const h=hooks(),requests=[deferred(),deferred()];let calls=0;
  const {QuestBoard}=load('apps/mobile/src/components/burrow/quest-board.tsx',{
    './quest-progress':{QuestProgress:'QuestProgress'},
    '@/lib/coin-reward-store':{setNextCoinRewardOrigin(){}},'./quest-claim-confetti':{QuestClaimConfetti:'QuestClaimConfetti'},
    './burrow-image':{Image:'Image'},react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
    '@/lib/burrow-ui-assets':{BURROW_QUEST_ICONS:{}},
  });
  const data={profile:{id:'me'},localDate:'2026-10-12',quests:{quests:['send_affection','play_game'].map(questId=>({
    questId,assignmentId:questId,target:1,progress:1,completedAt:'today',claimedAt:null}))},specialQuests:[],inventory:[],discoveries:[]};
  const render=()=>h.render(()=>QuestBoard({data,busy:false,onGo(){},onClaim:()=>requests[calls++].promise,onSpecialGo(){},onSpecialClaim:async()=>0}));
  let tree=render();const cards=nodes(tree).filter(n=>n.type==='Pressable'&&n.props.accessibilityLabel.includes('collect reward'));
  cards[0].props.onPress();cards[1].props.onPress();tree=render();assert.equal(calls,2);
  const bursts=nodes(tree).filter(n=>n.type==='QuestClaimConfetti');assert.equal(bursts.length,2);
  bursts[0].props.onComplete();assert.equal(nodes(render()).filter(n=>n.type==='QuestClaimConfetti').length,1);
  bursts[1].props.onComplete();requests.forEach(r=>r.resolve(10));await flush();
  assert.equal(nodes(render()).filter(n=>n.type==='QuestClaimConfetti').length,0,'server receipt does not replay a burst');
  data.profile.id='other';render();bursts.forEach(b=>b.props.onComplete());
  assert.equal(nodes(render()).filter(n=>n.type==='QuestClaimConfetti').length,0);h.unmount();
});

test('card confetti uses one native clock, no blocking layer, cancels on unmount and respects reduced motion',()=>{
  const {motionHarness}=require('./motion-test-utils.cjs');
  for(const reduced of [false,true]) {
    const h=hooks(),motion=motionHarness(h);let completed=0;
    const {QuestClaimConfetti}=load('apps/mobile/src/components/burrow/quest-claim-confetti.tsx',{
      react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{create:x=>x}},
      'react-native-reanimated':{...motion.reanimated,useReducedMotion:()=>reduced},
    });
    const tree=h.render(()=>QuestClaimConfetti({onComplete:()=>completed++}));
    if(reduced) {assert.equal(tree,null);assert.equal(completed,1);assert.equal(motion.timings.length,0);}
    else {
      assert.equal(tree.props.pointerEvents,'none');assert.equal(tree.props.children.length,12);
      assert.equal(tree.props.style.position,'absolute');assert.equal(motion.timings.length,1);
      motion.time.advance(849);assert.equal(completed,0);motion.time.advance(1);assert.equal(completed,1);
      h.unmount();motion.timings[0].complete(true);assert.equal(completed,1,'late native callbacks after detach are ignored');
    }
    h.unmount();assert.equal(motion.time.timers.size,0);
  }
});
