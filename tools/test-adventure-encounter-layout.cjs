const {presentationImports}=require('./motion-test-utils.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks } = require('./lifecycle-test-utils.cjs');
const bounds = require('../apps/mobile/src/lib/adventure-friend-bounds.json');
const model = load('apps/mobile/src/lib/adventure-encounter-layout.ts');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const jsx = (type, props) => ({ type, props });
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === 'object' ? [x, ...nodes(x.props?.children)] : [];
const style = x => Object.assign({}, ...(Array.isArray(x) ? x : [x]));

test('all 30 poses overlap exactly 15% of actual visible height across small/large displays', () => {
  for (const geometry of Object.values(bounds)) for (const width of [320, 390, 430]) for (const height of [380, 520, 700, 900]) {
    for (const answered of [false, true]) {
      const pose = geometry[answered ? 1 : 0];
      const l = model.adventureEncounterLayout(width, height, geometry, answered), scale = l.image.width / 768;
      const visibleHeight = (pose[3] - pose[1]) * scale;
      near((l.image.top + pose[3] * scale - l.panelTop) / visibleHeight, .15);
      assert.ok(l.visibleTop >= l.headingBottom - 1e-6, 'never cover the title');
      assert.ok(l.image.left + pose[0] * scale >= 0, 'visible shape stays inside left edge');
      assert.ok(l.image.left + pose[2] * scale <= width, 'visible shape stays inside right edge');
      assert.ok(l.panelHeight <= height * .48); assert.ok(l.panelHeight > 0);
      near(l.image.width, l.image.height);
    }
    const a = model.adventureEncounterLayout(width, height, geometry), b = model.adventureEncounterLayout(width, height, geometry, true);
    near(a.visibleHeight,b.visibleHeight); near(a.bodyCenterX,b.bodyCenterX); near(a.panelTop, b.panelTop);
  }
});

test('panel scales with screen height rather than current invitation/text/choice contents', () => {
  near(model.adventureEncounterLayout(390, 700).panelHeight, 280);
  near(model.adventureEncounterLayout(390, 900).panelHeight, 360);
  const small = model.adventureEncounterLayout(320, 520), large = model.adventureEncounterLayout(390, 700);
  assert.ok(small.image.height < large.image.height);
  const source = fs.readFileSync('apps/mobile/src/components/burrow/adventure-encounter-card.tsx', 'utf8');
  assert.doesNotMatch(source, /artStage|maxHeight: height \* .49/);
  assert.match(source, /<AdventureEncounterLayout friendName=\{friendName\} heading=\{meeting.heading\} answered=\{reaction !== null\}/);
  assert.match(source, /<FriendDialogue/, 'both friend flows share one centered prose/hint group');
});

test('the entire cast has equal visible height and torso centring without cropping arms or tails',()=>{
  assert.equal(model.FRIEND_SIZE_SCALE,.7);
  const anchors=require('../apps/mobile/src/lib/adventure-friend-body-anchors.json');
  for(const width of [320,390,430])for(const height of [380,520,700,900]){
    const target=model.adventureEncounterLayout(width,height,bounds.Arlo).visibleHeight;
    for(const[name,geometry]of Object.entries(bounds))for(const answered of [false,true]){
      const l=model.adventureEncounterLayout(width,height,geometry,answered),scale=l.image.width/768;
      near(l.visibleHeight,target);near(l.image.left+anchors[name][answered?1:0]*scale,width/2);
    }
  }
});

test('measured retained stage keeps title above the image and panel in front, with no delayed image transition', () => {
  const h = hooks();
  const { AdventureEncounterLayout } = load('apps/mobile/src/components/burrow/adventure-encounter-layout.tsx', {
    ...presentationImports(h),
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: x => x, absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) },
    '@/lib/adventure-encounter-layout': model,
    '@/lib/burrow-ui-assets': { burrowFriendArt: (_, answered) => answered ? 'pose-2' : 'pose-1', burrowFriendArtGeometry: () => bounds['Mr Mole'] },
    './burrow-image': { Image: 'Image' },
  });
  const render = (answered,heading='You met a new friend!') => h.render(() => AdventureEncounterLayout({ friendName: 'Mr Mole', heading, answered, children: 'dialogue' }));
  let tree = render(false), image = nodes(tree).find(n => n.type === 'Image');
  assert.equal(image.props.source, 'pose-1'); assert.equal(image.props.transition, 0);
  assert.equal(tree.props.children[1].props.children.props.children, 'You met a new friend!');
  assert.equal(tree.props.children[1].props.children.props.style.textAlign,'center');
  const returning=render(false,'You met Mr Mole again!');
  assert.equal(returning.props.children[1].props.children.props.style.textAlign,'center');
  const headingBox=style(returning.props.children[1].props.style);near(headingBox.left+headingBox.width/2,390/2);
  const firstHeight = style(tree.props.children[2].props.style).height;
  tree.props.onLayout({ nativeEvent: { layout: { width: 320, height: 500 } } }); tree = render(false);
  const panel = style(tree.props.children[2].props.style); near(panel.height, 220); assert.equal(panel.bottom, 0);
  assert.equal(tree.props.children[0].props.pointerEvents, 'none'); assert.equal(tree.props.children[1].type, 'Reveal');
  assert.equal(tree.props.children[2].props.children.props.children, 'dialogue');
  tree = render(true); image = nodes(tree).filter(n => n.type === 'Image').at(-1);
  assert.equal(image.props.source, 'pose-2'); near(style(tree.props.children[2].props.style).height, panel.height);
  assert.notEqual(firstHeight, panel.height); h.unmount();
});

test('metadata covers each bundled friend pair and legacy names resolve to the same measured silhouette', () => {
  const source = fs.readFileSync('apps/mobile/src/lib/burrow-ui-assets.ts', 'utf8');
  const imports = Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m => [m[2], m[2]]));
  imports['./adventure-friend-bounds.json'] = bounds;
  const api = load('apps/mobile/src/lib/burrow-ui-assets.ts', imports);
  assert.equal(Object.keys(api.BURROW_FRIEND_ART).length, Object.keys(bounds).length);
  for (const name of Object.keys(api.BURROW_FRIEND_ART)) assert.equal(api.burrowFriendArtGeometry(name), bounds[name]);
  assert.equal(api.burrowFriendArtGeometry('Mr Hedgehog'), bounds.Pickles);
  assert.equal(api.burrowFriendArtGeometry('Miss Armadillo'), bounds.Dillon);
});
test('all visit phases retain the same panel and actor geometry as Adventure',()=>{
 for(const width of [320,390,430,768])for(const height of [380,520,700,900])for(const mode of ['visit-invite','visit-quiet']){
  for(const geometry of Object.values(bounds))for(const answered of [false,true]){
   const l=model.adventureEncounterLayout(width,height,geometry,answered,mode),pose=geometry[answered?1:0],scale=l.image.width/768;
   assert.deepEqual(l,model.adventureEncounterLayout(width,height,geometry,answered));
   assert.ok(l.panelHeight<height);assert.ok(l.panelHeight>0);assert.ok(l.visibleTop>=l.headingBottom);
   near((l.image.top+pose[3]*scale-l.actorPanelTop)/((pose[3]-pose[1])*scale),.15);
  }
 }
 assert.equal(model.adventureEncounterLayout(390,700,undefined,false,'visit-invite').panelHeight,model.adventureEncounterLayout(390,700,undefined,false,'visit-quiet').panelHeight);
});
test('first visitor tap and every dialogue phase keep both actor poses at exactly the same scale and coordinates',()=>{
 for(const geometry of Object.values(bounds))for(const width of [320,390,430,768])for(const height of [380,520,700,900]){
  for(const answered of [false,true]){
   const invite=model.adventureEncounterLayout(width,height,geometry,answered,'visit-invite');
   const dialogue=model.adventureEncounterLayout(width,height,geometry,answered,'dialogue');
   assert.deepEqual(invite.image,dialogue.image);assert.equal(invite.headingBottom,dialogue.headingBottom);
   assert.equal(invite.actorPanelTop,dialogue.actorPanelTop);
  }
  near(model.adventureEncounterLayout(width,height,geometry,false,'visit-invite').visibleHeight,
   model.adventureEncounterLayout(width,height,geometry,true,'dialogue').visibleHeight);
 }
});

test('offline alpha metadata matches the actual WebP outlines; no stale/hand-guessed bounds', async () => {
  const { default: sharp } = await import('../node_modules/.pnpm/sharp@0.35.0/node_modules/sharp/dist/index.mjs');
  const source = fs.readFileSync('apps/mobile/src/lib/burrow-ui-assets.ts', 'utf8');
  for (const [name, geometry] of Object.entries(bounds)) {
    const row = source.split('\n').find(line => line.startsWith(`  "${name}":`));
    const files = [...row.matchAll(/require\("([^\"]+)"\)/g)].map(m => m[1]);
    for (let pose = 0; pose < files.length; pose++) {
      const { data, info } = await sharp(require('node:path').resolve('apps/mobile/src/lib', files[pose])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 768); assert.equal(info.height, 768);
      let left = 768, top = 768, right = 0, bottom = 0;
      for (let y = 0; y < 768; y++) for (let x = 0; x < 768; x++) if (data[(y * 768 + x) * 4 + 3] > 16) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      assert.deepEqual([left, top, right, bottom], geometry[pose], `${name} pose ${pose}`);
    }
  }
});
