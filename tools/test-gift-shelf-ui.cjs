const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/adventure-gift-collection-model.ts');
const docs=fs.readdirSync('apps/api/src/data/adventure-friends').map(f=>JSON.parse(fs.readFileSync('apps/api/src/data/adventure-friends/'+f)));
const catalog=docs.flatMap(doc=>doc.gifts.map(g=>({stable_id:g.id,title:g.name,tags:['adventure_v2_gift'],metadata:{giftCategory:g.category,giftCategoryCode:g.categoryCode,friendId:g.friendId}})));
const cats=catalog.filter(g=>g.metadata.giftCategory==='Animal Statues');
test('Vinyl replaces all 32 Hazel gifts without changing their durable IDs, source order or category code',()=>{
 const hz=docs.find(d=>d.code==='HZ');assert.equal(hz.gifts.length,32);
 for(const [i,gift] of hz.gifts.entries()){
  assert.equal(gift.id,`adventure_gift_${465+i}`);assert.equal(gift.sourceId,465+i);
  assert.equal(gift.giftId,`HZ-G${String(i+1).padStart(2,'0')}`);assert.equal(gift.categoryCode,'C15');assert.equal(gift.category,'Vinyl');
  const bytes=fs.readFileSync('apps/mobile/assets/burrow-webp/Gift Collection Webp/'+gift.file);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.equal(bytes.length,gift.bytes);assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),gift.sha256);
  assert.ok(gift.key.includes(gift.sha256.slice(0,16)));
 }
 const group=model.giftCollectionModel(base(),'a').categories.find(c=>c.name==='Vinyl');
 assert.equal(group.total,32);assert.equal(group.friendName,'Hazel');assert.equal(hz.gifts[0].name,'Tropical Muse');assert.equal(hz.gifts.at(-1).name,'Ghost Beats');
});
const base=()=>({profile:{id:'a'},partner:null,pairVersion:null,catalog,inventory:[{id:'100',owner_id:'a',item_id:cats[1].stable_id},{id:'101',owner_id:'a',item_id:cats[0].stable_id}],friends:docs.map(d=>({stable_id:d.gifts[0].friendId,name:d.name})),adventureCollection:{displays:[{user_id:'a',gift_id:cats[0].stable_id}]}});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
test('generic item previews preserve gift canvases before any silhouette fitting branch',()=>{
 for(const file of ['burrow-screen.tsx','burrow-shop.tsx']){
  const source=fs.readFileSync('apps/mobile/src/components/burrow/'+file,'utf8');
  const start=source.indexOf(file==='burrow-screen.tsx'?'function CatalogArtwork':'const Artwork');
  const preview=source.slice(start,source.indexOf('const [left',start));
  assert.match(preview,/item\.tags\.includes\('adventure_v2_gift'\)/);
  assert.match(preview.slice(preview.indexOf("item.tags.includes('adventure_v2_gift')")),/contentFit="contain"/);
 }
});
function harness(options={}){
 const h=hooks(),resolved=[],calls=[],previewed=[],gestures=[],post=deferred(),jsx=(type,props)=>({type,props});let closed=0,data=base(),category;
 const m=load('apps/mobile/src/components/burrow/adventure-gift-collection.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{...Object.fromEntries(['View','Text','FlatList','Modal','Pressable','ActivityIndicator'].map(x=>[x,x])),StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390})},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
  '@react-navigation/native':{usePreventRemove(){}},'@/lib/use-page-back-gesture':{usePageBackGesture:enabled=>gestures.push(enabled)},
  './burrow-back-button':{BurrowBackButton:'BackButton'},
  '@/lib/adventure-gift-collection-model':model,'@/lib/burrow-art-assets':{burrowArtForItem:item=>{resolved.push(item.stable_id);return{source:item.stable_id};}},'./burrow-image':{Image:'Image'},
 });
 const render=()=>h.render(()=>m.AdventureGiftCollection({data,ownerId:data.profile.id,category,onOpenCategory:name=>{category=name;},onBack:()=>{if(category)category=undefined;else closed++;},onClose:()=>closed++,onPreview:item=>previewed.push(item),onSelect:item=>{calls.push(item);return options.select?options.select(item):post.promise;}}));
 render();
 const list=()=>nodes(render()).find(n=>n.type==='FlatList');
 const tile=index=>nodes(list().props.renderItem({item:list().props.data[index]}))[0];
 const find=label=>nodes(render()).find(n=>n.props?.accessibilityLabel===label);
 const press=label=>{const n=find(label);assert.ok(n,label);n.props.onPress();render();};
 return{h,render,list,tile,find,press,calls,previewed,resolved,gestures,post,closed:()=>closed,setData:value=>{data=value;render();}};
}
test('selected owned gift has separate Preview and Replace; preview navigates without committing or consuming the selection',()=>{
 const h=harness();h.tile(0).props.onPress();h.render();h.tile(0).props.onPress();h.render();
 assert.ok(h.find('Preview'));assert.ok(h.find('Replace'));h.press('Preview');assert.equal(h.previewed.length,1);assert.equal(h.calls.length,0);assert.equal(h.closed(),0);
 assert.equal(h.tile(0).props.accessibilityState.selected,true);h.h.unmount();
});
test('real gift library remains 15 categories / 483 items with actual donor names and totals',()=>{
 const m=model.giftCollectionModel(base(),'a');assert.equal(m.categories.length,15);assert.equal(m.categories.reduce((s,c)=>s+c.total,0),483);
 const row=m.categories.find(c=>c.name==='Animal Statues');assert.equal(row.total,32);assert.equal(row.count,2);assert.equal(row.friendName,'Kiki');assert.equal(row.found.stable_id,cats[1].stable_id,'first acquisition, not first catalog entry');
 assert.deepEqual([...row.items.slice(0,2).map(item=>item.stable_id)],[cats[1].stable_id,cats[0].stable_id],'owned gifts fill the first slots in acquisition order');
 assert.equal(model.giftCollectionModel(base(),'other').categories.every(c=>c.count===0&&c.found===null),true);
 const duplicate=base();duplicate.inventory.push({id:'102',owner_id:'a',item_id:cats[0].stable_id});assert.equal(model.giftCollectionModel(duplicate,'a').categories[0].count,2);
 const dated=base();dated.inventory=[{id:'00000000-0000-4000-8000-000000000001',owner_id:'a',item_id:cats[0].stable_id,acquired_at:'2026-10-16T12:00:00Z'},{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',owner_id:'a',item_id:cats[1].stable_id,acquired_at:'2026-10-15T12:00:00Z'}];assert.equal(model.giftCollectionModel(dated,'a').categories[0].found.stable_id,cats[1].stable_id,'UUID is not an acquisition timestamp');
});
test('category overview is 3 by 5; unlocked uses first gift, unknowns use ? and ??? without resolving art',()=>{
 const h=harness();assert.equal(h.list().props.data.length,15);assert.equal(h.list().props.numColumns,3);
 const known=h.tile(0);assert.equal(nodes(known).find(n=>n.type==='Image').props.source,cats[1].stable_id);
 const before=h.resolved.length,unknown=h.tile(1);assert.equal(nodes(unknown).some(n=>n.props?.children==='???'),true);assert.equal(h.resolved.length,before);
 assert.equal(unknown.props.disabled,true);assert.equal(known.props.disabled,false);
 h.h.unmount();
});
test('paired and unpaired category details pack acquired gifts first, oldest first, after reopening/restart',()=>{
 for(const partner of [null,{id:'partner'}]){
  const value=base();value.partner=partner;value.inventory=[
   {id:'uuid-c',owner_id:'a',item_id:cats[8].stable_id,acquired_at:'2026-10-17T12:00:00Z'},
   {id:'uuid-a',owner_id:'a',item_id:cats[5].stable_id,acquired_at:'2026-10-15T12:00:00Z'},
   {id:'uuid-b',owner_id:'a',item_id:cats[2].stable_id,acquired_at:'2026-10-16T12:00:00Z'},
   {id:'uuid-duplicate',owner_id:'a',item_id:cats[5].stable_id,acquired_at:'2026-10-18T12:00:00Z'},
   {id:'partner',owner_id:'partner',item_id:cats[0].stable_id,acquired_at:'2026-10-14T12:00:00Z'},
  ];
  for(const data of [value,JSON.parse(JSON.stringify(value))]){
   const group=model.giftCollectionModel(data,'a').categories[0];
   assert.deepEqual([...group.items.slice(0,3).map(item=>item.stable_id)],[cats[5].stable_id,cats[2].stable_id,cats[8].stable_id]);
   assert.equal(group.count,3);assert.equal(group.found.stable_id,cats[5].stable_id);
   const owned=new Set(value.inventory.filter(row=>row.owner_id==='a').map(row=>row.item_id));
   assert.ok(group.items.slice(3).every(item=>!owned.has(item.stable_id)));
  }
 }
});
test('library is a native card, uses the shared back button and only blocks edge-back during an actual save',async()=>{
 const h=harness();assert.equal(nodes(h.render()).some(n=>n.type==='Modal'),false);assert.equal(h.gestures.at(-1),true);
 h.tile(0).props.onPress();h.render();h.tile(0).props.onPress();h.render();h.press('Replace');
 assert.equal(h.gestures.at(-1),false);assert.equal(h.find('Back to gift categories').props.disabled,true);
 h.post.resolve(true);await flush();h.render();assert.equal(h.gestures.at(-1),true);
 h.h.unmount();
});
test('opening category shows full locked/owned list and donor; selecting never saves until explicit Place',async()=>{
 const h=harness();h.tile(0).props.onPress();h.render();
 assert.equal(h.list().props.data.length,32);assert.ok(nodes(h.render()).some(n=>n.props?.children==='Animal Statues'));
 assert.ok(nodes(h.render()).some(n=>Array.isArray(n.props?.children)&&n.props.children.join('')==='From Kiki'));
 assert.equal(h.find('Replace'),undefined);assert.equal(h.tile(2).props.disabled,true);const before=h.resolved.length;h.tile(2);assert.equal(h.resolved.length,before);
 h.tile(1).props.onPress();h.render();assert.equal(h.calls.length,0);assert.equal(h.tile(1).props.accessibilityState.selected,true);assert.ok(h.find('Replace'));
 const place=h.find('Replace').props.onPress;place();place();h.render();assert.equal(h.calls.length,1);assert.equal(h.closed(),0);assert.equal(h.find('Done'),undefined);
 h.post.resolve(true);await flush();h.render();assert.ok(h.find('Done'));h.press('Done');assert.equal(h.closed(),1);h.h.unmount();
});
test('failed save has no success dialog, retains selection, and can retry; category back returns overview',async()=>{
 let n=0;const h=harness({select:()=>++n===1?false:true});h.tile(0).props.onPress();h.render();h.tile(0).props.onPress();h.render();h.press('Replace');await flush();h.render();assert.equal(h.find('Done'),undefined);assert.ok(nodes(h.render()).some(n=>n.props?.accessibilityRole==='alert'));
 h.press('Replace');await flush();h.render();assert.ok(h.find('Done'));h.h.unmount();
 const back=harness();back.tile(0).props.onPress();back.render();back.press('Back to gift categories');assert.equal(back.list().props.data.length,15);assert.equal(back.closed(),0);back.press('Back to Home');assert.equal(back.closed(),1);back.h.unmount();
});
test('late save cannot show success after unmount or overwrite the next account scope',async()=>{
 for(const change of ['unmount','scope']){const h=harness();h.tile(0).props.onPress();h.render();h.tile(0).props.onPress();h.render();h.press('Replace');
  if(change==='unmount')h.h.unmount();else h.setData({...base(),profile:{id:'other'},inventory:[]});
  h.post.resolve(true);await flush();if(change==='scope'){h.render();assert.equal(h.find('Done'),undefined);assert.equal(h.list().props.data.length,32);assert.equal(h.find('Replace'),undefined);h.h.unmount();}assert.equal(h.closed(),0);
 }
});
