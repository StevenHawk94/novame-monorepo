const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const os = require('node:os'), { spawnSync } = require('node:child_process');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const registry = require('../apps/admin/src/generated/shop-art.json');
const pricing = load('apps/admin/src/lib/burrow-shop-pricing.js', { '../generated/shop-art.json': registry });
const A = '11111111-1111-4111-8111-111111111111';
const plain = value => JSON.parse(JSON.stringify(value));
const json = (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers });
const valid = { updates: [{ id: 'lamp', price: 120, version: 0 }] };
const req = (body, origin = 'https://admin.example.com') => new Request('https://admin.example.com/api/admin/shop-pricing', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function routeHarness({ authError = null, result = { error: null, updated: [] }, rows = [] } = {}) {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: result }; }, from(table) {
    const chain = { select() { return chain; }, eq(...args) { calls.push({ table, eq: args }); return chain; },
      in() { return chain; }, order() { return chain; }, single: async () => ({ data: { value: 'live' } }),
      limit: async () => ({ data: table === 'catalog_items' ? rows : [] }) }; return chain;
  } };
  const api = load('apps/admin/src/app/api/admin/shop-pricing/route.js', {
    'next/server': { NextResponse: { json } }, '@/lib/auth/require-admin': { requireAdmin: async () => ({ error: authError, user: { id: A, email: 'admin@example.com' } }) },
    '@/lib/supabase/admin': { createAdminClient: () => db }, '@/lib/burrow-shop-pricing': pricing,
    '@/generated/game-details.json':require('../apps/admin/src/generated/game-details.json'),
  }, { URL });
  return { api, calls };
}
test('Admin previews are byte-identical local copies of every bundled Shop art entry', () => {
  const file = 'apps/mobile/src/lib/burrow-art-assets.ts';
  const imports = Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
    .map(match => [match[2],path.resolve(path.dirname(file),match[2])]));
  const module=load(file,imports),mobile = module.BURROW_ART;
  const products=require('../catalog/burrow-shop-products.json').products;
  for (const [category, entries] of Object.entries(registry.categories)) {
    if(category==='games'||category==='surprises')continue;
    assert.equal(entries.filter(Boolean).length,mobile[category].length);
    products.filter(p=>p.category===category&&p.status==='active'&&p.art).forEach(product => {
      const i=product.metadata.artOrdinal-1,entry=entries[i];
      const original = module.burrowArtForItem({stable_id:product.id,metadata:product.metadata}), bytes = fs.readFileSync(original.thumbnail ?? original.source);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24);
      assert.equal(entry.url,`/shop-art/${hash}.webp`);
      assert.deepEqual(fs.readFileSync('apps/admin/public'+entry.url),bytes);
      assert.equal(entry.name,original.name);
      assert.deepEqual(plain(entry.bounds),plain(original.bounds));
      assert.equal(pricing.shopPreview({category,metadata:{artOrdinal:i+1,...(category==='windows'?{windowFrameKey:original.windowFrameKey}:{})}}).name,entry.name);
    });
    assert.equal(pricing.shopPreview({category,metadata:{artOrdinal:9999}}),null);
  }
  assert.equal(pricing.shopPreview({category:'outfits',metadata:{artOrdinal:1}}).name,'Cherry Gingham');
  assert.equal(pricing.shopPreview({category:'outfits',metadata:{starter:true,artOrdinal:0}}),null);
});
test('Admin service catalogue contains 70 game previews, 420 questions and 36 Surprise previews',()=>{
 assert.equal(registry.categories.games.length,70);assert.equal(registry.categories.surprises.length,36);
 const details=require('../apps/admin/src/generated/game-details.json');assert.equal(Object.keys(details).length,70);
 for(const questions of Object.values(details)){assert.equal(questions.length,6);for(const q of questions)assert.equal(q.options.length,4);}
 for(const entry of [...registry.categories.games,...registry.categories.surprises]){
  const bytes=fs.readFileSync('apps/admin/public'+entry.url);assert.equal('/shop-art/'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.webp',entry.url);
 }
});
test('Vercel build verifies generated previews without uploading the native project', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'burrow-shop-deploy-test-'));
  try {
    fs.mkdirSync(path.join(root,'tools'),{recursive:true});
    fs.copyFileSync('tools/build-admin-shop-assets.cjs',path.join(root,'tools/build-admin-shop-assets.cjs'));
    fs.mkdirSync(path.join(root,'apps/admin/src/generated'),{recursive:true});
    fs.copyFileSync('apps/admin/src/generated/shop-art.json',path.join(root,'apps/admin/src/generated/shop-art.json'));
    fs.mkdirSync(path.join(root,'packages/domain/src/generated'),{recursive:true});
    fs.copyFileSync('packages/domain/src/generated/shop-catalog-release.json',path.join(root,'packages/domain/src/generated/shop-catalog-release.json'));
    fs.cpSync('apps/admin/public/shop-art',path.join(root,'apps/admin/public/shop-art'),{recursive:true});
    const run=()=>spawnSync(process.execPath,[path.join(root,'tools/build-admin-shop-assets.cjs')],{
      encoding:'utf8',env:{...process.env,NODE_PATH:path.resolve('node_modules')},
    });
    let result=run(); assert.equal(result.status,0,result.stderr);
    assert.ok(result.stdout.includes(`${Object.values(registry.products).filter(p=>p.preview).length} bundled previews verified`));
    const art=Object.values(registry.categories)[0][0];
    fs.unlinkSync(path.join(root,'apps/admin/public',art.url));
    result=run(); assert.notEqual(result.status,0,'missing production previews must fail the build');
    const ignore=fs.readFileSync('.vercelignore','utf8');
    assert.ok(ignore.includes('!/tools/build-admin-shop-assets.cjs')); assert.ok(ignore.includes('/apps/mobile/'));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('price input schema permits only existing-product prices and versions', () => {
  assert.equal(pricing.validateShopPriceBatch(valid),true);
  for (const value of [null,[],{}, {...valid,asset:'evil'}, {...valid,reason:123}, {...valid,reason:'x'.repeat(501)},
    {updates:[]}, {updates:Array(201).fill(valid.updates[0])}, {updates:[...valid.updates,...valid.updates]}])
    assert.equal(pricing.validateShopPriceBatch(value),false);
  for (const row of [{price:0},{price:-1},{price:1000001},{price:1.5},{price:'100'},{version:-1},{id:' '},{asset:'evil'}])
    assert.equal(pricing.validateShopPriceBatch({updates:[{...valid.updates[0],...row}]}),false);
});
test('Shop schema accepts typed Plus-only or combined edits without requiring a price',()=>{
  for(const row of [{id:'lamp',version:0,plus_only:true},{id:'lamp',version:0,plus_only:false},
    {id:'lamp',version:0,price:100,plus_only:true}]) assert.equal(pricing.validateShopPriceBatch({updates:[row]}),true);
  for(const plus_only of ['true',1,0,null,{},[]])
    assert.equal(pricing.validateShopPriceBatch({updates:[{id:'lamp',version:0,plus_only}]}),false);
  assert.equal(pricing.validateShopPriceBatch({updates:[{id:'lamp',version:0}]}),false);
  assert.equal(pricing.validateShopPriceBatch({updates:[{id:'lamp',version:0,plus_only:true,price:0}]}),false);
});
test('only games accept a zero price; zero games remain editable and can be repriced',async()=>{
  assert.equal(pricing.validateShopPriceBatch({updates:[{id:'game:after_dark_01',price:0,version:0}]}),true);
  for(const id of ['surprise:santa','lamp'])assert.equal(pricing.validateShopPriceBatch({updates:[{id,price:0,version:0}]}),false);
  const h=routeHarness({rows:[{stable_id:'game:after_dark_01',category:'games',price:0,item_type:'game',metadata:{gameId:'after_dark_01'}}]});
  assert.equal((await h.api.GET()).body.rows[0].editable,true);
  assert.equal((await h.api.POST(req({updates:[{id:'game:after_dark_01',price:0,version:0,plus_only:false}]}))).status,200);
  assert.equal(h.calls.find(c=>c.name==='set_burrow_shop_prices_v1').args.p_updates[0].price,0);
});
test('Admin GET and POST both require authentication; POST rejects cross-origin writes', async () => {
  const unauthorized = routeHarness({authError:json({error:'Forbidden'},{status:403})});
  assert.equal((await unauthorized.api.GET()).status,403);
  assert.equal((await unauthorized.api.POST(req(valid))).status,403); assert.equal(unauthorized.calls.length,0);
  const h = routeHarness(); assert.equal((await h.api.POST(req(valid,'https://evil.example.com'))).status,403);
  assert.equal(h.calls.length,0);
});
test('Admin reads only active live-revision products and leaves default items read-only', async () => {
  const h = routeHarness({rows:[{stable_id:'lamp',category:'lamps',price:100,item_type:'decor',metadata:{artOrdinal:2}},
    {stable_id:'free',category:'lamps',price:0,item_type:'decor',metadata:{starter:true}}]});
  const response = await h.api.GET(); assert.equal(response.status,200); assert.equal(response.headers['Cache-Control'],'no-store');
  assert.deepEqual(h.calls.filter(c=>c.table==='catalog_items').map(c=>c.eq),[['revision_id','live'],['status','active']]);
  assert.equal(response.body.rows[0].editable,true); assert.equal(response.body.rows[1].editable,false);
  assert.ok(response.body.rows.every(r=>r.preview.url.startsWith('/shop-art/')));
});
test('Admin writes use verified identity, reject extra fields and preserve conflict status', async () => {
  const h = routeHarness({result:{error:'price_conflict',itemId:'lamp'}});
  assert.equal((await h.api.POST(req({...valid,adminId:'fake'}))).status,400); assert.equal(h.calls.length,0);
  assert.equal((await h.api.POST(req({...valid,reason:' Sale '}))).status,409);
  assert.equal(h.calls[0].name,'set_burrow_shop_prices_v1');
  assert.deepEqual(plain(h.calls[0].args),{p_admin:A,p_email:'admin@example.com',p_updates:valid.updates,p_reason:'Sale'});
});
test('Plus-only POST uses the same authenticated atomic settings RPC and preserves exact booleans',async()=>{
  const h=routeHarness();
  const updates=[{id:'lamp',version:0,plus_only:true},{id:'free',version:0,plus_only:false}];
  assert.equal((await h.api.POST(req({updates}))).status,200);
  assert.deepEqual(plain(h.calls[0].args.p_updates),updates);
  assert.equal(h.calls[0].args.p_admin,A);assert.equal(h.calls[0].name,'set_burrow_shop_prices_v1');
});
function commandHarness(result = {error:null}) {
  const calls = [];
  const service = load('apps/api/src/lib/app-major-update.js',{'@supabase/supabase-js':{},'@/lib/auth-guard':{}});
  const api = load('apps/api/src/app/api/vnext/command/route.js',{'@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},
    'next/server':{NextResponse:{json}}, '@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_id,value)=>value},
    '@/lib/app-major-update':{authenticatedUserId:async()=>A,majorUpdateEnabled:async()=>true,commandStatus:service.commandStatus,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:result};}})},
  });
  return {api,calls};
}
test('purchase command passes displayed single/room prices to transactional v2 RPCs', async () => {
  const h = commandHarness();
  const id='burrow_art_lamps_03';
  assert.equal((await h.api.POST(req({action:'purchase_catalog_item',itemId:id,idempotencyKey:'buy',expectedPrice:120}))).status,200);
  assert.equal(h.calls[0].name,'purchase_catalog_item_v2'); assert.equal(h.calls[0].args.p_expected_price,120);
  const room = {action:'purchase_room_loadout',slots:{lamp:id},idempotencyKey:'room',expectedPrices:{[id]:120}};
  assert.equal((await h.api.POST(req(room))).status,200); assert.equal(h.calls[1].name,'purchase_room_loadout_v2');
  assert.equal((await h.api.POST(req({...room,expectedPrices:{}}))).status,400);
  assert.equal((await h.api.POST(req({...room,expectedPrices:{lamp:-1}}))).status,400);
  assert.equal(h.calls.length,2);
  assert.equal((await commandHarness({error:'price_changed'}).api.POST(req(room))).status,409);
});
test('mobile API includes displayed-price quotes, but never attaches them to care or affection', async () => {
  const calls=[];
  const api=load('apps/mobile/src/lib/app-major-update-api.ts',{
    ...require('./rating-test-mocks.cjs'),
    'expo-crypto':{randomUUID:()=> 'key'},'./api':{apiClient:{post:async(_url,body)=>{calls.push(body);return {};}}},
    './async-lifecycle':{withDeadline:value=>value}, './session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity(){}},
    './coin-reward-store':{commandCoinReward(){},settleCoinReward(){},failCoinReward(){}},
  });
  await api.purchaseCatalogItem('lamp',A,'key',120);
  await api.purchaseRoomLoadout({lamp:'lamp'},'room',undefined,{lamp:120});
  await api.refillRoomNeed(A,'food'); await api.completeAffection('hug',{});
  assert.equal(calls[0].expectedPrice,120); assert.deepEqual(plain(calls[1].expectedPrices),{lamp:120});
  assert.equal(Object.hasOwn(calls[2],'expectedPrice'),false); assert.equal(Object.hasOwn(calls[3],'expectedPrice'),false);
});
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function uiHarness({history=[],rows:customRows}={}) {
  const h=hooks(), requests=[], save=deferred();
  let readFails=false;
  const rows=customRows??[{stable_id:'lamp',title:'Lamp',category:'lamps',price:100,plus_only:false,shop_price_version:0,editable:true,asset:{},metadata:{},preview:null},
    {stable_id:'table',title:'Table',category:'tables',price:200,plus_only:false,shop_price_version:2,editable:true,asset:{},metadata:{},preview:null},
    {stable_id:'free',title:'Starter',category:'lamps',price:0,plus_only:false,shop_price_version:0,editable:false,asset:{},metadata:{starter:true},preview:null}];
  const response=body=>({ok:true,json:async()=>body});
  const {default:Component}=load('apps/admin/src/app/admin/_components/ShopPricingTab.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  },{window:{confirm:()=>true},fetch:async(url,init)=>{
    requests.push({url,init}); if(init?.method!=='POST'&&readFails)throw Error('read offline');
    return init?.method==='POST'?save.promise:response({appVersion:'1',rows,history});
  }});
  return {requests,save,response,failReads:()=>{readFails=true;},render:()=>h.render(()=>Component())};
}
test('Admin UI filters, batches only paid items, and saves exact CAS versions once', async () => {
  const h=uiHarness(); h.render(); await flush();
  let tree=h.render();
  assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type==='number'&&!n.props['aria-label'].startsWith('Batch')).length,2);
  nodes(tree).find(n=>n.type==='button'&&n.props.children==='Select filtered editable items').props.onClick();
  nodes(tree).find(n=>n.props?.['aria-label']==='Batch carrot price').props.onChange({target:{value:'150'}});
  tree=h.render(); nodes(tree).find(n=>n.type==='button'&&n.props.children==='Apply to draft').props.onClick();
  tree=h.render(); const save=nodes(tree).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Save ');
  save.props.onClick(); save.props.onClick(); await flush();
  assert.equal(h.requests.filter(r=>r.init?.method==='POST').length,1);
  assert.deepEqual(JSON.parse(h.requests[1].init.body).updates,[{id:'lamp',price:150,version:0},{id:'table',price:150,version:2}]);
  h.save.resolve(h.response({updated:[{id:'lamp',price:150,version:1},{id:'table',price:150,version:3}]})); await flush();
});
test('Admin game editor submits exact zero and mixed non-game zero batches are disabled',async()=>{
  const row={stable_id:'game:after_dark_01',title:'Game',category:'games',price:150,plus_only:false,shop_price_version:0,editable:true,asset:{},metadata:{billing:'once'},preview:null};
  const h=uiHarness({rows:[row]});h.render();await flush();let tree=h.render();
  const input=nodes(tree).find(n=>n.props?.['aria-label']==='Carrot price for Game');assert.equal(input.props.min,0);
  input.props.onChange({target:{value:'0'}});tree=h.render();
  const save=nodes(tree).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Save ');
  assert.equal(save.props.disabled,false);save.props.onClick();await flush();
  assert.deepEqual(JSON.parse(h.requests.find(r=>r.init?.method==='POST').init.body).updates,[{id:row.stable_id,price:0,version:0}]);
  h.save.resolve(h.response({updated:[{id:row.stable_id,price:0,version:1}]}));await flush();
  const mixed=uiHarness({rows:[row,{...row,stable_id:'lamp',title:'Lamp',category:'lamps'}]});mixed.render();await flush();tree=mixed.render();
  nodes(tree).find(n=>n.type==='button'&&n.props.children==='Select filtered editable items').props.onClick();
  nodes(tree).find(n=>n.props?.['aria-label']==='Batch carrot price').props.onChange({target:{value:'0'}});
  tree=mixed.render();assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.children==='Apply to draft').props.disabled,true);
});
test('Admin can batch Free game offers and restore a previous zero-price offer from history',async()=>{
 const rows=[1,2].map((n)=>({stable_id:'game:test'+n,title:'Game '+n,category:'games',price:150,plus_only:false,shop_price_version:1,editable:true,asset:{},metadata:{billing:'once'},preview:null}));
 const history=[{id:1,item_id:rows[0].stable_id,old_price:0,new_price:150,old_plus_only:false,new_plus_only:false,created_at:'2026-10-15T00:00:00Z',admin_email:'admin@example.com'}];
 const h=uiHarness({rows,history});h.render();await flush();let tree=h.render();
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='Select filtered editable items').props.onClick();
 nodes(tree).find(n=>n.props?.['aria-label']==='Batch carrot price').props.onChange({target:{value:'0'}});
 tree=h.render();const batch=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Apply to draft');assert.equal(batch.props.disabled,false);batch.props.onClick();
 tree=h.render();assert.deepEqual(nodes(tree).filter(n=>n.props?.['aria-label']?.startsWith('Carrot price for')).map(n=>n.props.value),['0','0']);
 const restore=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Restore to draft');assert.equal(restore.props.disabled,false);restore.props.onClick();
 assert.equal(nodes(h.render()).find(n=>n.props?.['aria-label']==='Carrot price for Game 1').props.value,'0');
});
test('Admin UI keeps unsaved edits when a stale version rejects the batch', async () => {
  const h=uiHarness(); h.render(); await flush(); let tree=h.render();
  nodes(tree).find(n=>n.props?.['aria-label']==='Carrot price for Lamp').props.onChange({target:{value:'170'}});
  tree=h.render(); nodes(tree).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Save ').props.onClick();
  h.save.resolve({ok:false,json:async()=>({error:'price_conflict'})}); await flush(); tree=h.render();
  assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Carrot price for Lamp').props.value,'170');
  assert.ok(nodes(tree).some(n=>n.props?.role==='alert'&&String(n.props.children).includes('Nothing was saved')));
});
test('every product has an accessible Plus switch, including read-only starter prices; toggling back clears the draft',async()=>{
  const h=uiHarness();h.render();await flush();let tree=h.render();
  assert.equal(nodes(tree).filter(n=>n.props?.role==='switch').length,3);
  const toggle=()=>nodes(h.render()).find(n=>n.props?.['aria-label']==='Plus only for Starter');
  assert.equal(toggle().props.disabled,false);assert.equal(toggle().props['aria-checked'],false);
  toggle().props.onClick();assert.equal(toggle().props['aria-checked'],true);
  toggle().props.onClick();tree=h.render();
  assert.equal(toggle().props['aria-checked'],false);
  const save=nodes(tree).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Save ');
  assert.equal(save.props.disabled,true);assert.equal(h.requests.length,1);
});
test('Plus-only save omits price and retains the committed flag/version if the following read fails',async()=>{
  const h=uiHarness();h.render();await flush();
  nodes(h.render()).find(n=>n.props?.['aria-label']==='Plus only for Starter').props.onClick();
  const save=nodes(h.render()).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Save ');
  assert.equal(save.props.disabled,false);save.props.onClick();await flush();
  assert.deepEqual(JSON.parse(h.requests[1].init.body).updates,[{id:'free',version:0,plus_only:true}]);
  h.failReads();h.save.resolve(h.response({updated:[{id:'free',price:0,plus_only:true,version:1}]}));await flush();
  const tree=h.render();assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Plus only for Starter').props['aria-checked'],true);
  assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));
});
test('combined price/Plus edit publishes once and conflicts preserve both drafts',async()=>{
  const h=uiHarness();h.render();await flush();let tree=h.render();
  nodes(tree).find(n=>n.props?.['aria-label']==='Carrot price for Lamp').props.onChange({target:{value:'180'}});
  nodes(tree).find(n=>n.props?.['aria-label']==='Plus only for Lamp').props.onClick();tree=h.render();
  const save=nodes(tree).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Save ');
  save.props.onClick();save.props.onClick();await flush();
  assert.equal(h.requests.filter(r=>r.init?.method==='POST').length,1);
  assert.deepEqual(JSON.parse(h.requests[1].init.body).updates,[{id:'lamp',version:0,price:180,plus_only:true}]);
  h.save.resolve({ok:false,json:async()=>({error:'price_conflict'})});await flush();tree=h.render();
  assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Plus only for Lamp').props['aria-checked'],true);
  assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Carrot price for Lamp').props.value,'180');
});
test('history restores Plus settings even when a starter price cannot be edited',async()=>{
  const h=uiHarness({history:[{id:1,item_id:'free',old_price:0,new_price:0,old_plus_only:true,new_plus_only:false,created_at:'2026-10-12T00:00:00Z'}]});
  h.render();await flush();let tree=h.render();
  const restore=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Restore to draft');assert.equal(restore.props.disabled,false);
  restore.props.onClick();tree=h.render();assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Plus only for Starter').props['aria-checked'],true);
});
test('changing a purchased outfit to Plus-only does not block its owner from equipping it',()=>{
  const shop=fs.readFileSync('apps/mobile/src/components/burrow/burrow-shop.tsx','utf8');
  assert.match(shop,/async function buyOutfit[\s\S]*?await applyRoom\(\{\.\.\.saved,outfit:item\}\)/);
  assert.match(shop,/outfit && !mine\.has\(outfit\.stable_id\) \? \[outfit\] : \[\]/,'Plus gate only inspects unowned items');
});
