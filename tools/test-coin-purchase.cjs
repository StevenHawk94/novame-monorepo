const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,clock}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const offer={name:'Christmas Wreath',price:500,artwork:jsx('Artwork',{source:42})};
function controller(){
 let epoch=1,identity;const owners=new Set();let releases=0;
 const api=load('apps/mobile/src/lib/coin-purchase-prompt.ts',{
  './overlay-presence':{registerOverlay:owner=>{owners.add(owner);return()=>{assert.ok(owners.delete(owner));releases++;};}},
  './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}},
 });
 return {api,owners,releases:()=>releases,epoch:()=>epoch,changeIdentity:()=>{epoch++;identity();}};
}
test('confirmation never charges by itself; cancel, duplicate taps and stale buttons cannot authorize twice',async()=>{
 const {api,owners,releases}=controller(),owner={},other={};let purchases=0,notifications=0;
 const unsubscribe=api.subscribeCoinPurchase(()=>notifications++);
 const purchase=()=>api.requestCoinPurchase(owner,offer,()=>true).then(ok=>{if(ok)purchases++;return ok;});
 const first=purchase(),id=api.coinPurchaseSnapshot().prompt.id;
 assert.equal(purchases,0);assert.equal(owners.size,1);assert.equal(await purchase(),false);
 api.cancelCoinPurchase(other);assert.equal(api.coinPurchaseSnapshot().prompt.id,id);
 api.settleCoinPurchase(id,false);assert.equal(await first,false);assert.equal(purchases,0);assert.equal(releases(),1);
 const second=purchase(),next=api.coinPurchaseSnapshot().prompt.id;
 api.settleCoinPurchase(id,true);assert.equal(purchases,0,'old Purchase button cannot accept a newer offer');
 api.settleCoinPurchase(next,true);api.settleCoinPurchase(next,true);
 assert.equal(await second,true);assert.equal(purchases,1);assert.equal(owners.size,0);assert.equal(releases(),2);
 assert.ok(notifications>=4);unsubscribe();
});
test('invalid price, revoked relationship and session replacement cannot spend or leak a toast',async()=>{
 const h=controller(),{api}=h,owner={};let valid=true;
 for(const price of [-1,1.5,NaN,Infinity])assert.equal(await api.requestCoinPurchase(owner,{...offer,price},()=>true),false);
 const revoked=api.requestCoinPurchase(owner,offer,()=>valid);valid=false;
 api.settleCoinPurchase(api.coinPurchaseSnapshot().prompt.id,true);assert.equal(await revoked,false);
 valid=true;const pending=api.requestCoinPurchase(owner,offer,()=>valid);
 api.showCoinPurchaseSuccess('old item');h.changeIdentity();
 assert.equal(await pending,false);assert.equal(api.coinPurchaseSnapshot().toast,null);assert.equal(api.coinPurchaseSnapshot().prompt,null);
 assert.equal(h.owners.size,0);
});
test('success is explicit and an older timeout cannot remove a newer success message',()=>{
 const {api}=controller();assert.equal(api.coinPurchaseSnapshot().toast,null);
 api.showCoinPurchaseSuccess('Bunny');const old=api.coinPurchaseSnapshot().toastId;
 api.showCoinPurchaseSuccess('Wreath');api.clearCoinPurchaseToast(old);
 assert.equal(api.coinPurchaseSnapshot().toast,'Purchased Wreath!');
 api.clearCoinPurchaseToast(api.coinPurchaseSnapshot().toastId);assert.equal(api.coinPurchaseSnapshot().toast,null);
});
for(const transition of ['unmount','blur','pair','identity'])test(`hook revokes confirmation and late success after ${transition}`,async()=>{
 const h=controller(),r=hooks();let focused=true,scope='A:B:one';
 const {useCoinPurchaseConfirmation}=load('apps/mobile/src/lib/use-coin-purchase-confirmation.ts',{
  react:r.react,'@react-navigation/native':{useIsFocused:()=>focused},
  './session-lifecycle':{sessionEpoch:h.epoch},'./coin-purchase-prompt':h.api,
 });
 const render=()=>r.render(()=>useCoinPurchaseConfirmation(scope));
 const original=render(),pending=original.confirm(offer);
 if(transition==='unmount')r.unmount();
 if(transition==='blur'){focused=false;render();}
 if(transition==='pair'){scope='A:C:two';render();}
 if(transition==='identity')h.changeIdentity();
 assert.equal(await pending,false);assert.equal(original.isCurrent(),false);
 original.success('old purchase');assert.equal(h.api.coinPurchaseSnapshot().toast,null);
 assert.equal(await original.confirm(offer),false);
 if(transition!=='unmount')r.unmount();
});
function host(os='ios'){
 const h=controller(),r=hooks(),time=clock();
 const {CoinPurchaseHost}=load('apps/mobile/src/components/burrow/coin-purchase-host.tsx',{
  react:{...r.react,useSyncExternalStore:(_subscribe,snapshot)=>snapshot()},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native':{Platform:{OS:os},Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFill:{position:'absolute'}}},
  'react-native-screens':{FullWindowOverlay:'WindowOverlay'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/components/ui/screen-overlay':{ScreenOverlay:'ScreenOverlay'},'@/lib/coin-purchase-prompt':h.api,
 },time.globals);
 return {...h,r,time,render:()=>r.render(CoinPurchaseHost)};
}
for(const action of ['Purchase','Cancel purchase','Close purchase confirmation','android-back'])test(`shared popup shows name, art, exact price and handles ${action}`,async()=>{
 const h=host(action==='android-back'?'android':'ios');h.render();
 const pending=h.api.requestCoinPurchase({},offer,()=>true),tree=h.render(),all=nodes(tree);
 assert.ok(all.some(n=>n.props?.children==='Purchase Christmas Wreath for 500 coins?'));
 assert.ok(all.some(n=>n.type==='Artwork'&&n.props.source===42));
 assert.ok(all.some(n=>n.props?.style?.[0]?.backgroundColor==='rgba(0,0,0,0.6)'));
 assert.ok(all.some(n=>n.type==='ScrollView'&&n.props.bounces===false));
 if(action==='android-back')all.find(n=>n.type==='ScreenOverlay').props.onRequestClose();
 else all.find(n=>n.props?.accessibilityLabel===action).props.onPress();
 assert.equal(await pending,action==='Purchase');assert.equal(nodes(h.render()).some(n=>n.type==='ScreenOverlay'),false);
 assert.equal(h.api.coinPurchaseSnapshot().toast,null,'authorization alone is not a purchase receipt');h.r.unmount();
});
for(const os of ['ios','android'])test(`${os} bottom success toast is non-blocking and dismisses after 2.5 seconds`,()=>{
 const h=host(os);h.render();h.api.showCoinPurchaseSuccess('Snowman');let all=nodes(h.render());
 assert.ok(all.some(n=>n.props?.children==='Purchased Snowman!'));
 assert.ok(all.some(n=>n.props?.pointerEvents==='none'&&n.props.style?.[1]?.bottom===52));
 assert.equal(all.some(n=>n.type==='ScreenOverlay'),false);assert.equal(h.owners.size,1,'only automatic prompts are deferred; touch-through behavior is unchanged');
 assert.equal(all.some(n=>n.type==='WindowOverlay'),os==='ios');
 h.time.advance(2499);assert.notEqual(h.api.coinPurchaseSnapshot().toast,null);
 h.time.advance(1);assert.equal(h.api.coinPurchaseSnapshot().toast,null);assert.equal(h.owners.size,0);h.render();
 h.api.showCoinPurchaseSuccess('Second');h.render();h.r.unmount();assert.equal(h.time.timers.size,0);assert.equal(h.owners.size,0);
});
