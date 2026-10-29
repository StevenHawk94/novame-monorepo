const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');
const {
  HOME_ART_HEIGHT, HOME_ART_WIDTH, HOME_LIGHT_STRING_TOP, HOME_MAX_TOP_CROP,
  homeArtLayout, decorationPreviewLayout, homeAnchoredBox, HOME_ART_PLACEMENTS,
  homeTabBarHeight, HOME_TAB_BAR_TOP_SPACE, HOME_DOLL_PLACEMENT,
  homeBackgroundLayout, HOME_BACKGROUND_HEIGHT, HOME_RIM_TO_FLOOR_GAP,
} = load('apps/mobile/src/lib/burrow-home-layout.ts');

test('split backgrounds preserve the original 900x2000 floor anchor, transparent gap and source ratios',()=>{
  const {floor,rim}=homeBackgroundLayout();
  assert.equal(HOME_BACKGROUND_HEIGHT,2000);assert.equal(HOME_RIM_TO_FLOOR_GAP,605);
  assert.deepEqual(JSON.parse(JSON.stringify(floor)),{x:0,y:1185,width:900,height:765});
  assert.deepEqual(JSON.parse(JSON.stringify(rim)),{x:0,y:-50,width:900,height:630});
  assert.equal(floor.y+floor.height,HOME_ART_HEIGHT);
  assert.equal(floor.y-(rim.y+rim.height),605);
  assert.equal(floor.width/floor.height,800/680);assert.equal(rim.width/rim.height,800/560);
  // Keep the supplied alpha padding: old visible floor starts at 1242,
  // old autumn rim ends at 628 in the original full canvas.
  assert.ok(Math.abs(floor.y+50+6*900/800-1242)<=.25);
  assert.ok(Math.abs(rim.y+50+558*900/800-628)<=.25);
});

test('floor-relative rim has the same bottom alignment and crop on short, tall and tablet displays',()=>{
  const {floor,rim}=homeBackgroundLayout();
  for(const [width,height,safe] of [[320,568,0],[375,667,0],[390,844,34],[430,932,34],[768,1024,20],[1024,1366,20]]){
    const tab=homeTabBarHeight(width,safe),layout=homeArtLayout(width,height-tab,tab);
    const canvasTop=height-HOME_ART_HEIGHT*layout.scale;
    const floorBottom=canvasTop+(floor.y+floor.height)*layout.scale;
    assert.ok(Math.abs(floorBottom-height)<1e-8,'original floor bottom');
    assert.ok(Math.abs((floor.y-rim.y-rim.height)*layout.scale-605*layout.scale)<1e-8);
    // Every furniture box stays in the identical original coordinate space.
    for(const item of HOME_ART_PLACEMENTS){
      const box=homeAnchoredBox({width:500,height:500,bounds:[0,0,500,500]},item,layout.scale);
      assert.ok(Math.abs((item.anchor==='top'?box.top:box.top+box.height)-item.anchorY*layout.scale)<1e-8);
    }
    assert.ok(Math.abs((canvasTop+rim.y*layout.scale)-(height-2000*layout.scale))<1e-8);
  }
});

test('all four seasons have two local alpha headers and reuse one exact-size floor, without stale full-sheet references',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const folder='apps/mobile/assets/burrow-webp/room decoration/background-season';
 const expected=['floor.webp',...['autumn','spring','summer','winter'].flatMap(s=>[s+'-day.webp',s+'-night.webp'])].sort();
 assert.deepEqual(fs.readdirSync(folder).filter(x=>x.endsWith('.webp')).sort(),expected);
 for(const file of expected){
  const bytes=fs.readFileSync(path.join(folder,file));assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,16),'WEBPVP8X');assert.ok(bytes[20]&16,'alpha channel');
  assert.equal(bytes.readUIntLE(24,3)+1,800);assert.equal(bytes.readUIntLE(27,3)+1,file==='floor.webp'?680:560);
 }
 const registry=fs.readFileSync('apps/mobile/src/lib/burrow-art-assets.ts','utf8');
 assert.doesNotMatch(registry,/require\([^\n]*(?:Default-Background-Autumn|Background-Spring|Background-Summer|Background-Winter)\.webp/);
});

test('Home tabs add twelve points of top headroom without changing safe-bottom space', () => {
  assert.equal(HOME_TAB_BAR_TOP_SPACE, 12);
  for (const [width, safeBottom] of [[320, 0], [375, 0], [390, 34], [430, 34], [768, 20]]) {
    const previousHeight = Math.max(160 * width / HOME_ART_WIDTH, safeBottom + 44);
    assert.ok(homeTabBarHeight(width, safeBottom) - previousHeight >= 12);
    const iconAndLabelHeight = (64 + 28) * width / HOME_ART_WIDTH + 2;
    assert.ok(homeTabBarHeight(width, safeBottom) - safeBottom >= iconAndLabelHeight + HOME_TAB_BAR_TOP_SPACE + 1);
  }
});

test('Home keeps the string lights on-screen across compact, tall and tablet layouts', () => {
  const screens = [
    { width: 320, height: 478, tab: 90 },
    { width: 375, height: 680, tab: 90 },
    { width: 390, height: 754, tab: 90 },
    { width: 430, height: 780, tab: 90 },
    { width: 768, height: 900, tab: 136 },
  ];
  for (const screen of screens) {
    const layout = homeArtLayout(screen.width, screen.height, screen.tab);
    assert.ok(layout.artWidth <= screen.width + .001, `width ${screen.width}`);
    assert.ok(layout.cropTop <= HOME_MAX_TOP_CROP * layout.scale + .001, `crop ${screen.width}`);
    assert.ok(HOME_LIGHT_STRING_TOP * layout.scale > layout.cropTop, `string lights ${screen.width}`);
    assert.equal(layout.artWidth, HOME_ART_WIDTH * layout.scale);
    assert.equal(layout.artHeight, HOME_ART_HEIGHT * layout.scale);
    assert.ok(layout.left >= 0);
  }
});

test('flower variants use identical canvas scale and center while staying on the table', () => {
  const placement = HOME_ART_PLACEMENTS.find(item => item.slot === 'vase');
  const bounds = [[74, 38, 427, 500], [92, 16, 422, 500], [53, 3, 446, 500]];
  for (const scale of [.35, .5, 1]) {
    const boxes = bounds.map(bounds => homeAnchoredBox({ width: 500, height: 500, bounds }, placement, scale));
    for (const box of boxes) {
      assert.equal(box.width, boxes[0].width);
      assert.equal(box.height, boxes[0].height);
      assert.equal(box.left, boxes[0].left);
      assert.ok(Math.abs(box.top + box.height - placement.anchorY * scale) < 1e-8);
      assert.ok(Math.abs(box.width - 500 * 140 / 353 * scale) < 1e-8);
    }
  }
});

test('decoration preview uses the same proportions and dims only the exposed margins', () => {
  for (const [width, height] of [[284, 448], [354, 680], [524, 900]]) {
    const preview = decorationPreviewLayout(width, height);
    assert.ok(preview.artWidth <= width + .001);
    assert.ok(preview.viewportHeight <= height);
    assert.ok(preview.cropTop <= HOME_MAX_TOP_CROP * preview.scale + .001);
    assert.ok(HOME_LIGHT_STRING_TOP * preview.scale > preview.cropTop);
    assert.equal(preview.artHeight / preview.artWidth, HOME_ART_HEIGHT / HOME_ART_WIDTH);
  }
});

test('all supplied kettles keep the same canvas scale, original proportions and toy clearance', () => {
  const fs = require('node:fs'), path = require('node:path');
  const registry = 'apps/mobile/src/lib/burrow-art-assets.ts';
  const imports = Object.fromEntries([...fs.readFileSync(registry, 'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
    .map(match => [match[2], path.resolve(path.dirname(registry), match[2])]));
  const { BURROW_ART } = load(registry, imports);
  const placement = HOME_ART_PLACEMENTS.find(item => item.slot === 'dresser_plant');
  assert.equal(BURROW_ART.dresser_plants.length, 43);
  for (const scale of [.35, .5, 1]) {
    const boxes = BURROW_ART.dresser_plants.map(asset => homeAnchoredBox(asset, placement, scale));
    for (const [index, asset] of BURROW_ART.dresser_plants.entries()) {
      const box = boxes[index];
      assert.equal(box.width, boxes[0].width);
      assert.equal(box.height, boxes[0].height);
      assert.equal(box.left, boxes[0].left);
      assert.ok(Math.abs(box.width / box.height - asset.width / asset.height) < 1e-8);
      assert.ok(Math.abs(box.top + asset.bounds[3] * box.height / asset.height - placement.anchorY * scale) < 1e-8);
      const visibleLeft = box.left + asset.bounds[0] * box.width / asset.width;
      const toyRight = (HOME_DOLL_PLACEMENT.x + HOME_DOLL_PLACEMENT.visibleWidth) * scale;
      assert.ok(visibleLeft - toyRight >= 15 * scale, `${asset.name} crowds toy`);
    }
  }
});
test('Home Toy placement preserves original canvas margins instead of normalizing narrow/wide/tall silhouettes',()=>{
 const assets=[{width:512,height:512,bounds:[106,13,406,512]},
  {width:512,height:512,bounds:[46,10,466,512]},
  {width:512,height:512,bounds:[180,100,320,490]}];
 for(const scale of [.35,.5,1]){
  const boxes=assets.map(asset=>homeAnchoredBox(asset,HOME_DOLL_PLACEMENT,scale));
  for(const box of boxes){assert.deepEqual(box,boxes[0]);assert.equal(box.width,box.height);
   assert.ok(Math.abs(box.top+box.height-HOME_DOLL_PLACEMENT.anchorY*scale)<1e-8);}
  const visibleWidths=assets.map((asset,i)=>(asset.bounds[2]-asset.bounds[0])*boxes[i].width/asset.width);
  assert.ok(Math.abs(visibleWidths[1]/visibleWidths[0]-420/300)<1e-8,'original width differences must remain');
 }
});
test('bookshelf gifts keep identical source-canvas placement without per-gift bounds normalization',()=>{
 const placement=HOME_ART_PLACEMENTS.find(p=>p.slot==='shelf_decor');
 for(const scale of [.35,.5,1]){
  const boxes=[[0,0,600,600],[230,70,370,540],[80,220,530,450]].map(bounds=>homeAnchoredBox({width:600,height:600,bounds},placement,scale));
  for(const box of boxes){assert.deepEqual(box,boxes[0]);assert.equal(box.width,89*1.2*scale);assert.equal(box.height,89*1.2*scale);
   assert.ok(Math.abs(box.left+box.width/2-616.5*scale)<1e-8);assert.ok(Math.abs(box.top+box.height-713*scale)<1e-8);}
 }
});

test('all decor variants use one category canvas scale instead of enlarging narrow silhouettes; defaults retain their geometry',()=>{
 const fs=require('node:fs'),path=require('node:path'),file='apps/mobile/src/lib/burrow-art-assets.ts';
 const {BURROW_ART,burrowArtForItem}=load(file,Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(m=>[m[2],path.resolve(path.dirname(file),m[2])])));
 const products=JSON.parse(fs.readFileSync('catalog/burrow-shop-products.json','utf8')).products;
 for(const placement of HOME_ART_PLACEMENTS){
  const assets=BURROW_ART[placement.category];assert.ok(assets?.length,placement.category);
  const first=assets[0],refWidth=first.bounds[2]-first.bounds[0];
  const all=[...assets,...products.filter(p=>p.category===placement.category&&p.status==='active').map(p=>burrowArtForItem({...p,stable_id:p.id,item_type:p.type},p.category)).filter(Boolean)];
  for(const scale of [.35,.5,1]){
   const baseline=homeAnchoredBox(first,placement,scale);
   if(placement.canvasWidth==null){
    const oldRatio=placement.visibleWidth/refWidth;
    assert.ok(Math.abs(baseline.width-first.width*oldRatio*scale)<1e-8,placement.category+' default width');
    assert.ok(Math.abs(baseline.left-(placement.x-first.bounds[0]*oldRatio)*scale)<1e-8,placement.category+' default x');
   }
   for(const asset of all){
    const box=homeAnchoredBox(asset,placement,scale);
    assert.ok(Math.abs(box.width-baseline.width)<1e-8,asset.name+' canvas width');
    assert.ok(Math.abs(box.left-baseline.left)<1e-8,asset.name+' canvas x');
    assert.ok(Math.abs(box.width/box.height-asset.width/asset.height)<1e-8,asset.name+' aspect');
    if(asset.height===first.height)assert.ok(Math.abs(box.height-baseline.height)<1e-8,asset.name+' same source height');
   }
  }
 }
});
