const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const defaults={stable_id:'outfit_default',title:'Default',category:'outfits',item_type:'outfit',price:0,tags:[],metadata:{starter:true,slot:'outfit',artOrdinal:0}};
const first={...defaults,stable_id:'outfit_01',title:'Cherry Gingham',price:300,metadata:{slot:'outfit',artOrdinal:1}};
const second={...first,stable_id:'outfit_02',title:'Denim Overalls',metadata:{slot:'outfit',artOrdinal:2}};
const cushion={...defaults,stable_id:'cushion_default',title:'Default Cushion',category:'cushions',item_type:'decor',metadata:{starter:true,slot:'cushion',artOrdinal:0}};
function harness(){
 const h=hooks(),saved={outfit:second,cushion};
 const data={profile:{id:'me'},partner:null,wallet:{balance:1000},hasPlus:false,catalog:[second,cushion,defaults,first],
  inventory:[defaults,first,second,cushion].map(item=>({owner_id:'me',item_id:item.stable_id})),loadouts:[],roomPhotos:[]};
 const components=load('apps/mobile/src/components/burrow/burrow-shop.tsx',{
  '@/lib/page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
  ...require('./coin-purchase-test-mock.cjs')().imports,react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{FlatList:'List',ScrollView:'Rail',Image:'NativeImage',Pressable:'Button',Text:'Text',View:'View',
   StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  './burrow-image':{Image:'Image'},'./coin-ui':{CoinLabel:'CoinLabel'},'expo-router':{router:{}},
  '@/lib/retained-tab-navigation':{},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/burrow-shop-categories':{BURROW_SHOP_CATEGORIES:['outfits','cushions'],burrowShopCategoryName:x=>x},
  '@/lib/app-major-update-api':{},'@/lib/burrow-store':{},'@/lib/burrow-presentation':{roomSlots:()=>saved},
  '@/lib/burrow-collection-options':load('apps/mobile/src/lib/burrow-collection-options.ts'),
  '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{common:1},burrowArtForItem:()=>({source:1,width:512,height:512,bounds:[0,0,512,512]})},
  '@/lib/room-photo-crop':{},'@/lib/burrow-shop-icons':{},'./burrow-back-button':{},
  './home-art-preview':{HomeArtPreview:'Preview'},'./shop-category-icon':{ShopCategoryIcon:'CategoryIcon'},
  '@/lib/burrow-shop-paging':load('apps/mobile/src/lib/burrow-shop-paging.ts'),
  '@/lib/burrow-shop-thumbnails':{createShopThumbnailWarmer:()=>({warm(){},cancel(){}})},
  './shop-item-price':{ShopItemPrice:'Price'},'@/lib/insufficient-coins':{},
 });
 const render=props=>nodes(h.render(()=>components.BurrowShop({data,section:'shop',initialCategory:'outfits',away:true,...props})));
 return {h,components,data,saved,render};
}
test('Shop starts with the first outfit product; other starter furniture and the underlying default entitlement stay intact',()=>{
 const x=harness(),all=x.render(),pager=all.find(n=>n.type===x.components.ShopCategoryPager);
 assert.deepEqual(Array.from(pager.props.pages.outfits,i=>i.stable_id),[first.stable_id,second.stable_id]);
 assert.equal(pager.props.pages.cushions[0],cushion,'only default outfits are hidden, not other starter products');
 assert.ok(x.data.catalog.includes(defaults));assert.ok(x.data.inventory.some(i=>i.item_id===defaults.stable_id));x.h.unmount();
});
test('Shop outfit detail variants also exclude Default without changing the selected outfit preview',()=>{
 const x=harness(),all=x.render({initialDetail:{itemId:first.stable_id}});
 const variants=all.find(n=>n.type==='List'&&n.props.data?.[0]?.item);
 assert.deepEqual(Array.from(variants.props.data,c=>c.item.stable_id),[first.stable_id,second.stable_id]);
 assert.equal(all.find(n=>n.type==='Preview').props.slots.outfit,first);x.h.unmount();
});
test('Shop detail variants scroll horizontally without vertical bounce and still switch previews',()=>{
 const x=harness(),props={initialDetail:{itemId:first.stable_id}};
 let all=x.render(props),variants=all.find(n=>n.type==='List'&&n.props.data?.[0]?.item);
 assert.equal(variants.props.horizontal,true);
 assert.equal(variants.props.directionalLockEnabled,true);
 assert.equal(variants.props.bounces,false);
 assert.equal(variants.props.alwaysBounceVertical,false);
 assert.equal(variants.props.alwaysBounceHorizontal,false);
 assert.equal(variants.props.overScrollMode,'never');
 assert.equal(variants.props.showsVerticalScrollIndicator,false);
 const card=variants.props.renderItem({item:variants.props.data[1]});
 assert.equal(card.props.style[0].width,72);assert.equal(card.props.style[0].height,78);
 assert.equal(card.props.children.props.size,68,'artwork size is unchanged');
 card.props.onPress();all=x.render(props);
 assert.equal(all.find(n=>n.type==='Preview').props.slots.outfit,second);
 variants=all.find(n=>n.type==='List'&&n.props.data?.[0]?.item);
 assert.ok(variants.props.renderItem({item:variants.props.data[1]}).props.style[1],'new preview is selected');
 assert.equal(x.saved.outfit,second,'browsing does not mutate the saved room');x.h.unmount();
});
test('Decorate and owned collections retain a selectable first Default entry that restores the actual bunny outfit',()=>{
 for(const ownedOnly of [false,true]){
  const x=harness();let all=x.render({section:'decorate',ownedOnly});
  const options=all.find(n=>n.type===x.components.DecorationOptions);
  assert.equal(options.props.items[0],defaults);assert.equal(options.props.selectedId,second.stable_id);
  options.props.onSelect(defaults);all=x.render({section:'decorate',ownedOnly});
  assert.equal(all.find(n=>n.type==='Preview').props.slots.outfit,defaults);
  assert.equal(all.find(n=>n.type===x.components.DecorationOptions).props.selectedId,defaults.stable_id);
  assert.equal(x.saved.outfit,second,'preview selection does not save or buy anything');x.h.unmount();
 }
});
test('Default thumbnail is a centered brown prohibition symbol, not a bunny or raster image',()=>{
 const x=harness(),list=x.h.render(()=>x.components.DecorationOptions({items:[defaults,first],owned:new Set(),hasPlus:false,onSelect(){}}));
 const cardNode=list.props.renderItem({item:defaults}),card=cardNode.type(cardNode.props),artNode=card.props.children[0];
 for(const size of [68,74,140]){
  const icon=artNode.type({...artNode.props,size}),[circle,line]=icon.props.children;
  assert.equal(icon.props.testID,'default-outfit-icon');assert.equal(icon.props.style.width,size);assert.equal(icon.props.style.height,size);
  assert.equal(circle.props.style.borderColor,'#4A281E');assert.equal(circle.props.style.borderRadius,circle.props.style.width/2);
  assert.equal(line.props.style.backgroundColor,circle.props.style.borderColor);assert.equal(line.props.style.transform[0].rotate,'-45deg');
  assert.ok(Math.abs(line.props.style.left+line.props.style.width/2-size/2)<1e-9);
  assert.ok(Math.abs(line.props.style.top+line.props.style.height/2-size/2)<1e-9);
  assert.ok(nodes(icon).every(n=>n.type==='View'),'default thumbnail must not instantiate bunny or image decoders');
 }
 const itemNode=list.props.renderItem({item:first}),itemCard=itemNode.type(itemNode.props),itemArt=itemCard.props.children[0];
 assert.notEqual(itemArt.type(itemArt.props).props.testID,'default-outfit-icon','real products keep their original artwork');
 x.h.unmount();
});
