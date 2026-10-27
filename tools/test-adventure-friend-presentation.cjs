const {presentationImports}=require('./motion-test-utils.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const presentation=load('apps/mobile/src/lib/adventure-friend-presentation.ts');
const {adventureFriendPresentation}=presentation;
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'
  ?typeof tree.type==='function'?nodes(tree.type(tree.props)):tree.type==='Modal'&&!tree.props.visible?[]:[tree,...nodes(tree.props?.children)]:[];
function data() {return {
  profile:{id:'me'},friends:[],discoveries:[],adventureCollection:{progress:[]},
  activeAdventure:{id:'journey'},adventureResult:{friend_id:'mole',metadata:{
    encounterV2:true,friendSnapshot:{stable_id:'mole',name:'Mr Mole',metadata:{gender:'he'}},
    dialogue:{scene:'A fresh dirt mound.',lines:['Hm. My roof.'],choices:[{id:'a',label:'Sorry!',reaction:['Hm. Accepted.']}],outro:'See you.'},
    giftSnapshot:{title:'A gift'},
  }},
};}
const discovery=(owner='me',source='old-journey')=>({user_id:owner,friend_id:'mole',source_adventure_id:source});
test('only this user’s earlier encounter makes a returning friend; partner discoveries do not',()=>{
  const d=data();d.discoveries=[discovery('partner')];
  let result=adventureFriendPresentation(d,()=>{throw Error('new friends must not pick random copy');});
  assert.equal(result.isNewFriend,true);assert.equal(result.heading,'You met a new friend!');
  assert.equal(result.introduction,'You ran into Mr Mole down in the burrow.');assert.equal(result.talkLabel,'Talk to him');
  d.discoveries.push(discovery());assert.equal(adventureFriendPresentation(d,()=>0).isNewFriend,false);
});
test('a legacy discovery created by the current chest claim is still the first meeting',()=>{
  const d=data();d.discoveries=[discovery('me','journey')];
  assert.equal(adventureFriendPresentation(d).isNewFriend,true);
  d.adventureCollection.progress=[{friend_id:'mole',completed:1}];
  assert.equal(adventureFriendPresentation(d,()=>0).isNewFriend,false);
});
test('all eight returning headlines use the actual name and have correct spacing',()=>{
  const d=data();d.adventureCollection.progress=[{friend_id:'mole',completed:2}];
  const expected=['Mr Mole is hanging around.','Mr Mole just popped out of the dirt.','Mr Mole is snacking on some roots.',
    'You ran into Mr Mole.','You bumped into Mr Mole.','Mr Mole is nearby.','Mr Mole crossed your path.','Mr Mole is around the corner.'];
  expected.forEach((heading,i)=>assert.equal(adventureFriendPresentation(d,()=>i/8).heading,heading));
});
test('gender labels use the frozen snapshot, and old snapshots fall back to the cast profile',()=>{
  const d=data();d.adventureResult.metadata.friendSnapshot.gender='she';
  assert.equal(adventureFriendPresentation(d).talkLabel,'Talk to her');
  d.adventureResult.metadata.friendSnapshot=null;d.friends=[{stable_id:'mole',name:'Mr Mole'}];
  assert.equal(adventureFriendPresentation(d).friendName,'Mr Mole');
  assert.equal(adventureFriendPresentation(d).talkLabel,'Talk to him');
});
test('all 15 canonical cast profiles supply gender when historical snapshots omit or invalidate it',()=>{
  const fs=require('node:fs'),rows=require('../apps/mobile/src/lib/adventure-friend-identities.json');
  const canonical=fs.readdirSync('apps/api/src/data/adventure-friends').map(f=>JSON.parse(fs.readFileSync('apps/api/src/data/adventure-friends/'+f)));
  assert.equal(rows.length,15);assert.equal(canonical.length,15);
  for(const f of canonical){
    assert.deepEqual(rows.find(row=>row.id===f.id),{id:f.id,name:f.name,gender:f.gender});
    for(const value of [undefined,null,'', 'unknown']){
      const d=data();d.adventureResult.friend_id=f.id;d.adventureResult.metadata.friendSnapshot={stable_id:f.id,name:f.name,gender:value};
      d.friends=[{stable_id:f.id,name:f.name}];
      assert.equal(adventureFriendPresentation(d).talkLabel,f.gender==='he'?'Talk to him':'Talk to her');
      d.adventureResult.metadata.friendSnapshot=null;
      assert.equal(adventureFriendPresentation(d).talkLabel,f.gender==='he'?'Talk to him':'Talk to her');
    }
  }
  const d=data();d.adventureResult.metadata.friendSnapshot={stable_id:'custom',name:'Custom',gender:''};
  d.adventureResult.friend_id='custom';d.friends=[{stable_id:'custom',name:'Custom',metadata:{gender:'she'}}];
  assert.equal(adventureFriendPresentation(d).talkLabel,'Talk to her');
});
function harness(d=data(),pending) {
  const h=hooks(),calls=[];
  const {AdventureEncounterCard}=load('apps/mobile/src/components/burrow/adventure-encounter-card.tsx',{
    ...presentationImports(h),
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{
      View:'View',Text:'Text',Pressable:'Button',ScrollView:'Scroll',Modal:'Modal',
      StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390,height:844}),
    },
    '@/lib/adventure-friend-presentation':presentation,
    '@/lib/app-major-update-api':{},'@/lib/burrow-store':{},
    '@/lib/burrow-art-assets':{burrowArtForItem:()=>null},'./burrow-image':{Image:'Image'},
    './adventure-encounter-layout':{AdventureEncounterLayout:'Stage'},
    '@/lib/adventure-delivery':{readAdventureDelivery:()=>pending,queueAdventureDelivery:(...args)=>calls.push(args)},
  });
  const render=()=>nodes(h.render(()=>AdventureEncounterCard({data:d,onComplete(){}})));
  return {h,d,calls,render};
}
test('first encounter waits for Talk and then immediately shows the first prewritten line',()=>{
  const x=harness(),first=x.render();
  assert.equal(first.find(n=>n.type==='Stage').props.heading,'You met a new friend!');
  assert.ok(first.some(n=>n.props.children==='Let’s be friends'));
  assert.ok(first.some(n=>n.props.children==='You ran into Mr Mole down in the burrow.'));
  assert.ok(first.some(n=>n.props.children==='Talk to him'));
  first.find(n=>n.type==='Button').props.onPress();
  const next=x.render();assert.ok(next.some(n=>n.props.children==='A fresh dirt mound.'));
  assert.ok(!next.some(n=>n.props.children==='Let’s be friends'));assert.equal(x.calls.length,0);x.h.unmount();
});
test('returning encounter starts directly at dialogue; headline is stable through taps and bootstrap updates',()=>{
  const d=data();d.discoveries=[discovery()];const x=harness(d),first=x.render();
  const heading=first.find(n=>n.type==='Stage').props.heading;
  assert.notEqual(heading,'You met a new friend!');assert.ok(heading.includes('Mr Mole'));
  assert.ok(first.some(n=>n.props.children==='A fresh dirt mound.'));
  assert.ok(!first.some(n=>n.props.children==='Let’s be friends'||n.props.children==='Talk to him'));
  first.find(n=>n.type==='Button').props.onPress();
  d.discoveries=[];d.adventureCollection.progress=[];
  const next=x.render();assert.ok(next.some(n=>n.props.children==='Hm. My roof.'));
  assert.equal(next.find(n=>n.type==='Stage').props.heading,heading);
  assert.equal(x.calls.length,0,'line navigation never requests a reload');x.h.unmount();
});
test('new encounter does not change presentation if progress refreshes while talking',()=>{
  const x=harness();x.render().find(n=>n.type==='Button').props.onPress();
  x.d.discoveries=[discovery()];x.d.adventureCollection.progress=[{friend_id:'mole',completed:1}];
  assert.equal(x.render().find(n=>n.type==='Stage').props.heading,'You met a new friend!');x.h.unmount();
});
test('a persisted reply resumes at the reply without replaying the new-friend invitation',()=>{
  const x=harness(data(),{choiceId:'a'}),tree=x.render();
  assert.ok(tree.some(n=>n.props.children==='Hm. Accepted.'));
  assert.ok(!tree.some(n=>n.props.children==='Talk to him'));x.h.unmount();
});
