const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {load,hooks,clock,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children),
  ...(x.type==='List'?(x.props.data??[]).flatMap(item=>nodes(x.props.renderItem({item}))):[]),
  ...(x.type==='PlaybackOverlay'?nodes([jsx('Rain',{frame:x.props.frame,uri:x.props.uri,playing:x.props.playing,transparent:true}),
    jsx('Button',{accessibilityLabel:x.props.closeLabel,onPress:x.props.onClose})]):[])]:[];
const ids=Object.keys(require('../apps/mobile/src/lib/surprise-frame-geometry.json'));
function harness(options={}){
  const h=hooks(),timer=clock(),listeners=[],selected=[],continues=[],acknowledged=[];
  const {SurpriseFramePicker}=load('apps/mobile/src/components/burrow/surprise-frame-picker.tsx',{
    '@/lib/surprise-preview':{useSurprisePreview:()=> 'default-portrait.png',prepareSurprisePreview:async()=> 'default-portrait.png'},
    './coin-ui':{CoinLabel:'Text'},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{AppState:{currentState:'active',addEventListener:(_,fn)=>{listeners.push(fn);return{remove(){listeners.splice(listeners.indexOf(fn),1);}};}},Pressable:'Button',ScrollView:'Scroll',FlatList:'List',StyleSheet:{create:x=>x,absoluteFillObject:{}},Text:'Text',View:'View',useWindowDimensions:()=>options.size??{width:390,height:844}},
    '@expo/vector-icons':{Feather:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
    '@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},'@/lib/surprise-guide':{hasSeenSurpriseGuide:()=>options.seen??false,acknowledgeSurpriseGuide:id=>acknowledged.push(id)},
    '@/lib/surprise-frame-assets':{SURPRISE_FRAME_OPTIONS:ids.map(id=>({id,name:id,source:'frame:'+id})),surpriseFrameName:id=>id},
    './burrow-image':{Image:'Image'},'./surprise-art':{SurprisePortrait:'Portrait'},
    './surprise-playback-overlay':{SurprisePlaybackOverlay:'PlaybackOverlay'},'./shop-item-price':{ShopItemPrice:'ItemPrice'},
  },timer.globals);
  const render=(props={})=>h.render(()=>SurpriseFramePicker({userId:'me',frame:'santa',offers:Object.fromEntries(ids.map(id=>[id,{price:300,plus_only:false}])),continueTitle:'Use This Frame',onSelect:id=>selected.push(id),onContinue:()=>continues.push('continue'),...props}));
  const action=(tree,label)=>nodes(tree).find(n=>n.props?.accessibilityLabel===label);
  return {h,timer,render,action,selected,continues,acknowledged,background:()=>listeners.slice().forEach(fn=>fn('background'))};
}
test('only the frame grid scrolls; fixed top preview has a face, thumbnails contain only original art, footer remains below the list',()=>{
  const h=harness({seen:true}),tree=h.render();const [preview,list,footer]=tree.props.children;
  assert.equal(list.type,'List');assert.equal(list.props.style.flex,1);assert.equal(list.props.style.minHeight,0);
  assert.equal(list.props.initialNumToRender,3);assert.equal(list.props.numColumns,3);assert.equal(list.props.maxToRenderPerBatch,2);
  assert.equal(preview.props.style.flexShrink,0);assert.equal(footer.props.style[0].flexShrink,0);
  assert.equal(nodes(preview).filter(n=>n.type==='Portrait').length,1);
  assert.equal(nodes(list).filter(n=>n.type==='Portrait').length,0);
  assert.equal(nodes(list).filter(n=>n.type==='Image').length,ids.length);
  assert.equal(nodes(list).some(n=>n.props?.accessibilityLabel==='Use This Frame'),false);
  h.action(tree,'pumpkin frame').props.onPress();assert.deepEqual(h.selected,['pumpkin']);
  h.action(tree,'Use This Frame').props.onPress();assert.equal(h.continues.length,1);
  const locked=h.render({locked:true});assert.equal(h.action(locked,'pumpkin frame').props.disabled,true);
  h.h.unmount();
});
test('first-use rules are translucent, contain exact copy and are acknowledged only on OK',()=>{
  const h=harness();let tree=h.render();let overlay=nodes(tree).find(n=>n.type==='Overlay');assert.equal(overlay.props.visible,true);
  assert.equal(h.acknowledged.length,0);assert.ok(nodes(overlay).some(n=>n.props?.children==='How it works:'));
  assert.ok(nodes(overlay).some(n=>(Array.isArray(n.props?.children)?n.props.children.join(''):n.props?.children)==='1. Choose a frame\n2. Add your face\n3. Record your voice'));
  assert.ok(nodes(overlay).some(n=>n.props?.children==='We’ll turn it into a surprise for your person.'));
  h.action(tree,'OK').props.onPress();tree=h.render();overlay=nodes(tree).find(n=>n.type==='Overlay');assert.equal(overlay.props.visible,false);
  assert.deepEqual(h.acknowledged,['me']);h.h.unmount();
  const returning=harness({seen:true});assert.equal(nodes(returning.render()).find(n=>n.type==='Overlay').props.visible,false);returning.h.unmount();
});
test('head tap runs a default-face-only native rain preview for 3 seconds, with manual/background/unmount cancellation',async()=>{
  const h=harness({seen:true});let tree=h.render();h.action(tree,'Quick surprise preview').props.onPress();await flush();tree=h.render();
  let rain=nodes(tree).find(n=>n.type==='Rain');assert.equal(rain.props.uri,undefined);assert.equal(rain.props.playing,true);assert.equal(rain.props.quick,undefined);
  assert.equal(h.continues.length,0);h.timer.advance(2999);tree=h.render();assert.ok(nodes(tree).some(n=>n.type==='Rain'));
  h.timer.advance(1);tree=h.render();assert.equal(nodes(tree).some(n=>n.type==='Rain'),false);
  h.action(tree,'Quick surprise preview').props.onPress();await flush();tree=h.render();h.action(tree,'Close quick preview').props.onPress();tree=h.render();assert.equal(nodes(tree).some(n=>n.type==='Rain'),false);
  h.action(tree,'Quick surprise preview').props.onPress();await flush();h.render();h.background();tree=h.render();assert.equal(nodes(tree).some(n=>n.type==='Rain'),false);
  h.action(tree,'Quick surprise preview').props.onPress();await flush();h.render();h.h.unmount();assert.equal(h.timer.timers.size,0);
});
test('small-screen picker shrinks the preview and fits all three thumbnails without pushing out the footer',()=>{
  const h=harness({seen:true,size:{width:320,height:568}}),tree=h.render();
  const portrait=nodes(tree).find(n=>n.type==='Portrait');assert.ok(portrait.props.size<230);
  const thumbnail=nodes(tree).find(n=>n.type==='Image');assert.ok(thumbnail.props.style.width<(320-40)/3);h.h.unmount();
});
test('every selectable frame card uses the requested contrast background, without changing the playback scrim',()=>{
 const h=harness({seen:true}),tree=h.render(),cards=nodes(tree).filter(n=>n.type==='Button'&&n.props.accessibilityLabel?.endsWith(' frame'));
 assert.equal(cards.length,36);
 for(const card of cards)assert.equal(card.props.style({pressed:false})[0].backgroundColor,'#c69063');
 const labels=nodes(tree).filter(n=>n.type==='Text'&&n.props.style?.fontSize===13);
 assert.equal(labels.length,36);assert.ok(labels.every(n=>n.props.style.color==='#FFFFFF'));
 const selected=cards.filter(n=>n.props.accessibilityState.selected);assert.equal(selected.length,1);
 assert.equal(selected[0].props.style({pressed:false})[1].borderColor,'#FFFFFF');
 assert.match(fs.readFileSync('apps/admin/src/app/admin/_components/ShopPricingTab.tsx','utf8'),/row.category==='surprises'\?\{backgroundColor:'#c69063'\}/);
 assert.match(fs.readFileSync('apps/mobile/src/components/burrow/surprise-playback-overlay.tsx','utf8'),/rgba\(0,0,0,0\.5\)/);
 h.h.unmount();
});
test('all frame cards use Shop coin/Plus rendering; Plus members see normal prices and Surprise is never Owned',()=>{
  const h=harness({seen:true}),offers=Object.fromEntries(ids.map((id,index)=>[id,{price:300+index,plus_only:index===1}]));
  let tree=h.render({offers,frame:ids[0]}),prices=nodes(tree).filter(n=>n.type==='ItemPrice');
  assert.equal(prices.length,ids.length);assert.equal(prices[1].props.item.plus_only,true);assert.equal(prices[1].props.hasPlus,false);
  assert.ok(prices.every(n=>n.props.owned===false&&n.props.fontSize===14&&n.props.numberColor==='#FFFFFF'));
  tree=h.render({offers,hasPlus:true});prices=nodes(tree).filter(n=>n.type==='ItemPrice');
  assert.equal(prices[1].props.hasPlus,true);assert.equal(prices[1].props.item.price,301);
  tree=h.render({offers,frame:ids[1]});prices=nodes(tree).filter(n=>n.type==='ItemPrice');
  assert.equal(prices.length,ids.length+1,'selected Plus frame footer also shows a crown badge, not a price');h.h.unmount();
});
test('quick preview retains the original picker/list/footer below a full-window transparent overlay',async()=>{
  const h=harness({seen:true});h.action(h.render(),'Quick surprise preview').props.onPress();await flush();
  const tree=h.render(),overlay=nodes(tree).find(n=>n.type==='PlaybackOverlay');assert.ok(overlay);assert.equal(overlay.props.visible,true);
  assert.ok(nodes(tree).some(n=>n.props?.accessibilityLabel==='Use This Frame'));
  assert.equal(nodes(tree).filter(n=>n.type==='Image').length,ids.length,'no replacement page or lost grid');
  assert.equal(nodes(overlay).find(n=>n.type==='Rain').props.transparent,true);h.h.unmount();
});
test('guide acknowledgment survives restart but cannot mark another account as seen',()=>{
  const disk=new Map();let user='A';const guide=load('apps/mobile/src/lib/surprise-guide.ts',{
    './storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)}},
    '@/shared/storage/keys':{kSurpriseGuideSeen:{name:'guide'}},'./session-lifecycle':{sessionUserId:()=>user},
  });
  assert.equal(guide.hasSeenSurpriseGuide('A'),false);guide.acknowledgeSurpriseGuide('A');assert.equal(guide.hasSeenSurpriseGuide('A'),true);
  user='B';guide.acknowledgeSurpriseGuide('A');assert.equal(guide.hasSeenSurpriseGuide('B'),false);
  guide.acknowledgeSurpriseGuide('B');assert.equal(guide.hasSeenSurpriseGuide('B'),true);
  assert.match(fs.readFileSync('apps/mobile/src/shared/storage/keys.ts','utf8'),/kSurpriseGuideSeen = defineKey\('burrow_surprise_guide_seen_v1', 'user'\)/);
});
