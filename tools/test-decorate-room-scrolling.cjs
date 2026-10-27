const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const categories=['cushions','tables','rugs'];
const catalog=categories.flatMap((category,index)=>Array.from({length:index===2?2:32},(_,i)=>({
 stable_id:`${category}-${i}`,category,title:`${category} · Variant ${i}`,price:100,item_type:'decor',tags:[],
 metadata:{slot:{cushions:'cushion',tables:'table',rugs:'rug'}[category]},
})));
function harness(){
 const h=hooks(),saved={cushion:catalog[0],table:catalog[32]},warmups=[],cancelled=[];
 const imports={...require('./coin-purchase-test-mock.cjs')().imports,react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{FlatList:'List',ScrollView:'Rail',Image:'NativeImage',Pressable:'Button',Text:'Text',View:'View',
   StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  './burrow-image':{Image:'Image'},'./coin-ui':{CoinLabel:'CoinLabel'},'expo-router':{router:{}},
  '@/lib/retained-tab-navigation':{},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/burrow-shop-categories':{BURROW_SHOP_CATEGORIES:categories,burrowShopCategoryName:x=>x},
  '@/lib/app-major-update-api':{},'@/lib/burrow-store':{},'@/lib/burrow-presentation':{roomSlots:()=>saved},
  '@/lib/burrow-collection-options':{decorationOptions:(data,category)=>data.filter(i=>i.category===category)},
  '@/lib/burrow-art-assets':{burrowArtForItem:()=>({source:1,width:500,height:300,bounds:[50,10,450,290]})},
  '@/lib/room-photo-crop':{},'@/lib/burrow-shop-icons':{},'./burrow-back-button':{},'./outfit-bunny':{},
  './home-art-preview':{HomeArtPreview:'Preview'},'./shop-category-icon':{ShopCategoryIcon:'CategoryIcon'},
  '@/lib/burrow-shop-paging':load('apps/mobile/src/lib/burrow-shop-paging.ts'),
  '@/lib/burrow-shop-thumbnails':{createShopThumbnailWarmer:()=>({warm:items=>warmups.push(items),cancel:()=>cancelled.push(true)})},
  './shop-item-price':{ShopItemPrice:'Price'},'@/lib/insufficient-coins':{showInsufficientCoins(){}},
 };
 imports['@/lib/page-edge-gesture']=load('apps/mobile/src/lib/page-edge-gesture.ts');
 const components=load('apps/mobile/src/components/burrow/burrow-shop.tsx',imports);
 const data={catalog,profile:{id:'me'},inventory:[],loadouts:[],hasPlus:false};
 return {h,components,warmups,cancelled,data,saved,render:()=>h.render(()=>components.BurrowShop({data,section:'decorate',initialCategory:'cushions',away:false}))};
}
test('decorator keeps the exact card geometry, with explicit separator and fixed offsets at every index',()=>{
 const h=harness(),items=catalog.slice(0,32),onSelect=()=>{},props={items,owned:new Set(),hasPlus:false,onSelect};
 let list=h.h.render(()=>h.components.DecorationOptions(props));
 assert.equal(list.props.horizontal,true);assert.equal(list.props.bounces,false);assert.equal(list.props.removeClippedSubviews,false);
 assert.equal(list.props.initialNumToRender,10);assert.equal(list.props.windowSize,5);
 assert.equal(list.props.contentContainerStyle.gap,undefined);assert.equal(list.props.contentContainerStyle.paddingHorizontal,12);
 assert.equal(list.props.ItemSeparatorComponent().props.style.width,9);
 for(let index=0;index<32;index++)assert.deepEqual(JSON.parse(JSON.stringify(list.props.getItemLayout(items,index))),{length:index===31?105:114,offset:12+114*index,index});
 for(let first=0;first<25;first++){
  const start=list.props.getItemLayout(items,first),end=list.props.getItemLayout(items,first+5);
  assert.equal(end.offset+end.length-start.offset,6*114,'virtual spacers occupy exactly the removed cells, with no missing gap');
 }
 const cardNode=list.props.renderItem({item:items[0]}),card=cardNode.type(cardNode.props);
 assert.equal(card.props.style[0].width,105);assert.equal(card.props.style[0].height,126);
 assert.equal(card.props.children[0].props.size,74,'art frame is unchanged');
 const originalRender=list.props.renderItem;
 list=h.h.render(()=>h.components.DecorationOptions(props));assert.equal(list.props.renderItem,originalRender);
 list.props.onViewableItemsChanged({viewableItems:[{index:18}]});assert.equal(h.warmups.at(-1)[0],items[16]);
 assert.equal(h.warmups.at(-1).length,14,'only visible/nearby art is queued, not the catalogue');
 h.h.unmount();assert.equal(h.cancelled.length,1);
 const warmed=h.warmups.length;list.props.onViewableItemsChanged({viewableItems:[{index:26}]});
 assert.equal(h.warmups.length,warmed,'late viewability events cannot restart prefetch after leaving');
});
test('category switching resets only its product rail and never changes room slots or preview handlers',()=>{
 const h=harness();let tree=nodes(h.render()),preview=tree.find(n=>n.type==='Preview');
 const first=tree.find(n=>n.type===h.components.DecorationOptions);
 const rail=tree.find(n=>n.type===h.components.CategoryRail);
 const slots=preview.props.slots,onSlot=preview.props.onSlot;
 for(const category of ['tables','rugs','cushions','rugs','tables']){
  rail.props.onChange(category);tree=nodes(h.render());const options=tree.find(n=>n.type===h.components.DecorationOptions);
  assert.equal(options.key,category);assert.equal(options.props.items[0].category,category);
  preview=tree.find(n=>n.type==='Preview');assert.equal(preview.props.slots,slots);assert.equal(preview.props.onSlot,onSlot);
  assert.equal(options.props.onSelect,first.props.onSelect,'category changes do not churn card callbacks');
 }
 h.h.unmount();
});
test('rapid preview taps merge from current slots, keep the list mounted, and reselecting the same item is a no-op',()=>{
 const h=harness();let tree=nodes(h.render()),options=tree.find(n=>n.type===h.components.DecorationOptions);
 const select=options.props.onSelect,items=options.props.items;
 for(const item of [items[1],items[10],catalog[33],items[25]])select(item);
 tree=nodes(h.render());let preview=tree.find(n=>n.type==='Preview');
 assert.equal(preview.props.slots.cushion,items[25]);assert.equal(preview.props.slots.table,catalog[33]);
 const old=preview.props.slots;
 select(items[25]);tree=nodes(h.render());preview=tree.find(n=>n.type==='Preview');
 assert.equal(preview.props.slots,old);options=tree.find(n=>n.type===h.components.DecorationOptions);
 assert.equal(options.key,'cushions');assert.equal(options.props.onSelect,select);assert.equal(options.props.items,items);
 h.h.unmount();
});
test('A then B each immediately publish their own preview without waiting for preparation or a debounce',()=>{
 const h=harness();let all=nodes(h.render());const options=all.find(n=>n.type===h.components.DecorationOptions);
 const first=options.props.items[1],second=options.props.items[2];
 options.props.onSelect(first);all=nodes(h.render());
 assert.equal(all.find(n=>n.type==='Preview').props.slots.cushion,first);
 options.props.onSelect(second);all=nodes(h.render());
 assert.equal(all.find(n=>n.type==='Preview').props.slots.cushion,second);
 assert.equal(all.find(n=>n.type===h.components.DecorationOptions).key,'cushions');h.h.unmount();
});
test('speculative decoding is globally bounded, replaces stale categories, preserves original resolution and tolerates failure',async()=>{
 const calls=[],pending=[];
 const module=load('apps/mobile/src/lib/burrow-shop-thumbnails.ts',{
  './burrow-art-assets':{burrowArtForItem:item=>({source:item.stable_id,thumbnail:'thumb-'+item.stable_id,width:500,height:800})},
  './prepared-burrow-images':{preparedBurrowImage:source=>source==='cached',prepareBurrowImage:(source,size)=>{
   const job=deferred();calls.push({source,size});pending.push(job);return job.promise;
  }},
 });
 const first=module.createShopThumbnailWarmer();first.warm(catalog.slice(0,12));
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.size===800),'no low-res source replaces room artwork');
 first.cancel();const second=module.createShopThumbnailWarmer();
 second.warm([{stable_id:'cached'},...catalog.slice(32,44)]);
 assert.equal(calls.length,2,'category changes cannot multiply native decode workers');
 pending[0].resolve({});await flush();assert.equal(calls[2].source,'tables-0');
 pending[1].reject(Error('decode failed'));await flush();assert.equal(calls[3].source,'tables-1');
 second.warm([{stable_id:'wall',category:'wallpapers'}]);pending[2].resolve({});await flush();
 assert.equal(calls.at(-1).source,'thumb-wall');second.cancel();
 pending[3].resolve({});pending[4].resolve({});await flush();assert.equal(calls.length,5,'cancelled backlog stays cancelled');
});
