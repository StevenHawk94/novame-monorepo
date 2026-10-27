const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const file = 'apps/mobile/src/lib/burrow-shop-icons.ts';
const refs = Object.fromEntries([...fs.readFileSync(file, 'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(m => [m[2], path.resolve(path.dirname(file), m[2])]));
const icons = load(file, refs);
const { ShopCategoryIcon, SHOP_CATEGORY_ICON_SIZE: size, SHOP_CATEGORY_ICON_COLORS: colors } = load(
  'apps/mobile/src/components/burrow/shop-category-icon.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View' },
    './burrow-image': { Image: 'Image' }, '@/lib/burrow-shop-icons': icons,
  });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : [];

test('every Shop silhouette uses the same 31pt envelope and selection colors', () => {
  assert.equal(size, 31);
  assert.ok(Math.abs(size - 38 * 410 / 500) < .2, 'keeps the previous kettle visible size');
  for (const category of Object.keys(icons.BURROW_SHOP_ICONS)) {
    for (const selected of [true, false]) {
      const tree = ShopCategoryIcon({ category, selected });
      assert.equal(tree.props.style?.width ?? tree.props.width, size, category);
      assert.equal(tree.props.style?.height ?? tree.props.height, size, category);
      for (const node of nodes(tree).filter(n => ['Image', 'Path'].includes(n.type)))
        assert.equal(node.props.tintColor ?? node.props.fill, selected ? colors.selected : colors.idle, category);
    }
  }
});

test('every WebP silhouette is centered by its own alpha bounds without stretching', () => {
  for(const [category,bounds] of Object.entries(icons.BURROW_SHOP_ICON_BOUNDS)){
    const image = nodes(ShopCategoryIcon({ category, selected: false })).find(n => n.type === 'Image');
    const [left,top,right,bottom]=bounds,s=image.props.style,ratio=s.width/icons.BURROW_SHOP_ICON_SOURCE_SIZE;
    assert.equal(s.height/icons.BURROW_SHOP_ICON_SOURCE_SIZE,ratio);
    assert.ok(Math.abs(s.left+(left+right)/2*ratio-size/2)<1e-9,category);
    assert.ok(Math.abs(s.top+(top+bottom)/2*ratio-size/2)<1e-9,category);
    assert.ok(Math.abs(Math.max(right-left,bottom-top)*ratio-size)<1e-9,category);
    assert.equal(image.props.source,icons.BURROW_SHOP_ICONS[category]);
    assert.equal(image.props.transition,0);assert.equal(image.props.cachePolicy,'memory-disk');
  }
});

test('all sixteen new WebPs are used, including wallpaper/shirt/kettle instead of generated or Home art', () => {
  const folder='apps/mobile/assets/burrow-webp/burrow-shop-icons';
  const expected=fs.readdirSync(folder).filter(file=>file.endsWith('.webp')).sort();
  const used=Object.values(icons.BURROW_SHOP_ICONS);
  assert.equal(used.length,16);assert.deepEqual(used.map(file=>path.basename(file)).sort(),expected);
  const categories=load('apps/mobile/src/lib/burrow-shop-categories.ts',{'@novame/domain':{
    BURROW_DECOR_SHOP_CATEGORIES:['cushions','tables','rugs','vases','lamps','windows','cabinets','shelves','shelf_decor','music_players','frames','posters','couple_dolls','light_strings','ladders','dresser_plants']}});
  assert.deepEqual(Object.keys(icons.BURROW_SHOP_ICONS).sort(),[...categories.BURROW_SHOP_CATEGORIES].sort());
  for(const category of ['wallpapers','outfits','dresser_plants']){
    const tree=ShopCategoryIcon({category,selected:true});assert.equal(nodes(tree).filter(n=>n.type==='Image').length,1);
    assert.equal(nodes(tree).filter(n=>n.type==='Svg').length,0);
  }
  const shop = fs.readFileSync('apps/mobile/src/components/burrow/burrow-shop.tsx', 'utf8');
  assert.match(shop, /<ShopCategoryIcon category=\{cat\} selected=\{selected === cat\}/);
  assert.ok(!shop.includes('home-selected.webp'));
  for (const asset of Object.values(icons.BURROW_SHOP_ICONS)) assert.ok(fs.existsSync(asset), asset);
});
test('Shop uses the exact requested sixteen category labels and order without changing catalog IDs',()=>{
  const model=load('apps/mobile/src/lib/burrow-shop-categories.ts');
  assert.deepEqual(Array.from(model.BURROW_SHOP_CATEGORIES),['outfits','wallpapers','couple_dolls','cushions','tables','rugs','vases','lamps','windows','cabinets','music_players','frames','dresser_plants','light_strings','ladders','shelves']);
  assert.deepEqual(Array.from(model.BURROW_SHOP_CATEGORIES,model.burrowShopCategoryName),['Outfits','Wallpapers','Plushies','Cushions','Tables','Rugs','Flowers','Floor Lamps','Windows','Cabinets','Music Players','Photo Frames','Kettles','String Lights','Ladders','Floating Shelves']);
});

test('source dimensions and measured alpha bounds match the actual new assets',async()=>{
  const {createRequire}=require('node:module');
  const sharp=createRequire(require.resolve('next/package.json',{paths:[path.resolve('apps/api')]}))('sharp');
  for(const [category,source] of Object.entries(icons.BURROW_SHOP_ICONS)){
    const metadata=await sharp(source).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.hasAlpha,true);
    assert.equal(metadata.width,icons.BURROW_SHOP_ICON_SOURCE_SIZE);assert.equal(metadata.height,icons.BURROW_SHOP_ICON_SOURCE_SIZE);
    const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let left=info.width,top=info.height,right=0,bottom=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*info.channels+3]>0){
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
    }
    assert.deepEqual(Array.from(icons.BURROW_SHOP_ICON_BOUNDS[category]),[left,top,right,bottom],category);
  }
});
