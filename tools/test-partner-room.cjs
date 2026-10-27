const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const plain=v=>JSON.parse(JSON.stringify(v));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'
  ?[tree,...nodes(tree.props?.children),...(tree.type==='FlatList'?nodes(tree.props.data.map(item=>tree.props.renderItem({item}))):[])]:[];
const native={View:'View',Text:'Text',Pressable:'Pressable',ActivityIndicator:'Spinner',FlatList:'FlatList',ScrollView:'ScrollView',Image:'NativeImage',
  StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:390,height:844})};
const toy={stable_id:'toy',metadata:{slot:'couple_doll'},category:'couple_dolls'};
function snapshot(){return {profile:{id:'me'},partner:{id:'partner',display_name:'Irina'},pairVersion:'one',wallet:{balance:1000},
  roomPhotos:[{id:'partner-face',ownerId:'partner',toyId:'toy',kind:'doll'}],inventory:[],hasPlus:false,
  catalog:[],loadouts:[],moments:[],partnerAdventure:null};}
function partnerHarness(){
  const h=hooks(),paths=[],toasts=[];let data=snapshot(),focus=()=>{};
  const {PartnerRoomScreen}=load('apps/mobile/src/components/burrow/partner-room-screen.tsx',{
    '@/lib/burrow-page-entry':{openPreparedBurrow:r=>paths.push(r)},
    '@/lib/partner-pairing':{showPartnerPairing(){}},
    '@/lib/burrow-toast':{showBurrowToast:message=>toasts.push(message)},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
    'expo-router':{router:{back:()=>paths.push('back'),push:path=>paths.push(path)},useFocusEffect:callback=>{focus=callback;h.react.useEffect(()=>{callback();},[callback]);}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
    '@/lib/burrow-store':{useBurrow:()=>({data,loading:false,busy:false})},
    '@/lib/burrow-presentation':{roomSlots:(_data,owner)=>({couple_doll:toy,owner}),adventureIsAway:()=>false},
    '@/lib/burrow-art-assets':{burrowArtForItem:()=>({source:1})},
    './home-art-scene':{HomeArtScene:'Scene'},'./room-photo':{RoomPhotoEditor:'PhotoEditor'},
    './burrow-back-button':{BurrowBackButton:'Back'},
    '@/lib/burrow-care-cooldown':load('apps/mobile/src/lib/burrow-care-cooldown.ts'),
    './care-status-dialog':{CareStatusDialog:'CareStatus'},
  },{Date});
  const render=()=>h.render(PartnerRoomScreen);render();render();
  return {render,paths,toasts,resume:()=>focus(),data:()=>data,setData:value=>{data=value;render();render();},h,
    scene:()=>nodes(render()).find(n=>n.type==='Scene').props};
}
test('Partner Room uses the actual partner owner/photos and carries safe gift/care targets',()=>{
  const h=partnerHarness(),scene=h.scene();
  assert.equal(scene.ownerId,'partner');assert.equal(scene.slots.owner,'partner');assert.equal(scene.partnerRoom.name,'Irina');
  scene.partnerRoom.onBack();scene.partnerRoom.onGift();scene.partnerRoom.onSurprise();
  scene.onSlot('bunny');h.resume();scene.onSlot('vase');
  assert.deepEqual(plain(h.paths),['back',{pathname:'/(main)/burrow-detail',params:{section:'shop',giftTo:'partner',giftFrom:'me'}},
    '/(main)/surprise-room',{pathname:'/(main)/room-interaction',params:{kind:'food',ownerId:'partner',actorId:'me',pairVersion:'one'}},
    {pathname:'/(main)/room-interaction',params:{kind:'water',ownerId:'partner',actorId:'me',pairVersion:'one'}}]);
  h.resume();scene.onToyInteract();scene.onToyInteract();
  assert.deepEqual(plain(h.paths.at(-1)),{pathname:'/(main)/room-interaction',params:{kind:'toy',ownerId:'partner',actorId:'me',pairVersion:'one'}});
  assert.equal(h.paths.length,6,'duplicate taps cannot push two toy pages');
  h.setData({...h.data(),partner:{id:'new',display_name:'New'},pairVersion:'two'});
  assert.equal(nodes(h.render()).some(n=>n.type==='PhotoEditor'),false);
  h.setData({...h.data(),partner:null});assert.equal(nodes(h.render()).some(n=>n.type==='Scene'),false);h.h.unmount();
});
test('already cared-for partner items show a toast without navigating or another care request',()=>{
  for(const [kind,slot] of [['food','bunny'],['water','vase']]) {
    const h=partnerHarness();
    h.setData({...h.data(),partnerLastCareAt:{[kind]:new Date().toISOString()}});
    h.scene().onSlot(slot);
    assert.equal(h.paths.length,0);
    assert.deepEqual(h.toasts,[kind==='food'?"Irina's bunny is full and happy.":"Irina's flower is fresh and growing."]);
    assert.equal(nodes(h.render()).some(n=>n.type==='CareStatus'),false);
    h.h.unmount();
  }
});
test('Partner art exposes only rabbit, plant, toy and gift shortcuts; Home controls remain separate',()=>{
  const h=hooks(),layout=load('apps/mobile/src/lib/burrow-home-layout.ts'),calls=[];
  const asset={source:1,width:500,height:500,bounds:[0,0,500,500]};
  const {HomeArtScene}=load('apps/mobile/src/components/burrow/home-art-scene.tsx',{
    ...require('./home-pull-test-mocks.cjs'),
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    './coin-ui':{CoinIcon:'CoinIcon',CoinLabel:'Text'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'@expo/vector-icons':{Feather:'Icon'},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},'expo-status-bar':{StatusBar:'StatusBar'},
    ...require('./burrow-attention-test-mocks.cjs'),
    './burrow-image':{Image:'Image'},'./room-photo':{RoomPhoto:'Photo'},'./interactive-doll':{InteractiveDoll:'Doll'},
    './doll-photo-preview':{DollPhotoPreview:'PhotoPreview'},
    '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season:'autumn',period:'day'})},
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'PhotoPlaceholder' },
    '@/lib/burrow-toy-photos':load('apps/mobile/src/lib/burrow-toy-photos.ts'),
    '@/lib/burrow-doll-face':{dollFaceRect:()=>({}),framePhotoRect:()=>({})},
    '@/lib/burrow-art-assets':{HOME_BACKGROUND_FLOOR:asset,HOME_WINDOW_LANDSCAPES:{autumn:{day:1,night:2}},BURROW_FIXED_ART:{bunny:asset,letter:asset},burrowArtFor:()=>asset,burrowArtForItem:()=>asset},
    '@/lib/burrow-home-layout':layout,
  });
  const props={balance:10,slots:{couple_doll:toy},ownerId:'partner',onSlot:s=>calls.push(s),onToyInteract:()=>calls.push('photo'),
    partnerRoom:{name:'Irina',onBack(){},onGift(){},onSurprise(){}}};
  const tree=nodes(h.render(()=>HomeArtScene(props)));
  assert.ok(tree.some(n=>n.type==='Text'&&[n.props?.children].flat().join('')==='Irina’s Room'));
  for(const forbidden of ['Open menu','Write a love letter','Explore our burrows','Decorate my burrow','Choose music','Open room photo'])
    assert.equal(tree.some(n=>n.props?.accessibilityLabel===forbidden),false,forbidden);
  tree.find(n=>n.props?.accessibilityLabel==='Feed bunny').props.onPress();
  tree.find(n=>n.props?.accessibilityLabel==='Water partner’s flowers').props.onPress();
  assert.deepEqual(calls,['bunny','vase']);
  assert.equal(tree.some(n=>n.type==='Doll'),false);
  tree.find(n=>n.type==='PhotoPreview').props.onEditPhoto();assert.equal(calls.at(-1),'photo');
  const awayTree=nodes(h.render(()=>HomeArtScene({...props,away:true})));
  assert.equal(awayTree.some(n=>['Feed bunny','Open adventure'].includes(n.props?.accessibilityLabel)),false);
  const ownProps={...props,ownerId:'me',partnerRoom:undefined,onToyInteract:()=>calls.push('open-toy'),
    onToyPhoto:()=>calls.push('edit-face'),onDecorate:()=>calls.push('decorate'),toyPulse:99};
  const home=nodes(h.render(()=>HomeArtScene(ownProps)));
  assert.equal(home.find(n=>n.type==='HomeLoveLetter').props.count,0,'mail count belongs to the visible artwork, not the larger tap target');
  const unreadHome=nodes(h.render(()=>HomeArtScene({...ownProps,updates:{letter:2,affection:0,adventure:0}})));
  assert.equal(unreadHome.find(n=>n.type==='HomeLoveLetter').props.count,2);
  assert.equal(tree.find(n=>n.type==='HomeLoveLetter').props.count,0,'partner previews never show our private unread count');
  assert.equal(home.some(n=>n.props?.accessibilityLabel==='Decorate my burrow'),false,'cabinet is decorative, not an entry');
  assert.equal(home.some(n=>n.type==='Doll'),false,'Home cannot instantiate toy animation/pan handlers');
  const openToy=home.find(n=>n.props?.accessibilityLabel==='Open Toy');assert.ok(openToy);
  assert.equal(openToy.props.onPressIn,undefined);assert.equal(openToy.props.onLongPress,undefined);
  assert.equal(openToy.props.style.transform,undefined,'no press feedback transform on Home Toy');
  const staticToy=home.find(n=>n.type==='PhotoPreview');assert.ok(staticToy);
  assert.equal(staticToy.props.onEditPhoto,undefined,'the whole Toy opens its page, not a nested face editor');
  calls.length=0;openToy.props.onPress();assert.deepEqual(calls,['open-toy']);
  const rendered=h.render(()=>HomeArtScene(ownProps));
  const room=nodes(rendered).find(n=>n.props?.testID==='home-pull-room').props.children;
  const fresh={...ownProps,balance:900,now:Date.now(),pullToPeekEnabled:true,onSlot:slot=>calls.push('fresh:'+slot)};
  const updated=nodes(h.render(()=>HomeArtScene(fresh)));
  assert.equal(updated.find(n=>n.props?.testID==='home-pull-room').props.children,room,'wallet/focus/clock and new callbacks reuse the exact artwork element tree');
  calls.length=0;nodes(room).find(n=>n.props?.accessibilityLabel==='Feed bunny').props.onPress();assert.deepEqual(calls,['fresh:bunny'],'cached art invokes current permissions/business closure');
  const changed=nodes(h.render(()=>HomeArtScene({...fresh,slots:{...fresh.slots,outfit:{stable_id:'changed'}}})));
  assert.notEqual(changed.find(n=>n.props?.testID==='home-pull-room').props.children,room,'actual furniture/outfit changes must repaint');
  const busyHome=nodes(h.render(()=>HomeArtScene({...ownProps,busy:true})));
  assert.equal(busyHome.find(n=>n.props?.accessibilityLabel==='Open Toy').props.disabled,true);
  const fallbackHome=nodes(h.render(()=>HomeArtScene({...ownProps,onToyInteract:undefined})));
  calls.length=0;fallbackHome.find(n=>n.props?.accessibilityLabel==='Open Toy').props.onPress();assert.deepEqual(calls,['couple_doll']);
  const preview=nodes(h.render(()=>HomeArtScene({...ownProps,previewOnly:true})));
  assert.equal(preview.some(n=>n.props?.accessibilityLabel==='Open Toy'),false,'room previews stay non-interactive');
  // Both Shop product details and Decorate use previewOnly, including while
  // an adventure is ongoing. Outfit swaps must remain visible in that room.
  for(const partnerRoom of [undefined,props.partnerRoom])for(const away of [false,true])for(const previewOnly of [false,true]){
    for(const id of ['current-outfit','preview-outfit']){
      const outfit={stable_id:id,category:'outfits',metadata:{slot:'outfit'}};
      const all=nodes(h.render(()=>HomeArtScene({...ownProps,partnerRoom,away,previewOnly,slots:{...ownProps.slots,outfit}})));
      const wrapper=all.find(n=>n.type==='View'&&n.props.children?.type==='OutfitBunny');
      const hidden=away&&!previewOnly;
      assert.equal(wrapper.props.style.at(-1).opacity,hidden?0:1);
      assert.equal(wrapper.props.accessibilityElementsHidden,hidden);
      assert.equal(wrapper.props.importantForAccessibility,hidden?'no-hide-descendants':'auto');
      assert.equal(wrapper.props.children.props.outfit,outfit,'render the currently selected outfit, not the saved/default outfit');
      assert.equal(wrapper.props.children.props.animated,!previewOnly&&!partnerRoom,'previews stay lightweight and static');
      assert.equal(wrapper.props.children.props.active,!hidden);
    }
  }
  for(const size of [{width:320,height:568},{width:900,height:1600},{width:900,height:1950}]){
    const math=layout.homeArtLayout(size.width,size.height,0);
    assert.ok(math.cropTop<=layout.HOME_MAX_TOP_CROP*math.scale+.001);
    assert.ok(math.artWidth<=size.width+.001);
  }
  h.unmount();
  const route=fs.readFileSync('apps/mobile/app/(main)/_layout.tsx','utf8');
  assert.match(route,/screenOptions=\{MAIN_CARD_OPTIONS\}/);
  assert.match(fs.readFileSync('apps/mobile/src/lib/main-navigation-options.ts','utf8'),/fullScreenGestureEnabled: false/);
});
test('Home menu and coins share a lowered screen header below the safe area on notch and non-notch phones',()=>{
  for(const device of [{width:320,height:568,top:0,bottom:0},{width:390,height:844,top:47,bottom:34},
    {width:430,height:932,top:59,bottom:34},{width:360,height:800,top:24,bottom:0}]){
    const h=hooks(),layout=load('apps/mobile/src/lib/burrow-home-layout.ts'),calls=[];
    const asset={source:1,width:500,height:500,bounds:[0,0,500,500]};
    const {HomeArtScene}=load('apps/mobile/src/components/burrow/home-art-scene.tsx',{
      ...require('./home-pull-test-mocks.cjs'),
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
      './coin-ui':{CoinIcon:'CoinIcon',CoinLabel:'Text'},
      react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{...native,useWindowDimensions:()=>device},
      '@expo/vector-icons':{Feather:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>device},
      ...require('./burrow-attention-test-mocks.cjs'),
      'expo-status-bar':{StatusBar:'StatusBar'},'./burrow-image':{Image:'Image'},'./room-photo':{RoomPhoto:'Photo'},
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'PhotoPlaceholder' },
      './interactive-doll':{InteractiveDoll:'Doll'},'@/lib/burrow-toy-photos':load('apps/mobile/src/lib/burrow-toy-photos.ts'),
      './doll-photo-preview':{DollPhotoPreview:'PhotoPreview'},
      '@/lib/use-burrow-environment':{useBurrowEnvironment:()=>({season:'autumn',period:'day'})},
      '@/lib/burrow-doll-face':{dollFaceRect:()=>({}),framePhotoRect:()=>({})},
      '@/lib/burrow-art-assets':{HOME_BACKGROUND_FLOOR:asset,HOME_WINDOW_LANDSCAPES:{autumn:{day:1,night:2}},BURROW_FIXED_ART:{bunny:asset,letter:asset},burrowArtFor:()=>asset,burrowArtForItem:()=>asset},
      '@/lib/burrow-home-layout':layout,
    });
    const props={balance:10,slots:{},ownerId:'me',onMenu:()=>calls.push('menu'),onCarrots:()=>calls.push('coins'),onSlot(){},
      onAffection:()=>calls.push('affection'),onAdventure:()=>calls.push('adventure')};
    const all=nodes(h.render(()=>HomeArtScene(props)));
    const header=all.find(n=>n.type==='View'&&Array.isArray(n.props.children)
      &&n.props.children.some(child=>child?.props?.accessibilityLabel==='Open menu'));
    assert.ok(header);
    const style=Object.assign({},...header.props.style);
    assert.equal(style.top,device.top+16);
    assert.equal(style.alignItems,'center');
    all.find(n=>n.props?.accessibilityLabel==='Open menu').props.onPress();
    all.find(n=>n.type==='CoinWallet'&&n.props.balance===10).props.onPress();
    assert.deepEqual(calls,['menu','coins']);
    for(const name of ['Affection','Adventure']){
      const button=all.find(n=>n.props?.accessibilityLabel===name);
      const released=Object.assign({},...button.props.style({pressed:false}).filter(Boolean));
      const pressed=Object.assign({},...button.props.style({pressed:true}).filter(Boolean));
      assert.deepEqual(plain(pressed.transform),[{translateY:3},{scale:.98}]);
      assert.equal(pressed.shadowOpacity,0);assert.equal(pressed.elevation,0);
      assert.equal(released.shadowOpacity,1);assert.equal(released.elevation,3);
      assert.notEqual(pressed.backgroundColor,released.backgroundColor);
      button.props.onPress();
    }
    assert.deepEqual(calls,['menu','coins','affection','adventure']);
    const offline=nodes(h.render(()=>HomeArtScene({...props,balance:null})));
    assert.ok(offline.some(n=>n.type==='CoinWallet'&&n.props.balance===null));
    assert.ok(offline.some(n=>n.type==='Image'),'bundled room renders without a snapshot');
    assert.equal(offline.some(n=>n.type==='Spinner'),false);
    h.unmount();
  }
});
test('Home always paints a room beneath the bounded entry gate rather than a second loading screen',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const home=source.slice(source.indexOf("{section==='home'?<View"),source.indexOf(":<>{section!=='burrow'",source.indexOf("{section==='home'?<View")));
  assert.match(home,/<HomeArtScene/);assert.match(home,/balance=\{data\?\.wallet.balance\?\?null\}/);
  assert.doesNotMatch(home,/ActivityIndicator|s.loading/);
  assert.doesNotMatch(home,/onDecorate=/,'Home cannot pass a cabinet-to-decoration shortcut');
  const scene=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');
  assert.doesNotMatch(scene,/InteractiveDoll|onPressIn|onLongPress|PanResponder/);
  const interaction=fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx','utf8');
  assert.match(interaction,/<InteractiveDoll/);assert.match(interaction,/showActions=\{!!toyPhoto\}/);
  const controls=fs.readFileSync('apps/mobile/src/components/burrow/squishy-toy-controls.tsx','utf8');
  assert.match(controls,/<Action kind="squeeze"/);assert.match(controls,/<Action kind="punch"/);
});
function shopHarness(gift=true){
  const checkout=require('./coin-purchase-test-mock.cjs')({manual:true});
  const h=hooks(),alerts=[],paths=[],writes=[],calls=[];let data=snapshot(),error=null,enqueueError=null;
  const paid={stable_id:'wall',title:'New wallpaper',category:'wallpapers',item_type:'decor',tradable:true,price:120,metadata:{slot:'wallpaper'}};
  data.catalog=[paid,{...paid,stable_id:'private',tradable:false},{...paid,stable_id:'starter',price:0,metadata:{slot:'wallpaper',starter:true}}];
  data.inventory=[{owner_id:'me',item_id:'starter'}];
  const {BurrowShop}=load('apps/mobile/src/components/burrow/burrow-shop.tsx',{
    '@/lib/page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
    ...checkout.imports,
    '@/lib/insufficient-coins':{showInsufficientCoins:()=>paths.push('/(main)/insufficient-coins')},
    '@/lib/retained-tab-navigation':{dismissToRetainedTab:()=>{}},
    './coin-ui':{CoinIcon:'CoinIcon',CoinLabel:'Text'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{...native,Alert:{alert:(...args)=>alerts.push(args)}},
    './burrow-image':{Image:'Image'},'expo-router':{router:{push:path=>paths.push(path),navigate:path=>paths.push(path),back:()=>paths.push('back')}},
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'PhotoPlaceholder' },
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
    '@/lib/burrow-shop-categories':load('apps/mobile/src/lib/burrow-shop-categories.ts',{'@novame/domain':{BURROW_DECOR_SHOP_CATEGORIES:['windows']}}),'@expo/vector-icons':{Feather:'Icon'},
    '@/lib/app-major-update-api':{purchaseCatalogItem:async(...args)=>{calls.push(['legacy-gift',...args]);throw Error('unexpected_direct_purchase');},
      purchaseRoomLoadout:()=>calls.push(['own-room']),saveBunnyOutfit:()=>calls.push(['own-outfit']),saveRoomLoadout:()=>calls.push(['decorate'])},
    '@/lib/burrow-store':{getBurrowSnapshot:()=>({data,error}),refreshBurrow:async()=>{},setBurrowLoadoutLocally:()=>calls.push(['local-room']),
      enqueueBurrowPurchase:(...args)=>{if(enqueueError)throw enqueueError;calls.push(['queued-gift',...args]);writes.push('gift:durable');},
      enqueueBurrowRoomEdit:(...args)=>{calls.push(['queued-room',...args]);writes.push('room-checkout:durable');},
      runBurrowAction:async(op,fn)=>{writes.push(op);try{await fn('key');return true;}catch(e){error=e.message;return false;}}},
    '@/lib/burrow-presentation':{roomSlots:()=>({wallpaper:data.catalog[2]})},
    '@/lib/burrow-collection-options':{decorationOptions:catalog=>catalog},
    './shop-item-price':{ShopItemPrice:'ShopItemPrice'},
    '@/lib/burrow-shop-paging':load('apps/mobile/src/lib/burrow-shop-paging.ts'),
    '@/lib/burrow-shop-thumbnails':{createShopThumbnailWarmer:()=>({warm(){},cancel(){}})},
    '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{home:1},burrowArtForItem:()=>({source:1,bounds:[0,0,100,100],width:100,height:100})},
    '@/lib/room-photo-crop':{FRAME_ART_REFERENCE_BOUNDS:[0,0,100,100]},'@/lib/burrow-shop-icons':{BURROW_SHOP_ICONS:{}},
    './burrow-back-button':{BurrowBackButton:'Back'},'./outfit-bunny':{OutfitBunny:'Bunny'},'./home-art-preview':{HomeArtPreview:'Preview'},
    './shop-category-icon':{ShopCategoryIcon:'CategoryIcon'},
  },{requestAnimationFrame:fn=>fn(),Error});
  const props={section:'shop',initialCategory:'wallpapers',away:false,...(gift?{giftRecipientId:'partner',giftActorId:'me'}:{})};
  const render=(detail=false)=>h.render(()=>BurrowShop({...props,data,initialDetail:detail?{itemId:'wall'}:undefined}));
  return {render,data:()=>data,setData:next=>{data=next;},h,alerts,paths,writes,calls,failEnqueue:error=>{enqueueError=error;},checkout};
}
test('gift shop filters giftable products and propagates recipient through the item detail route',()=>{
  const h=shopHarness(),tree=nodes(h.render()),pager=tree.find(n=>n.props?.pages);
  assert.deepEqual(plain(pager.props.pages.wallpapers.map(item=>item.stable_id)),['wall']);
  pager.props.onOpen({kind:'item',item:pager.props.pages.wallpapers[0]});
  assert.deepEqual(plain(h.paths[0]),{pathname:'/(main)/shop-detail',params:{itemId:'wall',giftTo:'partner',giftFrom:'me'}});h.h.unmount();
});
test('Shop header aligns back, title and wallet in a single flow row with half the old safe-area gap',()=>{
 for(const gift of [false,true]){
  const h=shopHarness(gift),tree=nodes(h.render()),title=tree.find(n=>n.type==='Text'&&n.props.children===(gift?'Gift Shop':'Shop'));
  const layer=tree.find(n=>n.type==='View'&&n.props.children===title),row=tree.find(n=>n.type==='View'&&Array.isArray(n.props.children)&&n.props.children.includes(layer));
  const header=tree.find(n=>n.type==='View'&&Array.isArray(n.props.children)&&n.props.children.includes(row));
  assert.equal(row.props.style.alignItems,'center');assert.equal(row.props.style.flexDirection,'row');
  assert.equal(layer.props.style.justifyContent,'center');assert.equal(layer.props.style.alignItems,'center');
  assert.equal(header.props.style[1].paddingTop,44+16);assert.equal(header.props.style[0].paddingBottom,16);
  assert.equal(title.props.style.position,undefined);assert.equal(title.props.style.top,undefined);
  assert.equal(title.props.numberOfLines,1);assert.equal(title.props.adjustsFontSizeToFit,true);
  assert.equal(row.props.children.at(-1).type,'CoinWallet');assert.ok(row.props.children.some(n=>n.type==='Back'));
  assert.equal(tree.find(n=>n.props?.pages).props.selected,'outfits');h.h.unmount();
 }
});
test('gift detail primary action buys for partner once, never equips or purchases a personal room',async()=>{
  const h=shopHarness();h.render(true);const tree=nodes(h.render(true));
  assert.equal(tree.find(n=>n.type==='Preview').props.ownerId,'partner');
  const button=tree.find(n=>n.props?.label==='Gift Irina · {coin} 120');assert.ok(button);
  button.props.onPress();button.props.onPress();assert.equal(h.calls.length,0);assert.equal(h.checkout.offers.length,1);
  h.checkout.approval.resolve(true);await flush();
  assert.deepEqual(plain(h.calls),[['queued-gift','wall','partner',120,'New wallpaper']]);
  assert.equal(h.checkout.successes.length,0,'the durable store owns acknowledgement, not the page callback');h.h.unmount();
});
test('changed partner/account before confirmation blocks gift instead of retargeting it',async()=>{
  const h=shopHarness();h.render(true);nodes(h.render(true)).find(n=>n.props?.label==='Gift Irina · {coin} 120').props.onPress();
  h.setData({...h.data(),partner:{id:'new'}});h.checkout.approval.resolve(true);await flush();assert.equal(h.calls.length,0);
  assert.equal(nodes(h.render(true)).some(n=>n.type==='Preview'),false);h.h.unmount();
});
test('normal shop still offers personal purchase as primary and a separate gift action',()=>{
  const h=shopHarness(false);h.render(true);const tree=nodes(h.render(true));
  assert.ok(tree.some(n=>n.props?.label==='Gift My Partner'));
  assert.ok(tree.some(n=>n.props?.label==='Buy for {coin} 120'));h.h.unmount();
});
for(const kind of ['room','outfit','gift'])test(`Shop ${kind} cancellation cannot spend; approval authorizes exactly one submission`,async()=>{
 for(const approved of [false,true]){
  const h=shopHarness(kind==='gift');
  if(kind==='outfit')h.data().catalog[0]={...h.data().catalog[0],category:'outfits',item_type:'outfit',metadata:{slot:'outfit'}};
  const button=nodes(h.render(true)).find(n=>n.props?.label===(kind==='gift'?'Gift Irina · {coin} 120':'Buy for {coin} 120'));
  button.props.onPress();button.props.onPress();await flush();assert.equal(h.calls.length,0);assert.equal(h.checkout.offers.length,1);
  assert.equal(h.checkout.offers[0].name,'New wallpaper');assert.equal(h.checkout.offers[0].price,120);assert.ok(h.checkout.offers[0].artwork);
  h.checkout.approval.resolve(approved);await flush();
  if(!approved){assert.equal(h.calls.length,0);assert.equal(h.checkout.successes.length,0);}
  else{
   assert.equal(h.checkout.successes.length,0);
   if(kind==='gift'){assert.equal(h.calls[0][0],'queued-gift');assert.equal(h.checkout.successes.length,0,'store owns immediate success; page cannot show a duplicate');}
   else {assert.equal(h.calls[0][0],'queued-room');assert.equal(h.checkout.successes.length,0,'queued rooms are not financial receipts');}
   assert.equal(h.writes.filter(x=>/room-checkout|outfit-buy|^gift:/.test(x)).length,1);
  }
  h.h.unmount();
 }
});
test('Shop room checkout, outfits and partner gifts all preflight to Oops without sending a purchase',()=>{
 for(const kind of ['room','outfit','gift']){
  const h=shopHarness(kind==='gift'),data=h.data();data.wallet.balance=0;
  if(kind==='outfit')data.catalog[0]={...data.catalog[0],category:'outfits',item_type:'outfit',metadata:{slot:'outfit'}};
  h.render(true);const button=nodes(h.render(true)).find(n=>n.props?.label===(kind==='gift'?'Gift Irina · {coin} 120':'Buy for {coin} 120'));
  assert.ok(button,kind);button.props.onPress();
  assert.deepEqual(h.paths,['/(main)/insufficient-coins'],kind);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);h.h.unmount();
 }
});
test('Shop balance reservation denial after confirmation uses Oops without enqueue, success or ownership',async()=>{
 const h=shopHarness();h.render(true);nodes(h.render(true)).find(n=>n.props?.label==='Gift Irina · {coin} 120').props.onPress();
 h.failEnqueue(Error('insufficient_balance'));h.checkout.approval.resolve(true);await flush();
 assert.deepEqual(h.paths,['/(main)/insufficient-coins']);assert.equal(h.alerts.some(a=>a[0]==='Gift sent'),false);
 assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(h.checkout.successes.length,0);h.h.unmount();
});
test('an accepted gift has no page-owned late success callback after connection changes',async()=>{
  const h=shopHarness();h.render(true);nodes(h.render(true)).find(n=>n.props?.label==='Gift Irina · {coin} 120').props.onPress();
  h.checkout.approval.resolve(true);await flush();
  assert.equal(h.calls.length,1);h.setData({...h.data(),pairVersion:'new-connection'});await flush();
  assert.equal(h.alerts.some(a=>a[0]==='Gift sent'),false);assert.equal(h.checkout.successes.length,0);h.h.unmount();
});
test('care cooldown is scoped to the target room and remembers authoritative partner timestamps',()=>{
  const model=load('apps/mobile/src/lib/burrow-care-cooldown.ts'),data=snapshot(),now=Date.now();
  data.lastCareAt={food:new Date(now).toISOString()};data.partnerLastCareAt={water:new Date(now).toISOString()};
  assert.equal(model.careCoolingDown(data,'food',now),true);
  assert.equal(model.careCoolingDown(data,'food',now,'partner'),false);
  assert.equal(model.careCoolingDown(data,'water',now,'partner'),true);
  model.markCareCompleted('partner','food',now);
  assert.equal(model.careCoolingDown(data,'food',now,'partner'),true);
});
