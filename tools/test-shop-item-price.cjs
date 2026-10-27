const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/shop-item-price.ts');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const style=node=>Object.assign({},...(Array.isArray(node.props.style)?node.props.style:[node.props.style]));
const {ShopItemPrice}=load('apps/mobile/src/components/burrow/shop-item-price.tsx',{
  react:{memo:x=>x},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',Text:'Text',StyleSheet:{create:x=>x}},
  'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
  '@/lib/shop-item-price':model,'./coin-ui':{CoinIcon:'CoinIcon'}});

test('normal products and Plus-member exclusive products show the actual coin price in dark brown',()=>{
  for(const [plus_only,hasPlus] of [[false,false],[false,true],[true,true]]){
    const tree=ShopItemPrice({item:{price:380,plus_only},hasPlus,owned:false});
    assert.ok(nodes(tree).some(n=>n.type==='CoinIcon'));
    const text=nodes(tree).find(n=>n.type==='Text');assert.equal(text.props.children,'380');
    assert.equal(style(text).color,'#4A281E');assert.equal(style(text).fontWeight,'800');
    assert.ok(!nodes(tree).some(n=>n.type==='Svg'));assert.equal(tree.props.accessibilityLabel,'380 coins');
  }
});
test('Free users see a rust-orange rounded PLUS badge with a gold crown and white text, not an emoji or numeric price',()=>{
  const tree=ShopItemPrice({item:{price:380,plus_only:true},hasPlus:false,owned:false});
  assert.equal(style(tree).backgroundColor,'#C65336');assert.equal(style(tree).borderRadius,30);
  assert.equal(nodes(tree).find(n=>n.type==='Path').props.fill,'#FFD16B');
  const text=nodes(tree).find(n=>n.type==='Text');assert.equal(text.props.children,'PLUS');assert.equal(style(text).color,'#FFFFFF');
  assert.ok(!nodes(tree).some(n=>n.type==='CoinIcon'));assert.equal(tree.props.accessibilityLabel,'Plus exclusive');
});
test('Surprise can use white amounts without altering Shop defaults, coin art or Plus badges',()=>{
 const tree=ShopItemPrice({item:{price:300,plus_only:false},hasPlus:false,owned:false,numberColor:'#FFFFFF'});
 assert.equal(style(nodes(tree).find(n=>n.type==='Text')).color,'#FFFFFF');
 assert.ok(nodes(tree).some(n=>n.type==='CoinIcon'));
 const regular=ShopItemPrice({item:{price:300,plus_only:false},hasPlus:false,owned:false});
 assert.equal(style(nodes(regular).find(n=>n.type==='Text')).color,'#4A281E');
 const plus=ShopItemPrice({item:{price:300,plus_only:true},hasPlus:false,owned:false,numberColor:'#FFFFFF'});
 assert.equal(style(plus).backgroundColor,'#C65336');assert.equal(nodes(plus).find(n=>n.type==='Path').props.fill,'#FFD16B');
});
test('Owned takes precedence for every entitlement and contains no check mark, coin, or Plus badge',()=>{
  for(const plus_only of [true,false])for(const hasPlus of [true,false]){
    const tree=ShopItemPrice({item:{price:300,plus_only},hasPlus,owned:true});
    assert.equal(tree.type,'Text');assert.equal(tree.props.children,'Owned');assert.equal(nodes(tree).length,1);
  }
});
test('prices support comma grouping, zero-priced starters and unavailable prices without inventing a charge',()=>{
  for(const [price,label] of [[1000,'1,000'],[0,'0'],[null,'—']]){
    const tree=ShopItemPrice({item:{price,plus_only:false},hasPlus:false,owned:false});
    assert.equal(nodes(tree).find(n=>n.type==='Text').props.children,label);
  }
});
test('every Shop list groups all Plus products last, preserving art order and the immutable cached catalog',()=>{
  const {decorationOptions}=load('apps/mobile/src/lib/burrow-collection-options.ts');
  const item=(id,plus,ordinal)=>({stable_id:id,category:'lamps',price:100,plus_only:plus,metadata:{artOrdinal:ordinal}});
  const catalog=[item('plus-2',true,2),item('free-8',false,8),item('plus-1',true,1),item('free-3',false,3)];
  const before=catalog.map(x=>x.stable_id);
  const all=decorationOptions(catalog,'lamps',false,'me',[]);
  assert.deepEqual(Array.from(all,x=>x.stable_id),['free-3','free-8','plus-1','plus-2']);
  assert.deepEqual(catalog.map(x=>x.stable_id),before);
  const mine=decorationOptions(catalog,'lamps',true,'me',catalog.map(x=>({owner_id:'me',item_id:x.stable_id})));
  assert.deepEqual(Array.from(mine,x=>x.stable_id),['free-3','free-8','plus-1','plus-2']);
});
test('Shop grid, decoration options and details share one entitlement-aware price renderer and no old tick/star labels',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-shop.tsx','utf8');
  assert.equal([...source.matchAll(/<ShopItemPrice /g)].length,3);
  assert.doesNotMatch(source,/✓ Owned|✓ Partner owns|✦ PLUS|productPrice:/);
  assert.match(source,/hasPlus=\{data\.hasPlus\}/);
  assert.match(source,/const variants = decorationOptions\(data\.catalog,detail\.item\.category/);
  assert.match(source,/detailPlusLocked \? 'Try Plus'/);
});
