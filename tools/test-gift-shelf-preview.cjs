const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
function harness(){
 const h=hooks(),post=deferred(),requests=[],confirmations=[],backPolicies=[];let closed=0,epoch=1;
 const gift=(id,category)=>({stable_id:id,title:id,item_type:'souvenir',category:'adventure_gifts',tags:['adventure_v2_gift'],metadata:{giftCategory:category,giftCategoryCode:category}});
 const a=gift('a','C1'),b=gift('b','C2'),locked=gift('locked','C1'),partnerOnly=gift('partner-only','C1'),lamp={stable_id:'lamp',title:'lamp',tags:[],item_type:'decor',category:'lamps',metadata:{slot:'lamp',starter:true}};
 let data={profile:{id:'me',timezone_name:'UTC'},partner:{id:'partner'},pairVersion:'pair-1',catalog:[a,b,locked,partnerOnly,lamp],
 inventory:[{id:'1',owner_id:'me',item_id:'a'},{id:'2',owner_id:'me',item_id:'b'},{id:'3',owner_id:'partner',item_id:'partner-only'}],loadouts:[],roomPhotos:[],adventureCollection:{displays:[{user_id:'me',gift_id:'a'}]}};
 const {GiftShelfPreview}=load('apps/mobile/src/components/burrow/gift-shelf-preview.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',FlatList:'List',Pressable:'Button',StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390,height:844})},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},'@react-navigation/native':{usePreventRemove:value=>backPolicies.push(value)},
  '@/lib/session-lifecycle':{sessionEpoch:()=>epoch},'@/lib/app-major-update-api':{selectAdventureGift:async id=>requests.push(id)},
  '@/lib/burrow-store':{getBurrowSnapshot:()=>({data}),runBurrowAction:async(_key,fn)=>{await fn();return post.promise;},confirmBurrowShelfGift:(...args)=>confirmations.push(args)},
  '@/lib/adventure-gift-collection-model':load('apps/mobile/src/lib/adventure-gift-collection-model.ts'),
  '@/lib/burrow-presentation':load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':{}}),
  '@/lib/burrow-art-assets':{burrowArtForItem:item=>({source:item.stable_id})},'./home-art-preview':{HomeArtPreview:'Preview'},'./burrow-image':{Image:'Image'},
 });
 const render=()=>nodes(h.render(()=>GiftShelfPreview({data,initialItemId:'a',onClose:()=>closed++})));
 const list=()=>render().find(n=>n.type==='List'),choose=id=>list().props.renderItem({item:list().props.data.find(i=>i.stable_id===id)}).props.onPress();
 const button=text=>render().find(n=>n.type==='Button'&&n.props.children?.props?.children===text);
 return {h,render,list,choose,button,requests,confirmations,post,backPolicies,closed:()=>closed,invalidate:()=>epoch++,changePair:()=>{data={...data,partner:{id:'other'}};}};
}
test('shelf preview shows all owned gift categories only, changes just shelf locally, and Cancel never saves',()=>{
 const h=harness();assert.deepEqual([...h.list().props.data.map(i=>i.stable_id)],['a','b']);assert.equal(h.button('In use').props.disabled,true);
 h.choose('b');const preview=h.render().find(n=>n.type==='Preview');assert.equal(preview.props.slots.shelf_decor.stable_id,'b');assert.equal(preview.props.slots.lamp.stable_id,'lamp');assert.equal(h.requests.length,0);
 h.render().find(n=>n.props?.accessibilityLabel==='Cancel gift preview').props.onPress();assert.equal(h.closed(),1);assert.equal(h.confirmations.length,0);h.h.unmount();
});
test('Replace submits once; closes only after back protection releases, then confirms existing shelf path',async()=>{
 const h=harness();h.choose('b');const press=h.button('Replace').props.onPress;press();press();await flush();
 assert.deepEqual(h.requests,['b']);h.render();assert.equal(h.backPolicies.at(-1),true);assert.equal(h.closed(),0);
 h.post.resolve(true);await flush();h.render();assert.equal(h.backPolicies.at(-1),false);assert.equal(h.closed(),1);assert.deepEqual(h.confirmations,[['me','b']]);h.render();assert.equal(h.closed(),1);h.h.unmount();
});
test('failed Replace retains draft and supports retry; late responses after unmount/account change cannot confirm or pop',async()=>{
 const h=harness();h.choose('b');h.button('Replace').props.onPress();h.post.resolve(false);await flush();
 assert.ok(h.render().some(n=>n.props?.accessibilityRole==='alert'));assert.equal(h.button('Replace').props.disabled,false);assert.equal(h.closed(),0);assert.equal(h.confirmations.length,0);h.h.unmount();
 for(const invalidate of ['unmount','epoch','pair']){const h=harness();h.choose('b');h.button('Replace').props.onPress();await flush();
  if(invalidate==='unmount')h.h.unmount();else if(invalidate==='epoch')h.invalidate();else h.changePair();
  h.post.resolve(true);await flush();assert.equal(h.confirmations.length,0);assert.equal(h.closed(),0);if(invalidate!=='unmount')h.h.unmount();
 }
});
