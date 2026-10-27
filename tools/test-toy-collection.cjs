const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, deferred, flush, clock } = require('./lifecycle-test-utils.cjs');
const fs=require('node:fs');
const artFile='apps/mobile/src/lib/burrow-art-assets.ts';
const artImports=Object.fromEntries([...fs.readFileSync(artFile,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],m[2]]));
const artwork=load(artFile,artImports);
const plain = value => JSON.parse(JSON.stringify(value));
const jsx = (type, props) => ({ type, props });
const toyPhotos=load('apps/mobile/src/lib/burrow-toy-photos.ts');
const item = (id, ordinal, extra = {}) => ({ stable_id:id, title:id, description:`A ${id} toy`, category:'couple_dolls',
  item_type:'decor', price:100, metadata:{slot:'couple_doll',artOrdinal:ordinal}, ...extra });
const starter=item('default',1,{price:0,metadata:{slot:'couple_doll',starter:true,artOrdinal:1}});
const roomSlots = data => ({ couple_doll:data.catalog.find(x=>x.stable_id===(data.loadouts.find(x=>x.slot==='couple_doll')?.item_id??'default')),
  table:{stable_id:'table',item_type:'decor',metadata:{slot:'table'}},
  wallpaper:{stable_id:'wallpaper',item_type:'decor',metadata:{slot:'wallpaper'}},
  outfit:{stable_id:'outfit',item_type:'outfit',metadata:{slot:'outfit'}} });
const model=load('apps/mobile/src/lib/toy-collection.ts',{
  './burrow-art-assets':artwork,'./burrow-presentation':{roomSlots},
});
function snapshot(){return {profile:{id:'A'},partner:{id:'B'},pairVersion:'one',wallet:{balance:1000,version:1},hasPlus:false,
  catalog:[starter,item('bunny',2),item('blue',3),item('plus',4,{plus_only:true})],loadouts:[],
  inventory:[{id:'a',owner_id:'A',item_id:'bunny',source:'purchase'},{id:'b',owner_id:'B',item_id:'blue',source:'purchase'}],
  roomPhotos:[{id:'face',ownerId:'A',kind:'doll',toyId:'default',updatedAt:'2026-10-08T12:00:00Z'}]};}

test('collection starts with one default and only includes personal ownership, including gifts',()=>{
  const data=snapshot();data.inventory=[];
  assert.deepEqual(plain(model.toyCollectionItems(data).map(x=>x.stable_id)),['default']);
  data.inventory=snapshot().inventory;
  assert.deepEqual(plain(model.toyCollectionItems(data).map(x=>x.stable_id)),['default','bunny']);
  data.inventory.push({owner_id:'A',item_id:'blue',source:'gift'});
  assert.deepEqual(plain(model.toyCollectionItems(data).map(x=>x.stable_id)),['default','bunny','blue']);
});
test('toy-only store excludes owned, missing art, placeholders, invalid slots, and non-sale rows',()=>{
  const data=snapshot();data.catalog.push(item('bad-art',999),item('reward',5,{price:null}),
    item('fake',6,{is_placeholder:true}),item('lamp',7,{category:'lamps'}),item('wrong-slot',8,{metadata:{slot:'table'}}));
  assert.deepEqual(plain(model.toyShopItems(data).map(x=>x.stable_id)),['blue','plus']);
});
test('switching keeps wallpaper/table, excludes outfits and rejects partner-owned or unowned toys',()=>{
  assert.deepEqual(plain(model.toyRoomLoadout(snapshot(),'bunny')),{couple_doll:'bunny',table:'table',wallpaper:'wallpaper'});
  assert.throws(()=>model.toyRoomLoadout(snapshot(),'blue'),/item_not_owned/);
  assert.throws(()=>model.toyRoomLoadout(snapshot(),'missing'),/item_not_owned/);
});

function nodes(tree){
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(!tree||typeof tree!=='object')return [];
  if(typeof tree.type==='function')return nodes(tree.type(tree.props));
  return [tree,...nodes(tree.props?.children),...(tree.type==='FlatList'?nodes(tree.props.data.map((item,index)=>tree.props.renderItem({item,index}))):[])];
}
function uiHarness(shop=false,options={}){
  const checkout=require('./coin-purchase-test-mock.cjs')({manual:options.manual});
  const h=hooks(),time=clock(),calls=[],writes=[],navigations=[],purchase=deferred(),save=deferred();
  let data=options.data??snapshot(),epoch=1,error=null,queueFails=false;
  const api=load('apps/mobile/src/components/burrow/toy-collection-screen.tsx',{
    '@/lib/burrow-page-entry':{openPreparedBurrow:r=>navigations.push(r)},
    ...checkout.imports,
    '@/lib/insufficient-coins':{showInsufficientCoins:()=>navigations.push('/(main)/insufficient-coins')},
    './coin-ui':{CoinLabel:'Text'},
    './shop-item-price':{ShopItemPrice:'Price'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{ActivityIndicator:'ActivityIndicator',FlatList:'FlatList',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',
      StyleSheet:{create:x=>x,absoluteFillObject:{}},useWindowDimensions:()=>({width:options.width??320,height:options.height??568})},
    'expo-linear-gradient':{LinearGradient:'Gradient'},'expo-router':{Stack:{Screen:'ScreenOptions'},router:{back:()=>navigations.push('back'),push:path=>navigations.push(path)}},
    '@expo/vector-icons':{Feather:'Feather'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20,bottom:0})},
    '@/lib/app-major-update-api':{saveRoomLoadout:async(type,ids)=>{calls.push(['switch',type,ids]);await save.promise;},
      purchaseCatalogItem:async(...args)=>{calls.push(['buy',...args]);return purchase.promise;}},
    '@/lib/burrow-store':{useBurrow:()=>({data}),getBurrowSnapshot:()=>({data,error}),burrowErrorMessage:x=>x,
      refreshBurrow:async()=>calls.push(['refresh']),
      enqueueBurrowPlushie:(id)=>{
        const owner=data.profile.id,item=data.catalog.find(i=>i.stable_id===id),price=item.price,name=item.title;
        if(queueFails)throw Error('intent_not_saved');
        writes.push('durable-purchase');calls.push(['buy',id,owner,'durable-key',price]);checkout.successes.push(name);
        const previous=data.loadouts;
        data={...data,loadouts:[...previous.filter(r=>r.slot!=='couple_doll'),{room_type:'home',owner_id:owner,slot:'couple_doll',item_id:id}],inventory:[...data.inventory,{owner_id:owner,item_id:id,source:'purchase-preview'}]};
        void purchase.promise.then(receipt=>{if(data.profile.id!==owner)return;
          data={...data,inventory:[...data.inventory.filter(i=>i.item_id!==id),{owner_id:owner,item_id:id,source:'purchase'}]};
          calls.push(['receipt',id,owner,receipt.purchaseId]);
        }).catch(e=>{error=e.message;data={...data,loadouts:previous,inventory:data.inventory.filter(i=>!(i.item_id===id&&i.source==='purchase-preview'))};calls.push(['refresh']);});
      },
      enqueueBurrowRoomEdit:(ids,purchased,name,total)=>{
        if(queueFails)throw Error('intent_not_saved');
        writes.push('durable-room-edit');assert.equal(total,0);assert.equal(purchased.length,0);
        data={...data,loadouts:Object.entries(ids).map(([slot,item_id])=>({slot,item_id,owner_id:data.profile.id,room_type:'our'}))};
        calls.push(['local-switch',ids]);
      },
      runBurrowAction:async(op,fn)=>{writes.push(op);try{await fn('durable-key');return true;}catch(e){error=e.message;return false;}},
      setBurrowLoadoutLocally:(ids,owner)=>{data={...data,loadouts:Object.entries(ids).map(([slot,item_id])=>({slot,item_id,owner_id:owner,room_type:'our'}))};calls.push(['local-switch',ids]);},
      confirmBurrowPurchaseLocally:(id,owner,purchaseId)=>{data={...data,inventory:[...data.inventory,{id:purchaseId,owner_id:owner,item_id:id,source:'purchase'}]};calls.push(['receipt',id,owner,purchaseId]);}},
    '@/lib/burrow-presentation':{roomSlots},'@/lib/toy-collection':model,'@/lib/burrow-toy-photos':toyPhotos,'@/lib/session-lifecycle':{sessionEpoch:()=>epoch},
    '@/lib/haptics':{haptics:{selection(){},success(){}}},'./burrow-back-button':{BurrowBackButton:'BackButton'},'./toy-portrait':{ToyPortrait:'ToyPortrait'},
  },time.globals);
  const render=()=>{const root=api.ToyCollectionScreen({shop});return h.render(()=>root.type(root.props));};
  const findLabel=label=>nodes(render()).find(x=>x.props?.accessibilityLabel===label);
  const pressText=text=>{const match=nodes(render()).find(x=>x.type==='Pressable'&&nodes(x.props.children).some(n=>n.type==='Text'&&n.props.children===text));assert.ok(match,text);return match.props.onPress();};
  render();render();
  return {render,findLabel,pressText,calls,writes,navigations,purchase,save,time,checkout,nodes:()=>nodes(render()),data:()=>data,
    changeAccount(){epoch++;data={...data,profile:{id:'C'}};},failQueue(value){queueFails=value;},unmount:h.unmount};
}
test('collection uses each toy’s own face, new toy is empty, selection is not an equip, Buy More uses own route',async()=>{
  const h=uiHarness();
  assert.equal(h.nodes().filter(n=>n.type==='ToyPortrait').length,2);
  const portraits=h.nodes().filter(n=>n.type==='ToyPortrait');
  assert.equal(portraits.find(n=>n.props.item.stable_id==='default').props.photo.id,'face');
  assert.equal(portraits.find(n=>n.props.item.stable_id==='bunny').props.photo,undefined);
  h.data().roomPhotos.push({id:'bunny-face',ownerId:'A',kind:'doll',toyId:'bunny',updatedAt:'2026-10-08T13:00:00Z'});
  assert.equal(h.nodes().find(n=>n.type==='ToyPortrait'&&n.props.item.stable_id==='bunny').props.photo.id,'bunny-face');
  h.findLabel('Select bunny').props.onPress();assert.equal(h.calls.length,0);
  h.pressText('Buy More');assert.equal(h.navigations[0],'/(main)/toy-shop');h.unmount();
});
test('collection has a three-column cream grid, no owned badge, orange selection and fixed gold/brown actions',()=>{
  const data=snapshot();for(let i=0;i<4;i++){const toy=item('extra-'+i,i+5);data.catalog.push(toy);data.inventory.push({owner_id:'A',item_id:toy.stable_id});}
  const h=uiHarness(false,{data,width:393,height:852}),tree=h.nodes();
  assert.ok(tree.some(n=>n.props?.children==='Plushies Collection'));
  assert.equal(tree.some(n=>n.type==='Text'&&String(n.props.children).includes('owned')),false);
  assert.equal(tree.some(n=>n.type==='ScreenOptions'),false);
  assert.equal(tree.some(n=>n.type==='Gradient'),false,'no wooden cabinet or shelf overlays');
  const grid=tree.find(n=>n.type==='FlatList');assert.equal(grid.props.numColumns,3);assert.equal(grid.props.data.length,12);
  assert.equal(grid.props.data.filter(Boolean).length,6);assert.equal(grid.props.bounces,false);
  assert.equal(nodes(grid).filter(n=>n.type==='ToyPortrait').length,6,'empty placeholders do not imply more owned dolls');
  assert.equal(nodes(grid).some(n=>n.type==='Pressable'&&nodes(n).some(x=>x.props?.children==='Buy More')),false,'footer remains outside scrollable content');
  const footerButtons=tree.filter(n=>n.type==='Pressable'&&nodes(n).some(x=>['Buy More','Switch'].includes(x.props?.children)));
  assert.equal(footerButtons.length,2);assert.ok(nodes(footerButtons[0]).some(n=>n.props?.children==='Buy More'));
  assert.equal(footerButtons[0].props.style({pressed:false})[1].backgroundColor,'#F5C76D');
  assert.equal(footerButtons[1].props.style({pressed:false})[0].backgroundColor,'#50351D');
  h.findLabel('Select bunny').props.onPress();
  const selected=h.findLabel('Select bunny');assert.equal(selected.props.accessibilityState.selected,true);
  const badge=nodes(selected).find(n=>n.type==='View'&&n.props.style?.backgroundColor==='#C66B4B');assert.ok(badge);
  assert.equal(h.findLabel('Select default').props.accessibilityState.selected,false);assert.equal(h.calls.length,0);h.unmount();
});
test('collection stays three columns and Toy Shop stays four columns without overflow on small phones or tablets',()=>{
  for(const width of [320,375,430,768]){
    const collection=uiHarness(false,{width}),collectionList=collection.nodes().find(n=>n.type==='FlatList');
    const card=collection.findLabel('Select default'),contentWidth=Math.min(width,540);
    assert.ok(Math.abs(card.props.style[1].width*3+collectionList.props.columnWrapperStyle.gap*2+24-contentWidth)<1e-9);
    assert.equal(collectionList.props.numColumns,3);collection.unmount();
    const data=snapshot();for(let i=0;i<8;i++)data.catalog.push(item('store-'+i,i+5));
    const shop=uiHarness(true,{width,data}),list=shop.nodes().find(n=>n.type==='FlatList');
    assert.equal(list.props.numColumns,4);assert.equal(list.props.bounces,false);
    const cards=nodes(list).filter(n=>n.type==='Pressable');assert.ok(cards.length>=8);
    assert.ok(Math.abs(cards[0].props.style[1].width*4+list.props.columnWrapperStyle.gap*3+24-contentWidth)<1e-9);
    assert.ok(cards.every(n=>n.props.style[1].width===cards[0].props.style[1].width));
    assert.ok(nodes(list).filter(n=>n.type==='ToyPortrait').every(n=>n.props.width>0&&n.props.height>0));
    assert.equal(nodes(list).filter(n=>n.type==='Price').length,cards.length,'same coin/Plus pricing as Shop');shop.unmount();
  }
});
test('Plushies Shop and detail center the title using equal side lanes, with one plus-free wallet',()=>{
 const h=uiHarness(true,{width:320}),check=()=>{
  const tree=h.nodes(),title=tree.find(n=>n.props?.children==='Plushies Shop');assert.equal(title.props.style.color,'#FFFFFF');
  const header=tree.find(n=>n.type==='View'&&Array.isArray(n.props.children)&&n.props.children.includes(title));
  assert.equal(header.props.style[0].backgroundColor,'#4C2B1E');
  const [left,,right]=header.props.children;
  assert.equal(left.props.style.width,right.props.style.width);
  assert.equal(right.props.children.type,'CoinWallet');assert.equal(right.props.children.props.showAdd,false);
  assert.equal(tree.filter(n=>n.type==='CoinWallet').length,1);
  assert.ok(tree.some(n=>n.props?.children==='Each Plushie gets its own photo of Babe.'));
  assert.equal(tree.some(n=>n.type==='ScreenOptions'),false);
  assert.ok(tree.some(n=>n.type==='BackButton'&&n.props.light));
 };
 check();h.findLabel('View blue, 100 carrots').props.onPress();check();h.unmount();
});
test('Switch durably queues once, updates immediately and returns without waiting for the network; disk failure stays retryable',async()=>{
  const h=uiHarness();h.findLabel('Select bunny').props.onPress();
  const one=h.pressText('Switch');h.pressText('Switch');assert.equal(h.writes.length,1);
  assert.equal(h.calls.some(x=>x[0]==='local-switch'),true);
  await one;await flush();
  assert.equal(h.data().loadouts.find(x=>x.slot==='couple_doll').item_id,'bunny');
  assert.ok(h.data().loadouts.some(x=>x.slot==='table'));assert.deepEqual(h.navigations,['back']);h.unmount();
  const bad=uiHarness();bad.failQueue(true);bad.findLabel('Select bunny').props.onPress();await bad.pressText('Switch');await flush();
  assert.equal(bad.calls.some(x=>x[0]==='local-switch'),false);assert.equal(bad.navigations.length,0);
  bad.failQueue(false);await bad.pressText('Switch');assert.equal(bad.writes.length,1);assert.deepEqual(bad.navigations,['back']);bad.unmount();
});
test('buying confirms displayed price and self recipient, immediately equips through personal room path',async()=>{
  const h=uiHarness(true,{manual:true});h.findLabel('View blue, 100 carrots').props.onPress();
  const pending=h.pressText('Buy · {coin} 100');h.pressText('Buy · {coin} 100');await flush();
  assert.equal(h.writes.length,0);assert.equal(h.checkout.offers.length,1);assert.equal(h.checkout.offers[0].price,100);
  h.checkout.approval.resolve(true);await flush();assert.equal(h.writes.length,1);
  assert.deepEqual(h.checkout.successes,['blue']);
  assert.deepEqual(h.calls[0],['buy','blue','A','durable-key',100]);
  assert.equal(h.data().loadouts.find(x=>x.slot==='couple_doll').item_id,'blue');
  h.purchase.resolve({purchaseId:'receipt-1'});await pending;await flush();
  assert.deepEqual(h.checkout.successes,['blue']);
  assert.ok(h.data().inventory.some(x=>x.owner_id==='A'&&x.item_id==='blue'));
  assert.equal(h.calls.some(x=>x[0]==='switch'||x[0]==='local-switch'),false);
  h.pressText('View collection');assert.deepEqual(h.navigations,['back']);h.unmount();
});
test('cancelling a Toy purchase leaves balance, ownership and current page unchanged',async()=>{
 const h=uiHarness(true,{manual:true});h.findLabel('View blue, 100 carrots').props.onPress();
 const pending=h.pressText('Buy · {coin} 100');h.checkout.approval.resolve(false);await pending;
 assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);assert.equal(h.data().wallet.balance,1000);
 assert.equal(h.checkout.successes.length,0);assert.equal(h.navigations.length,0);h.unmount();
});
test('price conflict refreshes without claiming ownership; Plus and low balance never send purchase',async()=>{
  const h=uiHarness(true);h.findLabel('View blue, 100 carrots').props.onPress();
  const pending=h.pressText('Buy · {coin} 100');await flush();h.purchase.reject(Error('price_changed'));await pending;await flush();
  assert.ok(h.calls.some(x=>x[0]==='refresh'));assert.equal(h.calls.some(x=>x[0]==='receipt'),false);h.unmount();
  const plus=uiHarness(true);plus.findLabel('View plus, 100 carrots').props.onPress();plus.pressText('Buy · {coin} 100 · Plus');
  assert.deepEqual(plus.navigations,['/(main)/(modals)/subscription-paywall']);assert.equal(plus.calls.length,0);plus.unmount();
  const poor=uiHarness(true);poor.data().wallet.balance=50;poor.findLabel('View blue, 100 carrots').props.onPress();poor.pressText('Buy · {coin} 100');
  assert.equal(poor.calls.length,0);assert.deepEqual(poor.navigations,['/(main)/insufficient-coins']);poor.unmount();
});
test('late switch or purchase after account change cannot equip, cache ownership or navigate',async()=>{
  const h=uiHarness();h.findLabel('Select bunny').props.onPress();
  const staleSwitch=h.nodes().find(n=>n.type==='Pressable'&&nodes(n).some(x=>x.props?.children==='Switch')).props.onPress;
  h.changeAccount();await staleSwitch();await flush();
  assert.equal(h.calls.some(x=>x[0]==='local-switch'),false);assert.equal(h.navigations.length,0);h.unmount();
  const buy=uiHarness(true);buy.findLabel('View blue, 100 carrots').props.onPress();const buying=buy.pressText('Buy · {coin} 100');await flush();buy.changeAccount();buy.purchase.resolve({purchaseId:'late'});await buying;await flush();
  assert.equal(buy.calls.some(x=>x[0]==='receipt'),false);assert.equal(buy.navigations.length,0);buy.unmount();
});
test('Toys server-side rejection rolls back preview and releases the purchase lock without confirmed ownership',async()=>{
 const h=uiHarness(true);h.findLabel('View blue, 100 carrots').props.onPress();
 const pending=h.pressText('Buy · {coin} 100');await flush();h.purchase.reject(Error('insufficient_balance'));await pending;await flush();
 assert.deepEqual(h.navigations,[]);assert.equal(h.calls.some(x=>x[0]==='receipt'),false);
 assert.equal(h.data().inventory.some(i=>i.item_id==='blue'&&i.owner_id==='A'),false);
 assert.equal(h.nodes().some(n=>n.props?.children==='Buying…'),false);h.unmount();
});
