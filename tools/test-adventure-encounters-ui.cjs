const {presentationImports}=require('./motion-test-utils.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?typeof tree.type==='function'?nodes(tree.type(tree.props)):((tree.type==='Modal'||tree.type==='RewardPopup')&&!tree.props.visible?[]:[tree,...nodes(tree.props?.children)]):[];
const native={Pressable:'Button',Text:'Text',View:'View',Modal:'Modal',ScrollView:'Scroll',FlatList:'List',StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390,height:844})};
const content=fs.readdirSync('apps/api/src/data/adventure-friends').map(file=>JSON.parse(fs.readFileSync('apps/api/src/data/adventure-friends/'+file)));
test('v8 contains 15 dual-art friends, 450 unique dialogues and 483 byte-matched remote-only rewards',()=>{
  assert.equal(content.length,15);assert.equal(content.flatMap(x=>x.dialogues).length,450);
  const dialogues=content.flatMap(x=>x.dialogues),gifts=content.flatMap(x=>x.gifts);
  assert.equal(new Set(dialogues.map(x=>x.id)).size,450);assert.equal(gifts.length,483);assert.equal(new Set(gifts.map(x=>x.id)).size,483);
  for(const c of content) {assert.equal(c.art.length,2);for(const file of c.art)assert.ok(fs.existsSync('apps/mobile/assets/burrow-webp/adventure-page/'+file));
    assert.equal(c.dialogues.filter(x=>x.phase==='Intro').length,10);assert.equal(c.dialogues.filter(x=>x.phase==='Pool').length,20);}
  const crypto=require('node:crypto');for(const g of gifts)assert.equal(crypto.createHash('sha256').update(fs.readFileSync('apps/mobile/assets/burrow-webp/Gift Collection Webp/'+g.file)).digest('hex'),g.sha256);
  assert.equal(fs.readFileSync('apps/mobile/src/lib/burrow-art-assets.ts','utf8').includes('require("../../assets/burrow-webp/Gift Collection Webp'),false);
});
test('encounter reads scene/dialogue, swaps to image 2 after answer and requires an explicit gift claim',async()=>{
  const h=hooks(),dialogue=content[0].dialogues[0],calls=[],finishes=[];
  const data={activeAdventure:{id:'journey'},adventureResult:{metadata:{encounterV2:true,dialogue,friendSnapshot:{name:content[0].name},giftSnapshot:{title:'A gift'}}}};
  const {AdventureEncounterCard}=load('apps/mobile/src/components/burrow/adventure-encounter-card.tsx',{
    ...presentationImports(h),
    '@/lib/adventure-friend-presentation':load('apps/mobile/src/lib/adventure-friend-presentation.ts'),
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
    '@/lib/app-major-update-api':{completeFriendInteraction:async(id,response)=>{calls.push(['answer',id,response]);return {reaction:dialogue.choices[0].reaction};},claimAdventureResult:async(id)=>{calls.push(['claim',id]);return {}; }},
    '@/lib/burrow-store':{confirmBurrowAdventureItemLocally(){},confirmBurrowAdventureClaimLocally:id=>calls.push(['confirmed',id]),runBurrowAction:async(key,fn)=>{await fn();return true;}},
    '@/lib/adventure-delivery':{readAdventureDelivery:()=>undefined,queueAdventureDelivery:(id,intent)=>calls.push(['queue',id,intent])},
    '@/lib/burrow-art-assets':{burrowArtForItem:()=>({source:'gift'})},'@/lib/burrow-ui-assets':{burrowFriendArt:(_,answered)=>answered?'friend-2':'friend-1'},'./burrow-image':{Image:'Image'},
    './adventure-encounter-layout':{AdventureEncounterLayout:'Stage'},
  });
  const render=()=>nodes(h.render(()=>AdventureEncounterCard({data,onComplete:()=>finishes.push(true)})));
  assert.equal(render().find(n=>n.type==='Stage').props.answered,false);
  assert.equal(render().find(n=>n.type==='Stage').props.friendName,content[0].name);
  render().find(n=>n.type==='Button').props.onPress(); // explicit invitation
  for(let i=0;i<dialogue.lines.length+1;i++)render().find(n=>n.type==='Button').props.onPress();
  let tree=render();assert.equal(tree.filter(n=>n.type==='Button').length,dialogue.choices.length);
  tree.find(n=>n.type==='Button').props.onPress();await flush();tree=render();
  assert.equal(tree.find(n=>n.type==='Stage').props.answered,true);assert.equal(calls.filter(c=>c[2]?.choiceId).length,1);
  for(let i=0;i<dialogue.choices[0].reaction.length+(dialogue.outro?1:0);i++)render().find(n=>n.type==='Button').props.onPress();
  const reward=render().find(n=>n.type==='RewardScreen');assert.equal(reward.props.variant,'gift');assert.equal(reward.props.item,data.adventureResult.metadata.giftSnapshot);assert.equal(finishes.length,0);
  reward.props.onClaim();reward.props.onClaim();
  assert.equal(finishes.length,1,'local claim navigates immediately without fading contents or waiting on network');
  assert.equal(render().find(n=>n.type==='RewardScreen').props.closing,undefined);await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c=>c[2]?.choiceId))),['queue','journey',{choiceId:dialogue.choices[0].id,checkpoint:{stage:'reply',line:0,invited:true}}]);assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c=>c[2]?.finish))),['queue','journey',{finish:true}]);
  h.unmount();
});
test('a failed durable gift intent stays visible and retries once, with no stale completion after unmount',async()=>{
  const h=hooks();let saved=false,writes=0,exits=0;
  const data={activeAdventure:{id:'journey'},adventureResult:{metadata:{encounterV2:true,giftSnapshot:{title:'A gift'}}}};
  const {AdventureEncounterCard}=load('apps/mobile/src/components/burrow/adventure-encounter-card.tsx',{
    ...presentationImports(h),react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
    '@/lib/adventure-friend-presentation':{adventureFriendPresentation:()=>({friendName:'Mr Mole'})},
    '@/lib/app-major-update-api':{},'@/lib/burrow-store':{},
    '@/lib/adventure-delivery':{readAdventureDelivery:()=>undefined,queueAdventureDelivery:()=>{writes++;return saved;}},
    './adventure-encounter-layout':{AdventureEncounterLayout:'Stage'},
  });
  const render=()=>nodes(h.render(()=>AdventureEncounterCard({data,onComplete:()=>exits++}))).find(n=>n.type==='RewardScreen');
  await render().props.onClaim();assert.equal(writes,1);assert.equal(exits,0);
  assert.match(render().props.error,/Try claiming again/);
  saved=true;const claim=render().props.onClaim;await claim();await claim();
  assert.equal(exits,1);assert.equal(writes,2);
  h.unmount();await claim();assert.equal(exits,1);assert.equal(writes,2);
});
test('legacy gift keeps its contents until server confirmation and permits retry without duplicate claims',async()=>{
  const h=hooks();let reply,requests=0,exits=0;const confirms=[];
  const data={activeAdventure:{id:'legacy'},adventureResult:{metadata:{giftSnapshot:{title:'Legacy gift'}}}};
  const {AdventureEncounterCard}=load('apps/mobile/src/components/burrow/adventure-encounter-card.tsx',{
    ...presentationImports(h),react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
    '@/lib/adventure-friend-presentation':{adventureFriendPresentation:()=>({friendName:'Mr Mole'})},
    '@/lib/app-major-update-api':{claimAdventureResult:()=>{requests++;return new Promise((resolve,reject)=>{reply={resolve,reject};});}},
    '@/lib/burrow-store':{runBurrowAction:async(_,fn)=>{try{await fn();return true;}catch{return false;}},
      confirmBurrowAdventureItemLocally:(...args)=>confirms.push(['item',...args]),confirmBurrowAdventureClaimLocally:(...args)=>confirms.push(['finish',...args])},
    '@/lib/adventure-delivery':{readAdventureDelivery:()=>undefined},'./adventure-encounter-layout':{AdventureEncounterLayout:'Stage'},
  });
  const render=()=>nodes(h.render(()=>AdventureEncounterCard({data,onComplete:()=>exits++}))).find(n=>n.type==='RewardScreen');
  const pending=render().props.onClaim();await render().props.onClaim();assert.equal(requests,1);
  assert.equal(render().props.title,'Legacy gift');assert.equal(render().props.busy,true);assert.equal(exits,0);
  reply.reject(Error('offline'));await pending;assert.match(render().props.error,/Try claiming again/);assert.equal(confirms.length,0);
  const retry=render().props.onClaim();reply.resolve({itemId:'lamp'});await retry;
  assert.equal(exits,1);assert.equal(requests,2);assert.deepEqual(confirms,[['item','legacy','lamp'],['finish','legacy']]);
  await render().props.onClaim();assert.equal(requests,2);assert.equal(exits,1);h.unmount();
});
test('gift collection opens the 15-category grid; unknown categories never download art',()=>{
  const h=hooks(),resolved=[];
  const gifts=content.flatMap(c=>c.gifts.map(g=>({stable_id:g.id,title:g.name,tags:['adventure_v2_gift'],metadata:{giftCategory:g.category}})));
  const data={catalog:gifts,inventory:[],adventureCollection:{displays:[]}};
  const {AdventureGiftCollection}=load('apps/mobile/src/components/burrow/adventure-gift-collection.tsx',{
    '@react-navigation/native':{usePreventRemove(){}},'@/lib/use-page-back-gesture':{usePageBackGesture(){}},
    './burrow-back-button':{BurrowBackButton:'Button'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'./burrow-image':{Image:'Image'},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20,bottom:0})},
    'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
    '@/lib/adventure-gift-collection-model':load('apps/mobile/src/lib/adventure-gift-collection-model.ts'),
    '@/lib/burrow-art-assets':{burrowArtForItem:item=>{resolved.push(item.stable_id);return {source:'gift'};}},
  });
  const tree=nodes(h.render(()=>AdventureGiftCollection({data,ownerId:'me',onBack(){},onOpenCategory(){}}))),list=tree.find(n=>n.type==='List');
  assert.equal(list.props.data.length,15);assert.equal(list.props.numColumns,3);assert.equal(list.props.windowSize,5);
  const unknown=nodes(list.props.renderItem({item:list.props.data[0]}));assert.equal(unknown.some(n=>n.type==='Image'),false);assert.deepEqual(resolved,[]);
  assert.equal(tree.filter(n=>n.type==='Button').length,1);
  h.unmount();
});
