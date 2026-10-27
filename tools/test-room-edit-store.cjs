const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const lib='apps/mobile/src/lib/',plain=x=>JSON.parse(JSON.stringify(x));
const presentation=load(lib+'burrow-presentation.ts',{'@novame/engine':{}});
const design=load(lib+'room-edit-design.ts',{'./burrow-presentation':presentation});
const catalog=[['lamp0','lamp',0,true],['lamp1','lamp',100],['vase0','vase',0,true],['vase1','vase',80],['bunny','outfit',0,true],['toy0','couple_doll',0,true],['toy1','couple_doll',75]].map(([id,slot,price,starter])=>({
 stable_id:id,title:id,item_type:slot==='outfit'?'outfit':'decor',metadata:{slot,starter},price,category:{lamp:'lamps',vase:'vases',outfit:'outfits',couple_doll:'couple_dolls'}[slot],tags:[]}));
const initial=()=>({profile:{id:'A'},partner:null,pairVersion:null,roomModel:'personal-v2',catalog,loadouts:[],inventory:catalog.filter(i=>i.metadata.starter).map(i=>({owner_id:'A',item_id:i.stable_id})),
 roomPhotos:[],memoryEntries:[],moments:[],affectionInbox:[],gifts:[],wallet:{balance:1000,version:0},serverNow:'2026-10-18T12:00:00Z'});
function harness({disk=new Map(),server=initial()}={}){
 const time=clock(),calls=[],toasts=[],identity=[],appListeners=[],wallets=[];let owner='A',epoch=1,active='active',serial=0,full=false;
 const storage={getString:k=>disk.get(k),set:(k,v)=>{if(full)throw Error('disk_full');disk.set(k,v);},remove:k=>disk.delete(k)};
 const keys={kShopGiftClaims:{keyFor:id=>'gifts:'+id},kBurrowRoomEdits:{keyFor:id=>'room:'+id},kBurrowSnapshot:{name:'snapshot'},kBurrowWallet:{name:'wallet'},kBurrowActionKeys:{name:'action'}};
 const cache=load(lib+'burrow-cache.ts',{'./storage':{storage},'../shared/storage/keys':keys},time.globals);
 const ledger=new (load(lib+'coin-reward-ledger.ts').CoinRewardLedger)();
 const sync=(w,s)=>{wallets.push(w);ledger.sync(s??{wallet:w,credits:[],serverNow:server.serverNow,localDate:'2026-10-18',timezone:'UTC'});};
 const coin={syncCoinWallet:sync,useCoinBalance:()=>ledger.balance,setCoinRewardReconciler(){},subscribeCoinWallet(){},getConfirmedCoinWallet:()=>null,
  getCoinRewardSnapshot:()=>({balance:ledger.balance}),projectCoinSpend:(k,a)=>ledger.projectSpend(k,a),rejectCoinSpend:k=>ledger.rejectSpend(k),
  settleCoinSpend:(k,w,s)=>{ledger.settleSpend(k,w);if(w)sync(w,s);},
  coinRewardDefinitelyRejected:e=>!!e.body?.error};
 const api=load(lib+'burrow-store.ts',{
  react:{useCallback:f=>f,useRef:x=>({current:x}),useSyncExternalStore:(_s,get)=>get()},'expo-router':{useFocusEffect(){}},
  '@react-navigation/native':{useIsFocused:()=>true},'react-native':{AppState:{get currentState(){return active;},addEventListener:(_name,fn)=>{appListeners.push(fn);return{remove(){}};}}},
  'expo-crypto':{randomUUID:()=> 'id-'+(++serial)},'./adventure-arrival':load(lib+'adventure-arrival.ts'),
  './session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>identity.push(fn)},
  './burrow-cache':cache,'./async-lifecycle':load(lib+'async-lifecycle.ts',{},time.globals),
  './room-edit-design':design,'./room-edit-queue':load(lib+'room-edit-queue.ts'),
  './storage':{storage},'../shared/storage/keys':keys,'./coin-reward-store':coin,
  './coin-purchase-prompt':{showCoinPurchaseSuccess:name=>toasts.push(['success',name]),showCoinPurchaseNotice:msg=>toasts.push(['error',msg])},
  './official-rating-milestones':{trackItemPurchaseForRating:p=>p},
  './app-major-update-api':{fetchMajorUpdateBootstrap:async()=>plain(server)},
  './api':{apiClient:{post:(path,payload)=>{const wait=deferred();calls.push({path,payload,...wait});return wait.promise;}}},
 },{...time.globals,performance:{now:()=>time.globals.Date.now()}});
 return {api,calls,toasts,time,disk,wallets,failDisk:x=>{full=x;},balance:()=>ledger.balance,server:()=>server,setServer:x=>server=x,
  design:()=>design.roomDesignIds(api.getBurrowSnapshot().data),
  app:state=>{active=state;appListeners.forEach(fn=>fn(state));},
  identity:id=>{owner=id;epoch++;identity.forEach(fn=>fn());},
  receipt:(i,total=100)=>{
   const row=calls[i],wire=row.payload;
   server=design.withRoomDesign(server,{...design.roomDesignIds(server),...wire.slots,...(wire.outfitItemId?{outfit:wire.outfitItemId}:{})});
   server.inventory=[...server.inventory,...Object.values(wire.slots).filter(id=>!server.inventory.some(r=>r.item_id===id)).map(item_id=>({owner_id:'A',item_id}))];
   server.wallet={balance:server.wallet.balance-total,version:server.wallet.version+1};
   row.resolve({success:true,total,applied:true,ownerId:'A',roomModel:'personal-v2',checkoutId:wire.idempotencyKey,appliedChanges:{...wire.slots,...(wire.outfitItemId?{outfit:wire.outfitItemId}:{})},coinState:{wallet:server.wallet,credits:[],serverNow:server.serverNow,localDate:'2026-10-18',timezone:'UTC'}});
  }};
}
test('real store publishes a durable room and immediate acknowledgement, with authoritative debit from one receipt',async()=>{
 const h=harness();await h.api.refreshBurrow();h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},['lamp1'],'lamp1',100);
 assert.equal(h.design().lamp,'lamp1');assert.equal(h.api.getBurrowSnapshot().data.wallet.balance,1000);assert.equal(h.toasts.length,1);
 await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.action,'purchase_room_changes');
 h.receipt(0);await flush();assert.deepEqual(h.wallets.at(-1),{balance:900,version:1});assert.deepEqual(h.toasts,[['success','lamp1']]);
 assert.equal(h.design().lamp,'lamp1');h.time.advance(400);await flush();assert.equal(h.design().lamp,'lamp1');
});
test('a legacy bootstrap can display cached choices but cannot authorize personal financial writes',async()=>{
 const h=harness({server:{...initial(),roomModel:undefined}});await h.api.refreshBurrow();
 h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},['lamp1'],'lamp1',100);await flush();assert.equal(h.calls.length,0);
 h.setServer({...h.server(),roomModel:'personal-v2'});await h.api.refreshBurrow({silent:true});await flush();assert.equal(h.calls.length,1);
});
test('real shared Plushie controller persists, equips and reserves once before receipt, preserving every unrelated domain',async()=>{
 const h=harness();await h.api.refreshBurrow();const before=h.api.getBurrowSnapshot().data;
 h.api.enqueueBurrowPlushie('toy1');h.api.enqueueBurrowPlushie('toy1');
 assert.equal(h.design().couple_doll,'toy1');assert.equal(h.balance(),925);assert.equal(h.toasts.length,1);
 const after=h.api.getBurrowSnapshot().data;assert.equal(after.roomPhotos,before.roomPhotos);assert.equal(after.catalog,before.catalog);assert.equal(after.moments,before.moments);
 await flush();assert.equal(h.calls.length,1);assert.deepEqual(plain(h.calls[0].payload.slots),{couple_doll:'toy1'});
 assert.equal(h.calls[0].payload.expectedTotal,75);h.receipt(0,75);await flush();assert.equal(h.balance(),925);assert.equal(h.design().couple_doll,'toy1');
});
test('real store rejects only the failed edit, keeps later furniture, removes pending ownership and rebases the next command',async()=>{
 const h=harness();await h.api.refreshBurrow();h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},['lamp1'],'lamp1',100);await flush();
 h.api.enqueueBurrowRoomEdit({...h.design(),vase:'vase1'},['vase1'],'vase1',80);
 h.calls[0].reject({body:{error:'insufficient_balance'},status:400});await flush();
 assert.equal(h.design().lamp,'lamp0');assert.equal(h.design().vase,'vase1');assert.equal(h.calls[1].payload.slots.lamp,undefined);
 assert.ok(!h.api.getBurrowSnapshot().data.inventory.some(r=>r.item_id==='lamp1'));
 assert.equal(h.toasts.filter(t=>t[0]==='success').length,2);h.receipt(1,80);await flush();assert.equal(h.design().vase,'vase1');
});
test('offline restart restores pending furniture before network, retries original key and never regresses on reconciliation',async()=>{
 const a=harness();await a.api.refreshBurrow();a.api.enqueueBurrowRoomEdit({...a.design(),lamp:'lamp1'},['lamp1'],'lamp1',100);await flush();
 a.calls[0].reject(Error('offline'));await flush();const key=a.calls[0].payload.idempotencyKey;
 a.app('background');const b=harness({disk:a.disk});assert.equal(b.design().lamp,'lamp1');assert.equal(b.calls.length,0);
 await b.api.refreshBurrow();await flush();assert.equal(b.calls[0].payload.idempotencyKey,key);
 b.receipt(0);await flush();assert.equal(b.design().lamp,'lamp1');b.time.advance(400);await flush();assert.equal(b.design().lamp,'lamp1');
});
test('re-pair cannot transfer or cancel a personal-room intent; target remains the original owner',async()=>{
 const h=harness();await h.api.refreshBurrow();h.app('background');h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},['lamp1'],'lamp1',100);
 h.setServer({...h.server(),partner:{id:'C'},pairVersion:'new'});h.app('active');await flush();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.partnerId,null);assert.equal(h.api.getBurrowSnapshot().data.partner.id,'C');assert.equal(h.design().lamp,'lamp1');
});
const giftServer=()=>({...initial(),partner:{id:'B'},pairVersion:'v1',pairAccessVerified:true,
 gifts:[{id:'gift-one',sender_id:'B',item_id:'lamp1',created_at:'2026-10-19'}],unread:{gifts:1,affection:0}});
const purchases=h=>JSON.parse(h.disk.get('burrow.shop-purchases.v1')??'[]');
function confirmPurchase(h,index=0){
 const request=h.calls[index],wallet={balance:900,version:1};
 h.setServer({...h.server(),wallet});
 request.resolve({success:true,purchaseId:'purchase-one',checkoutId:request.payload.idempotencyKey,
  coinState:{wallet,credits:[],serverNow:h.server().serverNow,localDate:'2026-10-18',timezone:'UTC'}});
}
test('real outgoing gift persists and acknowledges immediately; receipt debits once without equipping or duplicate success',async()=>{
 const h=harness({server:giftServer()});await h.api.refreshBurrow();
 h.api.enqueueBurrowPurchase('lamp1','B',100,'Gift lamp');
 assert.equal(purchases(h).length,1);assert.equal(h.balance(),900);assert.deepEqual(h.toasts,[['success','Gift lamp']]);
 assert.equal(h.calls.length,1,'network may start, but acknowledgement does not await it');
 const wire=h.calls[0].payload;assert.equal(wire.action,'purchase_catalog_item');assert.equal(wire.recipientId,'B');
 assert.equal(wire.partnerId,'B');assert.equal(wire.pairVersion,'v1');
 h.api.enqueueBurrowPurchase('lamp1','B',100,'Gift lamp');assert.equal(h.calls.length,1);assert.equal(h.toasts.length,1);
 assert.ok(!h.api.getBurrowSnapshot().data.inventory.some(r=>r.item_id==='lamp1'));
 assert.equal(h.design().lamp,'lamp0','outgoing gifts cannot decorate our room');
 confirmPurchase(h);await flush();assert.equal(h.balance(),900);assert.equal(purchases(h).length,0);
 assert.deepEqual(h.toasts,[['success','Gift lamp']]);
});
test('real outgoing gift retries ambiguous failure and relaunch with identical key, bytes and one success acknowledgement',async()=>{
 const a=harness({server:giftServer()});await a.api.refreshBurrow();a.api.enqueueBurrowPurchase('lamp1','B',100,'Gift lamp');
 const wire=plain(a.calls[0].payload);a.calls[0].reject(Error('offline'));await flush();
 assert.equal(purchases(a).length,1);assert.equal(a.balance(),900);assert.equal(a.toasts.length,1);
 a.time.advance(2000);await flush();assert.equal(a.calls.length,2);assert.deepEqual(plain(a.calls[1].payload),wire);
 a.calls[1].reject(Error('timeout'));await flush();a.app('background');
 const b=harness({disk:a.disk,server:giftServer()});assert.equal(b.calls.length,0,'restore waits for fresh scope verification');
 await b.api.refreshBurrow();await flush();assert.equal(b.calls.length,1);assert.deepEqual(plain(b.calls[0].payload),wire);
 assert.equal(b.balance(),900);assert.equal(b.toasts.length,0,'restored intents must not repeat the sent popup');
 confirmPurchase(b);await flush();assert.equal(b.balance(),900);assert.equal(purchases(b).length,0);assert.equal(b.toasts.length,0);
});
test('real gift local balance and disk denials never send; definitive server denial restores coins and stops retries',async()=>{
 const h=harness({server:giftServer()});await h.api.refreshBurrow();
 assert.throws(()=>h.api.enqueueBurrowPurchase('lamp1','B',1001,'Gift lamp'),/insufficient_balance/);
 assert.equal(h.calls.length,0);assert.equal(h.toasts.length,0);assert.equal(h.balance(),1000);
 h.failDisk(true);assert.throws(()=>h.api.enqueueBurrowPurchase('lamp1','B',100,'Gift lamp'),/intent_not_saved/);
 h.failDisk(false);assert.equal(h.calls.length,0);assert.equal(h.toasts.length,0);assert.equal(h.balance(),1000);
 h.api.enqueueBurrowPurchase('lamp1','B',100,'Gift lamp');assert.equal(h.balance(),900);
 h.calls[0].resolve({error:'insufficient_balance'});await flush();
 assert.equal(h.balance(),1000);assert.equal(purchases(h).length,0);
 assert.deepEqual(h.toasts,[['success','Gift lamp'],['error','Not enough coins. Your purchase was not completed.']]);
 assert.equal(h.design().lamp,'lamp0');assert.ok(!h.api.getBurrowSnapshot().data.inventory.some(r=>r.item_id==='lamp1'));
 h.time.advance(60000);await flush();assert.equal(h.calls.length,1,'a definitive denial must never retry-charge');
});
test('malformed gift receipt stays pending and account changes ignore a late financial response',async()=>{
 const h=harness({server:giftServer()});await h.api.refreshBurrow();h.api.enqueueBurrowPurchase('lamp1','B',100,'Gift lamp');
 h.calls[0].resolve({success:true,purchaseId:'purchase-one',checkoutId:'wrong-key'});await flush();
 assert.equal(purchases(h).length,1);assert.equal(h.balance(),900);assert.equal(h.toasts.length,1);
 h.time.advance(2000);await flush();assert.equal(h.calls.length,2);h.identity('C');
 const before=h.wallets.length;confirmPurchase(h,1);await flush();
 assert.equal(h.wallets.length,before);assert.equal(h.api.getBurrowSnapshot().data,null);assert.equal(h.toasts.length,1);
});
test('real store gift Claim updates count/inventory/room before network, sends atomic intent and survives stale refresh',async()=>{
 const h=harness({server:giftServer()});await h.api.refreshBurrow();h.api.claimShopGiftLocally('gift-one',true);
 let data=h.api.getBurrowSnapshot().data;assert.equal(data.gifts.length,0);assert.equal(data.unread.gifts,0);assert.equal(h.design().lamp,'lamp1');
 assert.equal(data.wallet.balance,1000);assert.ok(h.disk.has('gifts:A'));h.api.claimShopGiftLocally('gift-one',true);
 await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.action,'claim_shop_gift');assert.equal(h.calls[0].payload.replace,true);
 await h.api.refreshBurrow({silent:true});assert.equal(h.api.getBurrowSnapshot().data.gifts.length,0);assert.equal(h.design().lamp,'lamp1');
 h.setServer({...h.server(),gifts:[],unread:{gifts:0,affection:0},inventory:[...h.server().inventory,{owner_id:'A',item_id:'lamp1',source:'gift'}],
  loadouts:[{room_type:'home',owner_id:'A',slot:'lamp',item_id:'lamp1'}]});
 h.calls[0].resolve({success:true,giftId:'gift-one',itemId:'lamp1'});await flush();h.time.advance(400);await flush();
 assert.equal(h.design().lamp,'lamp1');assert.equal(h.api.getBurrowSnapshot().data.wallet.balance,1000);assert.equal(h.toasts.length,0);
});
test('real gift rejection restores queue and selected slot, but only uncertain errors retry in background',async()=>{
 const h=harness({server:giftServer()});await h.api.refreshBurrow();h.api.claimShopGiftLocally('gift-one',true);await flush();
 h.calls[0].resolve({error:'not_found'});await flush();assert.equal(h.api.getBurrowSnapshot().data.gifts.length,1);assert.equal(h.design().lamp,'lamp0');
 assert.ok(!h.api.getBurrowSnapshot().data.inventory.some(row=>row.item_id==='lamp1'));assert.equal(h.toasts.length,1);
});
test('pending gift preview never counts as confirmed inventory for a zero-cost financial checkout',async()=>{
 const h=harness({server:giftServer()});await h.api.refreshBurrow();h.api.claimShopGiftLocally('gift-one',false);await flush();
 h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},[],'lamp1',0);await flush();
 assert.equal(h.calls.length,1,'no purchase RPC can silently buy an unconfirmed gift');assert.equal(h.calls[0].payload.action,'claim_shop_gift');
 assert.equal(h.api.getBurrowSnapshot().data.wallet.balance,1000);
});
test('API rollback / unavailable migration keeps the same durable gift intent retryable, with no legacy fallback or debit',async()=>{
 for(const code of ['invalid_action','gift_claim_unavailable']){
  const h=harness({server:giftServer()});await h.api.refreshBurrow();h.api.claimShopGiftLocally('gift-one',true);await flush();
  const original=plain(h.calls[0].payload);h.calls[0].resolve({error:code});await flush();
  assert.equal(JSON.parse(h.disk.get('gifts:A')).jobs.length,1);assert.equal(h.toasts.length,0);
  assert.equal(h.api.getBurrowSnapshot().data.wallet.balance,1000);assert.equal(h.api.getBurrowSnapshot().data.gifts.length,0);
  h.time.advance(2000);await flush();assert.equal(h.calls.length,2);assert.deepEqual(plain(h.calls[1].payload),original);
  assert.equal(h.calls[1].payload.action,'claim_shop_gift','never falls back to a partial legacy claim');h.app('background');
 }
});
test('hidden legacy starter defaults never enter a financial delta or its quotes',async()=>{
 const legacy={stable_id:'legacy',title:'old',item_type:'decor',category:'decor',metadata:{slot:'decor',starter:true},price:0};
 const h=harness({server:{...initial(),catalog:[...catalog,legacy]}});await h.api.refreshBurrow();
 h.api.enqueueBurrowRoomEdit({...h.design(),decor:'legacy',lamp:'lamp1'},['lamp1'],'lamp1',100);await flush();
 assert.deepEqual(plain(h.calls[0].payload.slots),{lamp:'lamp1'});
 assert.deepEqual(plain(h.calls[0].payload.expectedPrices),{lamp1:100});assert.equal(h.balance(),900);
});
test('single purchase reserves immediately, previews entitlement, deduplicates, and retries identical payload after timeout',async()=>{
 const h=harness();await h.api.refreshBurrow();h.api.enqueueBurrowPurchase('lamp1','A',100,'lamp1');
 assert.equal(h.balance(),900);assert.deepEqual(h.toasts,[['success','lamp1']]);
 assert.ok(h.api.getBurrowSnapshot().data.inventory.some(i=>i.item_id==='lamp1'&&i.source==='purchase-preview'));
 h.api.enqueueBurrowPurchase('lamp1','A',100,'lamp1');assert.equal(h.calls.length,1);
 const wire=plain(h.calls[0].payload);h.calls[0].reject(Error('offline'));await flush();
 assert.equal(h.balance(),900);assert.equal(h.toasts.length,1);h.time.advance(2000);await flush();
 assert.deepEqual(plain(h.calls[1].payload),wire);
 h.calls[1].resolve({success:true,checkoutId:wire.idempotencyKey,purchaseId:'receipt',
  coinState:{wallet:{balance:900,version:1},credits:[],spends:['shop-item:'+wire.idempotencyKey]}});await flush();
 assert.equal(h.balance(),900);assert.equal(h.toasts.length,1);
 assert.ok(h.api.getBurrowSnapshot().data.inventory.some(i=>i.item_id==='lamp1'&&i.source==='purchase'));
});
test('single purchase rejection restores reservation and optimistic inventory, without leaving a stuck bought state',async()=>{
 const h=harness();await h.api.refreshBurrow();h.api.enqueueBurrowPurchase('lamp1','A',100,'lamp1');
 h.calls[0].resolve({error:'price_changed'});await flush();assert.equal(h.balance(),1000);
 assert.equal(h.api.getBurrowSnapshot().data.inventory.some(i=>i.item_id==='lamp1'),false);
 assert.equal(h.toasts.filter(t=>t[0]==='error').length,1);
 h.time.advance(60000);await flush();assert.equal(h.calls.length,1);
});
test('pending purchases cannot spend the same local balance or race a free equip ahead of purchase',async()=>{
 const h=harness();await h.api.refreshBurrow();h.api.enqueueBurrowPurchase('lamp1','A',100,'lamp1');
 assert.throws(()=>h.api.enqueueBurrowPurchase('vase1','A',950,'vase1'),/insufficient_balance/);
 h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},[],'lamp1',0);await flush();
 assert.equal(h.calls.length,1);const wire=h.calls[0].payload;
 h.calls[0].resolve({success:true,checkoutId:wire.idempotencyKey,purchaseId:'receipt',coinState:{wallet:{balance:900,version:1},credits:[]}});await flush();
 assert.equal(h.calls.length,2);assert.equal(h.calls[1].payload.action,'purchase_room_changes');assert.equal(h.calls[1].payload.expectedTotal,0);
});
test('fresh partner updates do not enter a queued delta or get replaced by its receipt',async()=>{
 const h=harness();await h.api.refreshBurrow();h.api.enqueueBurrowRoomEdit({...h.design(),lamp:'lamp1'},['lamp1'],'lamp1',100);await flush();
 h.setServer({...h.server(),loadouts:[{owner_id:'A',room_type:'home',slot:'vase',item_id:'vase1'}]});
 await h.api.refreshBurrow({silent:true});assert.equal(h.design().vase,'vase1');
 h.receipt(0);await flush();assert.equal(h.design().vase,'vase1');assert.deepEqual(plain(h.calls[0].payload.slots),{lamp:'lamp1'});
});
