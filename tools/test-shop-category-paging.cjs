const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/burrow-shop-paging.ts');
const edge=load('apps/mobile/src/lib/page-edge-gesture.ts');
const categories=['wallpapers','outfits','cushions','tables','dresser_plants'];
const jsx=(type,props,key)=>({type,props,key});
function harness(asset) {
  const h=hooks(),nativeScrolls=[],changes=[];
  let selected='wallpapers',width=390,selectionRevision=0;
  const imports={...require('./coin-purchase-test-mock.cjs')().imports,react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{FlatList:'List',ScrollView:'Rail',Image:'NativeImage',Pressable:'Button',Text:'Text',View:'View',
      StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width,height:844})},
    './burrow-image':{Image:'Image'},'./coin-ui':{CoinLabel:'CoinLabel'},'expo-router':{router:{}},
    '@/lib/retained-tab-navigation':{},'react-native-safe-area-context':{},
    '@/lib/burrow-shop-categories':{BURROW_SHOP_CATEGORIES:categories,burrowShopCategoryName:x=>x},
    '@/lib/app-major-update-api':{},'@/lib/burrow-store':{},'@/lib/burrow-presentation':{},
    '@/lib/burrow-collection-options':{},'@/lib/burrow-art-assets':{burrowArtForItem:()=>asset},'@/lib/room-photo-crop':{},
    '@/lib/burrow-shop-icons':{},'./burrow-back-button':{},'./outfit-bunny':{},'./home-art-preview':{},
    './shop-category-icon':{ShopCategoryIcon:'CategoryIcon'},'@/lib/burrow-shop-paging':model,'@/lib/page-edge-gesture':edge};
  imports['@/lib/burrow-shop-thumbnails']={createShopThumbnailWarmer:()=>({warm(){},cancel(){}})};
  imports['./shop-item-price']={ShopItemPrice:'ShopItemPrice'};
  imports['@/lib/insufficient-coins']={showInsufficientCoins(){}};
  const components=load('apps/mobile/src/components/burrow/burrow-shop.tsx',imports);
  const pages=Object.fromEntries(categories.map(cat=>[cat,[]]));
  const props=()=>({selected,selectionRevision,width,pages,owned:new Set(),mine:new Set(),partnerOwned:new Set(),giftMode:false,hasPlus:false,partnerName:'Alex',onOpen(){},
    onChange:next=>{changes.push(next);selected=next;}});
  let node;
  const render=()=>{
    node=h.render(()=>components.ShopCategoryPager(props()));
    node.props.ref.current={scrollToOffset:value=>nativeScrolls.push(value)};return node;
  };
  return {h,components,pages,render,nativeScrolls,changes,select:next=>{selected=next;selectionRevision++;},resize:next=>{width=next;},selected:()=>selected};
}
test('shop uses a native bounded pager with warm adjacent grids and no network or per-frame category state',()=>{
  const h=harness(),pager=h.render();
  assert.equal(pager.type,'List');assert.equal(pager.props.horizontal,true);assert.equal(pager.props.pagingEnabled,true);
  assert.equal(pager.props.bounces,false);assert.equal(pager.props.windowSize,3);assert.equal(pager.props.initialNumToRender,3);
  assert.equal(pager.props.contentContainerStyle.height,'100%','nested vertical grids have a bounded viewport');
  assert.equal(pager.props.directionalLockEnabled,true);assert.equal(pager.props.nestedScrollEnabled,true);
  assert.equal(pager.props.scrollEventThrottle,16,'scroll positions update refs, never React state');
  assert.deepEqual(JSON.parse(JSON.stringify(pager.props.getItemLayout(null,2))),{length:390,offset:780,index:2});
  const page=pager.props.renderItem({item:'outfits'});
  assert.equal(page.props.items,h.pages.outfits);assert.equal(page.props.category,'outfits');assert.equal(page.props.width,390);
  h.h.unmount();
});
test('swipes retain native paging; distant tab taps jump directly and rotation never animates',()=>{
  const h=harness();let pager=h.render();
  pager.props.onScrollBeginDrag(event(0));pager.props.onScrollEndDrag(event(200,1));
  pager.props.onScroll(event(390));pager.props.onMomentumScrollEnd(event(390));pager=h.render();
  assert.equal(h.selected(),'outfits');assert.deepEqual(h.changes,['outfits']);assert.equal(h.nativeScrolls.length,0);
  h.select('tables');h.render();assert.deepEqual(JSON.parse(JSON.stringify(h.nativeScrolls[0])),{offset:1170,animated:false});
  pager=h.render();pager.props.onMomentumScrollEnd({nativeEvent:{contentOffset:{x:1170}}});h.render();
  assert.deepEqual(h.changes,['outfits'],'settling a tapped category does not select it again');
  h.resize(430);h.render();assert.deepEqual(JSON.parse(JSON.stringify(h.nativeScrolls.at(-1))),{offset:1290,animated:false});h.h.unmount();
});
test('edge-back guard is a native sibling above rail/pager, not another competing scroll recognizer',()=>{
  const h=harness(),rail={type:'Rail'},pager={type:'List'};
  const browser=h.components.ShopCategoryBrowser({children:[rail,pager]});
  assert.equal(browser.props.style.flex,1);assert.deepEqual(browser.props.children[0],[rail,pager]);
  const guard=browser.props.children[1];assert.equal(guard.type,'View');assert.equal(guard.props.collapsable,false);
  assert.equal(guard.props.pointerEvents,'auto');assert.equal(guard.props.style.left,0);
  assert.equal(guard.props.style.width,edge.LEFT_EDGE_BACK_WIDTH);assert.equal(guard.props.style.zIndex,2);
  assert.equal(guard.props.children,undefined,'edge touch targets no native pager or rail ancestor');
  assert.equal(guard.props.onStartShouldSetResponder,undefined,'back recognition stays with existing outer navigation');h.h.unmount();
});
test('adjacent tab taps keep short animation; distant jump rejects old scroll updates and leaves no selection lock',()=>{
  const h=harness();h.render();h.select('outfits');let pager=h.render();assert.equal(h.nativeScrolls.at(-1).animated,true);
  h.select('dresser_plants');pager=h.render();assert.equal(h.nativeScrolls.at(-1).animated,false);
  pager.props.onScroll(event(390));pager.props.onMomentumScrollEnd(event(390));h.render();
  h.select('tables');pager=h.render();assert.equal(h.nativeScrolls.at(-1).animated,true,'stale offset must not turn an adjacent tap into a long jump');
  pager.props.onScrollBeginDrag(event(1170));pager.props.onScrollEndDrag(event(780,1));
  pager.props.onScroll(event(780));pager.props.onMomentumScrollEnd(event(780));h.render();
  assert.equal(h.selected(),'cushions');h.h.unmount();
});
test('category rail scrolling stays independent and selected icons track pager commits',()=>{
  let selected='wallpapers';
  // CategoryRail uses its own hooks, so load its component with a fresh hook scope.
  const isolated=harness();let rail=isolated.h.render(()=>isolated.components.CategoryRail({selected,onChange:next=>{selected=next;}}));
  assert.equal(rail.type,'Rail');assert.equal(rail.props.horizontal,true);
  assert.equal(rail.props.onScroll,undefined);assert.equal(rail.props.bounces,false);
  rail.props.children[1].props.onPress();assert.equal(selected,'outfits');
  rail=isolated.h.render(()=>isolated.components.CategoryRail({selected,onChange(){}}));
  assert.equal(rail.props.children[1].props.accessibilityState.selected,true);isolated.h.unmount();
});
function event(x,velocity=0,timeStamp=0,target=x){return{timeStamp,nativeEvent:{contentOffset:{x},velocity:{x:velocity},targetContentOffset:{x:target}}};}

test('rapid category taps ignore every interrupted animation completion, including reverse-to-origin',()=>{
 const h=harness();let pager=h.render();
 h.select('tables');pager=h.render();h.select('dresser_plants');pager=h.render();
 pager.props.onMomentumScrollEnd(event(1170));pager=h.render();
 assert.equal(h.selected(),'dresser_plants');assert.deepEqual(h.changes,[]);
 h.select('wallpapers');pager=h.render();
 assert.equal(h.nativeScrolls.at(-1).offset,0,'reverse request cancels pending scroll even when observed offset is still zero');
 pager.props.onMomentumScrollEnd(event(1560));pager=h.render();
 pager.props.onScroll(event(0));pager.props.onMomentumScrollEnd(event(0));pager=h.render();
 pager.props.onMomentumScrollEnd(event(1170));h.render();
 assert.equal(h.selected(),'wallpapers');assert.deepEqual(h.changes,[]);h.h.unmount();
});
test('a tab tap takes ownership from a fast fling; a new gesture may interrupt a tab animation',()=>{
 const h=harness();let pager=h.render();
 pager.props.onScrollBeginDrag(event(0,0,100));pager.props.onScrollEndDrag(event(200,2,110,1170));
 h.select('dresser_plants');pager=h.render();
 pager.props.onScroll(event(1170,0,120));pager.props.onMomentumScrollEnd(event(1170,0,121));h.render();
 assert.equal(h.selected(),'dresser_plants');assert.deepEqual(h.changes,[]);
 pager.props.onScrollBeginDrag(event(1200,0,130));pager.props.onMomentumScrollEnd(event(1560,0,125));
 pager.props.onScrollEndDrag(event(900,-1,140,780));pager.props.onScroll(event(780,0,150));
 pager.props.onMomentumScrollEnd(event(780,0,151));pager=h.render();
 assert.equal(h.selected(),'cushions');assert.deepEqual(h.changes,['cushions']);
 assert.equal(h.nativeScrolls.length,1,'gesture settlement does not cause a second programmatic scroll');h.h.unmount();
});
test('tapping the already-selected category cancels an in-flight gesture instead of silently ignoring the tap',()=>{
 const h=harness();let pager=h.render();
 pager.props.onScrollBeginDrag(event(0,0,100));pager.props.onScrollEndDrag(event(200,2,110,780));
 h.select('wallpapers');pager=h.render();
 assert.equal(h.nativeScrolls.at(-1).offset,0);
 pager.props.onScroll(event(780,0,120));pager.props.onMomentumScrollEnd(event(780,0,121));h.render();
 assert.equal(h.selected(),'wallpapers');assert.deepEqual(h.changes,[]);h.h.unmount();
});
test('fast bidirectional swipes, stationary releases and delayed events cannot oscillate selection',()=>{
 const h=harness();let pager=h.render();let time=100;
 for(const x of [390,1560,780,1170,0,390,0]){
  pager.props.onScrollBeginDrag(event(0,0,time++));pager.props.onScrollEndDrag(event(x,1,time++,x));
  pager.props.onScroll(event(x,0,time++));pager.props.onMomentumScrollEnd(event(x,0,time++));pager=h.render();
  assert.equal(h.selected(),categories[x/390]);
  pager.props.onMomentumScrollEnd(event(1560,0,time-10));pager=h.render();
  assert.equal(h.selected(),categories[x/390]);
 }
 const count=h.changes.length;
 pager.props.onScrollBeginDrag(event(0,0,time++));pager.props.onScrollEndDrag(event(0,0,time++));
 pager.props.onMomentumScrollEnd(event(390,0,time++));h.render();
 assert.equal(h.selected(),'wallpapers');assert.equal(h.changes.length,count);h.h.unmount();
});
test('category rail uses its measured viewport, clamps both ends and does not fight manual browsing',()=>{
 const h=harness(),scrolls=[];let selected='wallpapers';
 const render=()=>{
  const node=h.h.render(()=>h.components.CategoryRail({selected,onChange:next=>{selected=next;}}));
  node.props.ref.current={scrollTo:value=>scrolls.push(value)};return node;
 };
 let rail=render();rail.props.onLayout({nativeEvent:{layout:{width:200}}});
 selected='dresser_plants';rail=render();assert.equal(scrolls.at(-1).x,128);
 rail.props.onScrollBeginDrag();selected='outfits';rail=render();assert.equal(scrolls.at(-1).x,128);
 rail.props.onMomentumScrollEnd();rail.props.children[0].props.onPress();rail=render();
 assert.equal(scrolls.at(-1).x,0);h.h.unmount();
});
test('each category keeps its existing vertical three-column product list and preview tap behavior',()=>{
  const h=harness(),pager=h.render(),page=pager.props.renderItem({item:'outfits'}),opened=[];
  const item={stable_id:'outfit-1',title:'Cherry Gingham',category:'outfits',price:300,metadata:{}};
  const tree=page.type({...page.props,items:[item],onOpen:next=>opened.push(next)});
  assert.equal(tree.props.style.width,390);
  assert.equal(tree.props.style.height,'100%');
  const list=tree.props.children;
  assert.equal(list.props.numColumns,3);assert.equal(list.props.nestedScrollEnabled,true);
  assert.equal(list.props.horizontal,undefined);assert.equal(list.props.directionalLockEnabled,true);
  const card=list.props.renderItem({item});card.props.onPress();
  assert.equal(opened[0].kind,'item');assert.equal(opened[0].item,item);h.h.unmount();
});
test('Shop product headings omit the generic tagline while keeping the gift-recipient context',()=>{
 const h=harness(),page=h.render().props.renderItem({item:'outfits'});
 const heading=giftMode=>page.type({...page.props,giftMode}).props.children.props.ListHeaderComponent.props.children;
 assert.equal(heading(false)[1],false);assert.equal(heading(true)[1].props.children,'Choosing a gift for Alex.');h.h.unmount();
});
test('page indices and edge ownership cannot wrap, drift on rotation, or turn center swipes into exits',()=>{
  for(const [x,width,n,index] of [[0,390,5,0],[390,390,5,1],[780,390,5,2],[-200,390,5,0],[9999,390,5,4],[1290,430,5,3]])
    assert.equal(model.shopPageIndex(x,width,n),index);
  assert.equal(model.shopPageIndex(NaN,390,5),0);assert.equal(model.shopPageIndex(300,0,5),0);
  assert.equal(edge.shouldStartEdgeBack(160,120,0),false);assert.equal(edge.shouldStartEdgeBack(10,120,0),true);
});
test('Shop Toy thumbnails contain the untouched full canvas rather than filling each silhouette',()=>{
 for(const bounds of [[100,10,400,512],[40,10,470,512],[180,90,320,470]]){
  const h=harness({source:1,width:512,height:512,bounds});const pager=h.render();
  const page=pager.props.renderItem({item:'outfits'}),item={stable_id:'toy',category:'couple_dolls',metadata:{},title:'Toy'};
  const list=page.type({...page.props,items:[item]}).props.children;
  const card=list.props.renderItem({item}),artwork=card.props.children[0],image=artwork.type(artwork.props);
  assert.equal(image.type,'Image');assert.equal(image.props.contentFit,'contain');
  assert.equal(image.props.style.width,image.props.style.height);assert.equal(image.props.style.position,undefined);h.h.unmount();
 }
});
