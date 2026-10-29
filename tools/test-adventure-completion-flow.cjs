const {presentationImports}=require('./motion-test-utils.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, flush, deferred } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
function harness({ v2 = false, pending = false, hasFriend = true, resumed = false, fail = false, delivery: initialDelivery } = {}) {
  const h = hooks(), calls = [], routes = [], receipts = [], request = deferred();
  let focused = true,delivery=initialDelivery;
  const promotions = [], transitions = [];
  const data = { profile: { id: 'me' }, catalog: [], activeAdventure: { id: 'journey', status: resumed ? 'interaction_required' : 'result_ready' },
    adventureResult: { claim_status: resumed ? 'interaction_required' : 'pending', friend_id: hasFriend ? 'friend' : null,
      metadata: { encounterV2: v2, treasureReserved: v2, friendSnapshot: { name: 'Mr Mole' },
        itemSnapshot: { title: 'Forest Letter' }, treasureSnapshot: v2 ? { stable_id: 'chair', title: 'Chair', asset: {} } : null } } };
  const { AdventureCompletionScreen } = load('apps/mobile/src/components/burrow/adventure-completion-screen.tsx', {
    ...presentationImports(h),
    '@/lib/adventure-friend-presentation':load('apps/mobile/src/lib/adventure-friend-presentation.ts'),
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:route=>routes.push(route)},
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform:{OS:'ios'}, Pressable: 'Button', ScrollView: 'Scroll', View: 'View', Text: 'Text', StyleSheet: { create: x => x } },
    'expo-router': { router: { dismissTo: route => routes.push(route), navigate: route => routes.push(route), back() {} } },
    '@react-navigation/native': { useIsFocused: () => focused, useRoute:()=>({key:'adventure-route'}) }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    '@/lib/adventure-paywall':{recordAdventurePaywallCompletion:input=>promotions.push(input)},
    '@/lib/rating-navigation':{markNavigationTransitionPending:key=>transitions.push(key)},
    '@/lib/use-adventure-completion-guard':{useAdventureCompletionGuard:(_data,done)=>focused&&!done},
    './burrow-image': { Image: 'Image' }, './burrow-back-button': { BurrowBackButton: 'Back' },
    './adventure-treasure': { AdventureTreasure: 'Treasure' }, './adventure-encounter-card': { AdventureEncounterCard: 'Encounter' },
    './adventure-friend-card': { AdventureFriendCard: 'LegacyFriend' },
    './adventure-encounter-layout': { AdventureEncounterLayout: 'Stage' },
    '@/lib/burrow-art-assets': { BURROW_BACKGROUNDS: { adventureFinish: 'finish-bg', adventureFriends: 'friends-bg' } },
    '@/lib/burrow-ui-assets': { burrowFriendArt: () => 'friend' },
    '@/lib/adventure-delivery': { readAdventureDelivery: () => delivery, resumeAdventureDelivery: async () => {},
      queueAdventureDelivery: (id, intent) => calls.push(['queue', id, intent]) },
    '@/lib/app-major-update-api': {
      claimAdventureTreasure: async () => { calls.push('treasure'); return pending ? request.promise : { interactionRequired: true, treasureClaimed: true }; },
      claimAdventureResult: async () => { calls.push('legacy'); return pending ? request.promise : { interactionRequired: hasFriend }; },
    },
    '@/lib/burrow-store': { runBurrowAction: async (_key, fn) => { if (fail) return false; await fn(); return true; },
      confirmBurrowAdventureItemLocally() {},
      confirmBurrowAdventureClaimLocally: id => receipts.push(['done', id]),
      confirmBurrowAdventureInteractionLocally: (id, treasure) => receipts.push(['continue', id, treasure]) },
  });
  const render = () => nodes(h.render(() => AdventureCompletionScreen({ data })));
  return { h, data, render, calls, receipts, routes, request,promotions,transitions,setDelivery:value=>{delivery=value;}, setFocused: value => { focused = value; render(); } };
}
test('treasure and friends keep their opaque background but normal completion has no back button',async()=>{
  for(const v2 of [false,true]){
    const x=harness({v2});
    if(v2)x.data.adventureResult.metadata.giftSnapshot={stable_id:'gift'};
    function page(source){
      const tree=x.render(),transition=tree.find(n=>n.type==='Transition');
      const children=nodes(transition.props.children);
      assert.equal(tree.filter(n=>n.type==='Image').length,1,'no background shared outside the page');
      assert.equal(children.find(n=>n.type==='Image').props.source,source);
      assert.equal(children.some(n=>n.type==='Back'),false);
      assert.ok(children.some(n=>n.type==='View'&&JSON.stringify(n.props.style).includes('backgroundColor')));
    }
    page('finish-bg');await x.render().find(n=>n.type==='Treasure').props.onClaim();page('friends-bg');x.h.unmount();
  }
});
test('retryable and terminal errors never add an exit control to the reward flow',async()=>{
 const x=harness({fail:true});await x.render().find(n=>n.type==='Treasure').props.onClaim();
 assert.equal(x.render().some(n=>n.type==='Back'),false);assert.equal(x.routes.length,0);
 x.setDelivery({failed:true,terminal:true});assert.equal(x.render().some(n=>n.type==='Back'),false);x.h.unmount();
});
test('an in-session finish receipt cannot tear down a gift popup before its dismissal callback',()=>{
  const x=harness({v2:true,resumed:true});x.render();x.setDelivery({finish:true});x.render();
  assert.equal(x.routes.length,0);x.render().find(n=>n.type==='Encounter').props.onComplete();
  x.render();
  assert.equal(x.routes.length,1);x.h.unmount();
});
test('legacy interactionRequired is a success receipt and immediately opens the friend invitation without a bootstrap', async () => {
  const h = harness();
  await h.render().find(n => n.type === 'Treasure').props.onClaim();
  assert.deepEqual(h.calls, ['legacy']); assert.deepEqual(h.receipts, [['continue', 'journey', false]]);
  assert.equal(h.routes.length, 0); assert.ok(!h.render().some(n => n.type === 'Treasure'));
  assert.ok(h.render().some(n => n.type === 'Text' && n.props.children === 'Let’s be friends'));
  h.h.unmount();
});
test('new furniture claim is separate from the friend gift and uses the frozen furniture art', async () => {
  const h = harness({ v2: true }); const treasure = h.render().find(n => n.type === 'Treasure');
  assert.equal(treasure.props.item.stable_id, 'chair'); assert.equal(treasure.props.title, 'Chair');
  h.data.adventureResult.metadata.giftSnapshot={stable_id:'gift'};
  const tap=treasure.props.onClaim(); assert.equal(h.render().some(n=>n.type==='Encounter'),true,'no network wait before invitation');
  await tap; assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['queue','journey',{treasure:true}]]);
  assert.deepEqual(h.receipts, []); assert.equal(h.routes.length, 0);
  h.render().find(n => n.type === 'Encounter').props.onComplete();h.render();assert.deepEqual(h.routes, ['/(main)/(tabs)']); h.h.unmount();
});
test('presentation is frozen before a legacy chest claim creates this friend’s discovery', async () => {
  const h=harness();h.render();
  h.data.discoveries=[{user_id:'me',friend_id:'friend',source_adventure_id:'journey'}];
  await h.render().find(n=>n.type==='Treasure').props.onClaim();
  assert.equal(h.render().find(n=>n.type==='Stage').props.heading,'You met a new friend!');
  assert.ok(h.render().some(n=>n.props.children==='Let’s be friends'));h.h.unmount();
});
test('legacy returning friends also skip the invitation and show their frozen prompt directly', async () => {
  const h=harness();h.data.discoveries=[{user_id:'me',friend_id:'friend',source_adventure_id:'earlier'}];
  await h.render().find(n=>n.type==='Treasure').props.onClaim();
  assert.ok(h.render().some(n=>n.type==='LegacyFriend'));
  assert.ok(!h.render().some(n=>n.props.children==='Let’s be friends'));
  assert.notEqual(h.render().find(n=>n.type==='Stage').props.heading,'You met a new friend!');h.h.unmount();
});
test('resuming the intermediate receipt skips an already-claimed chest; final navigation goes to Home', () => {
  const h = harness({ v2: true, resumed: true });
  assert.ok(h.render().some(n => n.type === 'Encounter')); assert.equal(h.calls.length, 0);
  h.render().find(n => n.type === 'Encounter').props.onComplete();h.render();assert.deepEqual(h.routes, ['/(main)/(tabs)']); h.h.unmount();
});
test('claim failure stays on the reward and makes no confirmed cache change', async () => {
  const h = harness({ v2: false, fail: true });
  await h.render().find(n => n.type === 'Treasure').props.onClaim();
  assert.ok(h.render().some(n => n.type === 'Treasure')); assert.equal(h.receipts.length, 0); assert.equal(h.routes.length, 0);
  assert.ok(h.render().some(n => n.props?.accessibilityRole === 'alert')); h.h.unmount();
});
test('a no-friend legacy claim exits immediately, but a late response cannot pull a user back into Home', async () => {
  const h = harness({ hasFriend: false }); await h.render().find(n => n.type === 'Treasure').props.onClaim();
  h.render();
  assert.deepEqual(h.receipts, [['done', 'journey']]); assert.equal(h.routes.length, 1); h.h.unmount();
  const late = harness({ pending: true, hasFriend: false });
  const task = late.render().find(n => n.type === 'Treasure').props.onClaim(); late.setFocused(false);
  late.request.resolve({ interactionRequired: false }); await task; await flush(); assert.equal(late.routes.length, 0); late.h.unmount();
});

test('Adventure promotion is counted only on the final gift exit, once, using its entry-frozen lifetime ordinal',async()=>{
 const x=harness({v2:true});
 x.data.hasPlus=false;x.data.specialQuests=[{questId:'adventures_completed',progress:4}];
 x.data.adventureResult.metadata.giftSnapshot={stable_id:'gift'};
 await x.render().find(n=>n.type==='Treasure').props.onClaim();
 assert.equal(x.promotions.length,0,'intermediate chest claim is not a completed adventure');
 x.data.specialQuests=[{questId:'adventures_completed',progress:5}];
 const complete=x.render().find(n=>n.type==='Encounter').props.onComplete;
 complete();complete();
 x.render();
 assert.equal(x.promotions.length,1);assert.equal(x.promotions[0].ordinal,5);
 assert.equal(x.promotions[0].adventureId,'journey');assert.equal(x.promotions[0].userId,'me');
 assert.equal(x.routes.length,1);assert.deepEqual(x.transitions,['adventure-route']);x.h.unmount();
});
test('Back, a failed claim, offscreen callbacks and recovery auto-exit cannot create an Adventure promotion',async()=>{
 const back=harness({v2:true});assert.equal(back.render().some(n=>n.type==='Back'),false);assert.equal(back.promotions.length,0);back.h.unmount();
 const failed=harness({fail:true});await failed.render().find(n=>n.type==='Treasure').props.onClaim();assert.equal(failed.promotions.length,0);failed.h.unmount();
 const off=harness({v2:true,resumed:true});const done=off.render().find(n=>n.type==='Encounter').props.onComplete;
 off.setFocused(false);done();assert.equal(off.promotions.length,0);assert.equal(off.routes.length,0);off.h.unmount();
 const restore=harness({v2:true,delivery:{finish:true}});restore.render();assert.equal(restore.routes.length,1);assert.equal(restore.promotions.length,0);restore.h.unmount();
});
