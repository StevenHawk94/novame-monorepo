const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const presentation=load('apps/mobile/src/lib/burrow-presentation.ts',{'@novame/engine':{}});
const design=load('apps/mobile/src/lib/room-edit-design.ts',{'./burrow-presentation':presentation});
const item=(id,slot,price=0,starter=false)=>({stable_id:id,title:id,category:slot==='outfit'?'outfits':'lamps',item_type:slot==='outfit'?'outfit':'decor',
 price,plus_only:false,tradable:true,tags:[],asset:{},metadata:{slot,starter}});
function harness({paid=false,outfit=false,plus=false,manual=false,decode=false}={}){
 const h=hooks(),confirmation=require('./coin-purchase-test-mock.cjs')({manual}),frames=[],events=[],queued=[],warm=[],navigation=[];
 const initial=item('default-lamp','lamp',0,true),defaults=item('default-outfit','outfit',0,true),selected=item('selected',outfit?'outfit':'lamp',paid?100:0);
 selected.plus_only=plus;
 let data={profile:{id:'me'},partner:null,pairVersion:null,catalog:[initial,defaults,selected],wallet:{balance:1000,version:1},
  inventory:[initial,defaults,...(paid?[]:[selected])].map(i=>({owner_id:'me',item_id:i.stable_id})),loadouts:[],roomPhotos:[]};
 const gate=deferred();if(!decode)gate.resolve();
 const handoff=load('apps/mobile/src/lib/home-design-handoff.ts',{}, {requestAnimationFrame:fn=>frames.push(fn),cancelAnimationFrame(){},setTimeout(){return 1;},clearTimeout(){}});
 handoff.retainHomeDesignHost();
 const enqueue=(ids,purchased,name,total)=>{events.push('durable-intent');queued.push({ids,purchased,name,total});data=design.withRoomDesign(data,ids,purchased);events.push('home-updated');};
 const api=load('apps/mobile/src/components/burrow/burrow-shop.tsx',{
  '@/lib/page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
  ...confirmation.imports,react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  '@/lib/home-design-handoff':handoff,
  'react-native':{FlatList:'List',ScrollView:'Rail',Image:'NativeImage',Pressable:'Pressable',Text:'Text',View:'View',Alert:{alert(){}},
   StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})},
  'expo-router':{router:{}},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/retained-tab-navigation':{dismissToRetainedTab:()=>{events.push('reveal-home');navigation.push(design.roomDesignIds(data));}},
  '@/lib/home-art-preparation':{prepareHomeArt:snapshot=>{warm.push(design.roomDesignIds(snapshot));return gate.promise;}},
  '@/lib/room-edit-design':design,'@/lib/burrow-presentation':presentation,
  '@/lib/burrow-store':{enqueueBurrowRoomEdit:enqueue},'@/lib/app-major-update-api':{purchaseCatalogItem:()=>{throw Error('must not use split purchase/equip');}},
  '@/lib/burrow-shop-categories':{BURROW_SHOP_CATEGORIES:['outfits','lamps'],burrowShopCategoryName:x=>x},
  '@/lib/burrow-collection-options':load('apps/mobile/src/lib/burrow-collection-options.ts'),
  '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{common:1},burrowArtForItem:()=>({source:1,width:500,height:500,bounds:[0,0,500,500]})},
  '@/lib/burrow-shop-paging':load('apps/mobile/src/lib/burrow-shop-paging.ts'),
  '@/lib/burrow-shop-thumbnails':{createShopThumbnailWarmer:()=>({warm(){},cancel(){}})},
  './burrow-image':{Image:'Image'},'./coin-ui':{CoinLabel:'CoinLabel'},'./burrow-back-button':{},
  './home-art-preview':{HomeArtPreview:'Preview'},'./shop-category-icon':{},'./shop-item-price':{},
  '@/lib/room-photo-crop':{},'@/lib/burrow-shop-icons':{},'@/lib/insufficient-coins':{},
 },{requestAnimationFrame:fn=>frames.push(fn)});
 const props={section:'decorate',initialCategory:outfit?'outfits':'lamps',away:true};
 const render=(overrides={})=>nodes(h.render(()=>api.BurrowShop({data,...props,...overrides})));
 const choose=()=>{const list=render().find(n=>n.type===api.DecorationOptions);list.props.onSelect(selected);render();};
 const act=()=>{const all=render();return paid?all.find(n=>n.props?.onPress&&n.props.children?.props?.children==='Pay').props.onPress()
  :all.find(n=>n.props?.children?.props?.children==='Replace').props.onPress();};
 return {h,api,render,choose,act,confirmation,frames,events,queued,warm,navigation,gate,data:()=>data,selected,initial,defaults};
}
test('equipped design is disabled In use; another owned design enables Replace; reselecting equipped disables it again',()=>{
 for(const outfit of [false,true]){
  const h=harness({outfit});
  const button=label=>h.render().find(n=>n.props?.children?.props?.children===label);
  assert.equal(button('In use').props.disabled,true);button('In use').props.onPress();assert.equal(h.queued.length,0);
  h.choose();assert.equal(button('Replace').props.disabled,false);
  h.render().find(n=>n.type===h.api.DecorationOptions).props.onSelect(outfit?h.defaults:h.initial);
  assert.equal(button('In use').props.disabled,true);assert.equal(button('Replace'),undefined);h.h.unmount();
 }
});
for(const outfit of [false,true])for(const paid of [false,true])test(`${outfit?'Outfit':'Furniture'} ${paid?'Purchase':'Done'} applies before returning, without a network receipt or premature success`,async()=>{
 const h=harness({outfit,paid});h.choose();h.act();await flush();
 assert.equal(h.queued.length,1);assert.equal(h.navigation.length,0);
 assert.equal(design.roomDesignIds(h.data())[outfit?'outfit':'lamp'],'selected');
 assert.equal(h.confirmation.successes.length,0,'only a server receipt may show Purchased');
 assert.equal(h.queued[0].total,paid?100:0);assert.equal(h.confirmation.offers.length,paid?1:0);
 assert.deepEqual(h.events,['durable-intent','home-updated']);
 h.frames.shift()();h.frames.shift()();await flush();
 assert.equal(h.navigation[0][outfit?'outfit':'lamp'],'selected');assert.equal(h.events.at(-1),'reveal-home');h.h.unmount();
});
test('cancelled Purchase never queues, updates Home, or navigates',async()=>{
 const h=harness({paid:true,manual:true});h.choose();h.act();await flush();assert.equal(h.confirmation.offers.length,1);
 h.confirmation.approval.resolve(false);await flush();assert.equal(h.queued.length,0);assert.equal(h.navigation.length,0);h.h.unmount();
});
test('preview does not prepare the live Home; double apply taps while commit decode is pending cannot queue twice',async()=>{
 const h=harness({paid:true,decode:true});h.choose();assert.equal(h.warm.length,0,'selection must not prepare Home/Skia/photos');
 h.act();h.act();await flush();assert.equal(h.confirmation.offers.length,1);assert.equal(h.queued.length,0);
 assert.equal(h.warm.at(-1).lamp,'selected','only the explicit apply path prepares the committed Home');
 h.gate.resolve();await flush();assert.equal(h.queued.length,1);h.frames.shift()();h.frames.shift()();await flush();assert.equal(h.navigation.length,1);h.h.unmount();
});
test('a Plus-only outfit already owned remains equippable by a Free user through the unified room path',async()=>{
 const h=harness({outfit:true,plus:true});h.choose();h.act();await flush();assert.equal(h.queued.length,1);assert.equal(h.queued[0].total,0);h.h.unmount();
});
test('projection rollback removes only synthetic inventory and preserves partner outfit / shelf gift',()=>{
 const initial=item('lamp','lamp',0,true),defaults=item('default','outfit',0,true),gift={stable_id:'gift',item_type:'souvenir',tags:['adventure_v2_gift'],metadata:{}};
 const data={profile:{id:'A'},partner:{id:'B'},catalog:[initial,defaults,gift],inventory:[],
  loadouts:[{room_type:'home',owner_id:'B',slot:'outfit',item_id:'partner-outfit'}],adventureCollection:{displays:[{user_id:'A',gift_id:'gift'}]}};
 const pending=design.withRoomDesign(data,{lamp:'new',outfit:'default'},['new']);assert.ok(pending.inventory.some(r=>r.item_id==='new'));
 const restored=design.withRoomDesign(pending,{lamp:'lamp',outfit:'default'});assert.equal(restored.inventory.length,0);
 assert.equal(restored.loadouts.find(r=>r.owner_id==='B').item_id,'partner-outfit');
 assert.equal(presentation.roomSlots(restored,'A').shelf_decor,gift);
});
