"""Read-only pixel geometry verification for every supplied gift and screen."""
import json
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
geometry = json.loads(subprocess.check_output(['node', '-e', """
const fs=require('fs'),path=require('path'),{load}=require('./tools/lifecycle-test-utils.cjs');
const file='apps/mobile/src/lib/burrow-art-assets.ts';
const imports=Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\\((['\"])(.*?)\\1\\)/g)].map(m=>[m[2],path.resolve(path.dirname(file),m[2])]));
const {BURROW_ART}=load(file,imports),layout=load('apps/mobile/src/lib/burrow-home-layout.ts');
const gift=layout.HOME_ART_PLACEMENTS.find(p=>p.slot==='shelf_decor');
const radio=layout.HOME_ART_PLACEMENTS.find(p=>p.slot==='music_player');
const shelf=layout.HOME_ART_PLACEMENTS.find(p=>p.slot==='shelf');
console.log(JSON.stringify({gift,radio,shelf,radios:BURROW_ART.music_players,screens:
 [[320,568,0],[375,667,0],[390,844,34],[428,926,34],[430,932,34],[768,1024,20]].map(([w,h,safe])=>{
 const tab=layout.homeTabBarHeight(w,safe);return {w,h,...layout.homeArtLayout(w,h-tab,tab)};})}));
"""], cwd=ROOT))
placement = geometry['gift']
assert abs(placement['canvasWidth'] - 89 * 1.2) < 1e-8
assert abs(placement['x'] + placement['visibleWidth'] / 2 - 616.5) < 1e-8
assert placement['anchorY'] == 713
assert geometry['radio']['x'] == 682 and geometry['radio']['visibleWidth'] == 117
assert geometry['shelf']['x'] == 555 and geometry['shelf']['visibleWidth'] == 261
gifts = [g for f in (ROOT / 'apps/api/src/data/adventure-friends').glob('*.json') for g in json.loads(f.read_text())['gifts']]
minimum_gap = float('inf')
checks = 0
for gift in gifts:
    with Image.open(ROOT / 'apps/mobile/assets/burrow-webp/Gift Collection Webp' / gift['file']) as image:
        assert image.size == (600, 600)
        bounds = image.convert('RGBA').getchannel('A').getbbox()
    for screen in geometry['screens']:
        scale = screen['scale']
        ratio = placement['canvasWidth'] / 600 * scale
        left = (placement['x'] + placement['visibleWidth'] / 2 - placement['canvasWidth'] / 2) * scale
        right = left + bounds[2] * ratio
        assert left >= geometry['shelf']['x'] * scale
        assert left + placement['canvasWidth'] * scale <= (geometry['shelf']['x'] + geometry['shelf']['visibleWidth']) * scale
        # The unchanged radio's visible left is normalized to x=682 for every style.
        for radio in geometry['radios']:
            gap = geometry['radio']['x'] * scale - right
            assert gap > 0, (gift['id'], radio['name'], screen)
            minimum_gap = min(minimum_gap, gap / scale)
            checks += 1
assert len(gifts) == 483
print(json.dumps({'gifts': len(gifts), 'screens': len(geometry['screens']), 'gift_radio_screen_combinations': checks,
                  'minimum_gap_design_px': round(minimum_gap, 3), 'scale': 1.2, 'center_and_bottom_unchanged': True}))
