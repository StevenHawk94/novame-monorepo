const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const model=load('apps/mobile/src/lib/shop-gift-model.ts'),version=load('apps/mobile/src/lib/notification-content-version.ts');
function harness(){
 let current=hooks(),focused=true,ready=true,active='active',error=false;const claims=[],identities=[];
 const react=new Proxy({}, {get:(_,name)=>(...args)=>current.react[name](...args)});
 const api=load('apps/mobile/src/components/burrow/shop-gift-inbox.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'@react-navigation/native':{useIsFocused:()=>focused},
  'react-native':{Modal:'Modal',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:x=>x},
   useWindowDimensions:()=>({height:568}),AppState:{currentState:active,addEventListener:(_,fn)=>{identities.push(fn);return{remove(){}};}}},
  '@/lib/burrow-attention':{useNotificationContentReady:()=>ready},'@/lib/notification-content-version':version,
  '@/lib/shop-gift-model':model,'@/lib/burrow-store':{claimShopGiftLocally:(id,replace)=>{if(error)throw Error('disk');claims.push({id,replace});}},
  '@/lib/shop-gift-preparation':{preparedShopGiftIds:data=>data.gifts.map(g=>g.id)},
  '@/lib/overlay-presence':{registerOverlay:()=>()=>{}},
 });
 const data={profile:{id:'A'},partner:{id:'B',display_name:'Babe'},pairVersion:'v1',pairAccessVerified:true,
  gifts:[{id:'1',item_id:'snowman',sender_id:'B',created_at:'2026-10-18'}],
  catalog:[{stable_id:'snowman',title:'Snowman',item_type:'outfit',metadata:{slot:'outfit'}}]};
 const parent=hooks();
 const render=()=>{current=parent;return parent.render(()=>api.ShopGiftInbox({data,artwork:()=>jsx('Artwork',{})}));};
 const card=()=>{const node=nodes(render()).find(n=>typeof n.type==='function');const h=hooks();return()=>{current=h;return nodes(h.render(()=>node.type(node.props)));};};
 return {data,claims,render,card,setFocus:x=>focused=x,setReady:x=>ready=x,setError:x=>error=x,background:()=>identities.forEach(fn=>fn('background'))};
}
test('Shop opens a ready gift immediately; transparent black modal and FIFO product card; no fetch on mount',()=>{
 const h=harness(),tree=h.render();assert.equal(tree.type,'Modal');assert.equal(tree.props.animationType,'none');assert.equal(tree.props.transparent,true);
 const render=h.card(),all=render();assert.ok(all.some(n=>n.props?.children==='Babe sent you a gift'));assert.ok(all.some(n=>n.props?.children==='Snowman'));
 const check=all.find(n=>n.props?.accessibilityRole==='checkbox');assert.equal(check.props.accessibilityState.checked,false);
 check.props.onPress();assert.equal(render().find(n=>n.props?.accessibilityRole==='checkbox').props.accessibilityState.checked,true);
 const claim=render().find(n=>n.props?.accessibilityLabel==='Claim gift');claim.props.onPress();claim.props.onPress();assert.deepEqual(h.claims,[{id:'1',replace:true}]);
 const next=h.card();assert.equal(next().find(n=>n.props?.accessibilityRole==='checkbox').props.accessibilityState.checked,false,'each new gift starts unchecked');
});
test('hidden/preloaded Shop, background and unprepared data never present or acknowledge gifts',()=>{
 const h=harness();h.setFocus(false);assert.equal(h.render(),null);h.setFocus(true);h.setReady(false);assert.equal(h.render(),null);
 h.setReady(true);assert.ok(h.render());h.background();assert.equal(h.render(),null);assert.equal(h.claims.length,0);
});
test('failed local persistence leaves Claim retryable; no accidental replace or extra confirmation step',()=>{
 const h=harness(),render=h.card();h.setError(true);render().find(n=>n.props?.accessibilityLabel==='Claim gift').props.onPress();
 assert.ok(render().some(n=>n.props?.accessibilityRole==='alert'));assert.equal(h.claims.length,0);
 h.setError(false);render().find(n=>n.props?.accessibilityLabel==='Claim gift').props.onPress();assert.deepEqual(h.claims,[{id:'1',replace:false}]);
});
test('Shop badge counts actual prepared pending gift IDs, not a notification receipt; 12 remains 12',()=>{
 let ready=false;const api=load('apps/mobile/src/lib/burrow-attention.ts',{
  react:{},'./storage':{storage:{getString(){}}},'../shared/storage/keys':{kBurrowAttention:{keyFor:x=>x}},
  './session-lifecycle':{sessionUserId:()=> 'A',subscribeSessionIdentity(){}},'./burrow-presentation':{adventureHasArrived:()=>false},
  './burrow-moments-model':{momentKind:()=>false},'./notification-readiness':{notificationReadiness:{ready:()=>false}},
  './shop-gift-preparation':{preparedShopGiftIds:data=>ready?data.gifts.map(g=>g.id):[]},'./notification-content-version':version,
 });
 const data={profile:{id:'A'},partner:{id:'B'},pairVersion:'v1',pairAccessVerified:true,serverNow:'2026-10-19',localDate:'2026-10-19',
  gifts:Array.from({length:12},(_,i)=>({id:String(i),sender_id:'B'})),unread:{gifts:12},quests:{quests:[]}};
 assert.equal(api.burrowAttentionCounts(data).tabs.shop,0);ready=true;assert.equal(api.burrowAttentionCounts(data).tabs.shop,12);
 assert.equal(api.burrowAttentionCounts(data).tabs.index,0);data.gifts.shift();assert.equal(api.burrowAttentionCounts(data).tabs.shop,11);
 data.pairAccessVerified=false;assert.equal(api.burrowAttentionCounts(data).tabs.shop,0);
 const {UpdateBadge}=load('apps/mobile/src/components/burrow/update-badge.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{StyleSheet:{create:x=>x},Text:'Text',View:'View'},'@/lib/burrow-attention':api});
 assert.equal(UpdateBadge({count:12,exact:true}).props.children.props.children,'12');
});
test('retained Shop incrementally prepares gift arrivals and retired metadata even while another tab is focused',()=>{
 const {retainedPageChanged}=load('apps/mobile/src/lib/retained-page-model.ts');
 const before={profile:{id:'A'},partner:{id:'B'},gifts:[],giftCatalog:[]};
 assert.equal(retainedPageChanged(before,{...before,gifts:[{id:'new'}]},'shop'),true);
 assert.equal(retainedPageChanged(before,{...before,giftCatalog:[{stable_id:'retired'}]},'shop'),true);
 assert.equal(retainedPageChanged(before,{...before,moments:[{id:'unrelated'}]},'shop'),false);
});
