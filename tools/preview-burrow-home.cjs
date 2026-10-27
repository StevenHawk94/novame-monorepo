// Offline layout proof using the SAME asset registry and anchor calculations
// as Home/Shop. This is art QA, not a substitute for device interaction tests.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { load } = require('./lifecycle-test-utils.cjs');
const registryPath = 'apps/mobile/src/lib/burrow-art-assets.ts';
const imports = Object.fromEntries([...fs.readFileSync(registryPath, 'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(match => [match[2], path.resolve(path.dirname(registryPath), match[2])]));
const { BURROW_ART, BURROW_FIXED_ART, HOME_BACKGROUND_FLOOR, HOME_WINDOW_LANDSCAPES } = load(registryPath, imports);
const layout = load('apps/mobile/src/lib/burrow-home-layout.ts');
const rig = require('../apps/mobile/src/lib/bunny-rig.json');
const motion = load('apps/mobile/src/lib/bunny-idle-motion.ts', {
  './bunny-rig.json': rig, './bunny-motion.json': require('../apps/mobile/src/lib/bunny-motion.json'),
});
const outfitRegistry = 'apps/mobile/src/lib/burrow-outfit-assets.ts';
const outfitImports = Object.fromEntries([...fs.readFileSync(outfitRegistry, 'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(match => [match[2], path.resolve(path.dirname(outfitRegistry), match[2])]));
const { OUTFIT_LAYERS } = load(outfitRegistry, outfitImports);
const layers = [];
const add = (asset, box) => layers.push({ file: asset.source, ...box });
add(BURROW_ART.wallpapers[0], { left: 0, top: 50, width: 900, height: 1200 });
const background=layout.homeBackgroundLayout();
for(const [asset,box] of [[HOME_BACKGROUND_FLOOR,background.floor],[BURROW_ART.backgrounds[0],background.rim]])
 add(asset,{left:box.x,top:box.y,width:box.width,height:box.height});
for (const placement of layout.HOME_ART_PLACEMENTS) {
  const asset = BURROW_ART[placement.category][0];
  if(placement.category==='windows') add({source:HOME_WINDOW_LANDSCAPES.autumn.day},layout.homeAnchoredBox(asset,placement,1));
  add(asset, layout.homeAnchoredBox(asset, placement, 1));
}
// Match StaticOutfitBunny: same five full-canvas layers, draw order and uniform
// viewport transform as the app. Never restore the retired flattened rabbit.
const bunnyBox = motion.homeBunnyBox(1), fit = motion.bunnyViewport(bunnyBox.width, bunnyBox.height);
for (const layer of rig.drawOrderBottomToTop) {
  add({ source: OUTFIT_LAYERS.default[layer] }, {
    left: bunnyBox.left + fit.x, top: bunnyBox.top + fit.y,
    width: rig.sourceCanvas.width * fit.scale, height: rig.sourceCanvas.height * fit.scale,
  });
}
add(BURROW_ART.frames[0], layout.homeAnchoredBox(BURROW_ART.frames[0], layout.HOME_FRAME_PLACEMENT, 1));
add(BURROW_ART.couple_dolls[0], layout.homeAnchoredBox(BURROW_ART.couple_dolls[0], layout.HOME_DOLL_PLACEMENT, 1));
add(BURROW_FIXED_ART.letter, layout.homeAnchoredBox(BURROW_FIXED_ART.letter, layout.HOME_LETTER_PLACEMENT, 1));
const output = process.argv[2] ?? '/private/tmp/burrow-home-default-preview.png';
const result = spawnSync('python3', ['-c', `
import json,sys
from PIL import Image
layers=json.load(sys.stdin)
canvas=Image.new('RGBA',(900,1950),'#FFF2DF')
for layer in layers:
 image=Image.open(layer['file']).convert('RGBA').resize((round(layer['width']),round(layer['height'])),Image.Resampling.LANCZOS)
 canvas.alpha_composite(image,(round(layer['left']),round(layer['top'])))
canvas.convert('RGB').save(sys.argv[1])
`, output], { input: JSON.stringify(layers), encoding: 'utf8' });
if (result.status) throw new Error(result.stderr);
console.log(output);
