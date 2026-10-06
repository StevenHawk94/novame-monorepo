const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks } = require('./lifecycle-test-utils.cjs');

const warp = load('apps/mobile/src/lib/burrow-toy-warp.ts');

test('Toy source has transparent pull padding and local influence stops at circle edge', () => {
  assert.ok(warp.TOY_TEXTURE_PADDING >= 60 && warp.TOY_TEXTURE_PADDING <= 80);
  assert.equal(warp.toyInfluence(0, 100), 1);
  assert.ok(warp.toyInfluence(50, 100) > 0 && warp.toyInfluence(50, 100) < 1);
  assert.equal(warp.toyInfluence(100, 100), 0);
  assert.equal(warp.toyInfluence(130, 100), 0);
});

test('Toy pull never exceeds fifteen percent of head width', () => {
  const headWidth = 200;
  const gentle = warp.clampToyPull(12, 0, headWidth);
  assert.equal(gentle.x, 12);
  assert.equal(gentle.y, 0);
  const pull = warp.clampToyPull(120, 160, headWidth);
  assert.ok(Math.hypot(pull.x, pull.y) <= headWidth * .15 + 1e-8);
  assert.ok(pull.y > pull.x);
});

test('squeeze halves the whole toy width; punch compresses only the head by twenty percent', () => {
  for (const scale of [.3, .7, 1]) {
    const center = { x: 380 * scale, y: 616 * scale }, neck = 627 * scale, blend = 40 * scale;
    // An output half as far from the center maps back to the original pixel.
    const squeezed = warp.toyActionSamplePoint(center.x + 100 * scale, center.y, 'squeeze', 1, center, neck, blend);
    assert.ok(Math.abs(squeezed.x - (center.x + 200 * scale)) < 1e-8);
    const headTop = 175 * scale;
    const loweredTop = neck + (headTop - neck) * .8;
    assert.ok(Math.abs(warp.toyActionSamplePoint(center.x, loweredTop, 'punch', 1, center, neck, blend).y - headTop) < 1e-8);
    for (const y of [neck, neck + 80 * scale, neck + 160 * scale]) {
      assert.equal(warp.toyActionSamplePoint(center.x, y, 'punch', 1, center, neck, blend).y, y);
    }
  }
});

function toyHarness() {
  const h = hooks(), shared = [], animations = [], feedback = [], cancelled = [];
  let handler, interactions = 0;
  const sequence = (...steps) => { const result = { kind: 'sequence', steps }; animations.push(result); return result; };
  const { LocalizedToy } = load('apps/mobile/src/components/burrow/localized-toy.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx: (type, props) => ({type,props}), jsxs: (type, props) => ({type,props}) },
    'react-native': { View: 'View', PanResponder: { create: input => { handler = input; return {panHandlers:{}}; } },
      StyleSheet: { create: x => x, flatten: x => x, absoluteFillObject: {} } },
    './burrow-image': { Image: 'Image', resolveBurrowImageSource: x => x },
    '@shopify/react-native-skia': { Skia: { RuntimeEffect: { Make: () => ({}) } }, useCanvasRef: () => ({current:null}), useImage: () => null },
    'react-native-reanimated': { default: { View: 'AnimatedView' }, useSharedValue: initial => {
      const value = h.react.useRef(null); if (!value.current) { value.current = {value:initial}; shared.push(value.current); } return value.current;
    }, useDerivedValue: fn => fn, useAnimatedStyle: fn => fn, withSequence: sequence,
      withTiming: (value, config) => ({kind:'timing',value,...config}), withSpring: (value, config) => ({kind:'spring',value,...config}),
      cancelAnimation: value => cancelled.push(value) },
    'react-native-svg': { default: 'Svg', Circle: 'Circle' },
    '@/lib/burrow-doll-face': { dollFaceBounds: () => [162,267,437,519], dollFaceRect: () => ({}) },
    '@/lib/haptics': { haptics: { light: () => feedback.push('light'), medium: () => feedback.push('medium') } },
    '@/lib/session-lifecycle': { subscribeSessionIdentity() {} }, '@/lib/burrow-toy-warp': warp,
    './room-photo': { RoomPhoto: 'Photo', useRoomPhotoUri: () => null },
    './interactive-doll': { FloatingHeart: 'Heart', InteractiveDoll: 'Fallback' },
  });
  const onInteract = () => interactions++;
  const asset = {source:1,width:600,height:800,bounds:[98,95,500,800]};
  const render = action => h.render(() => LocalizedToy({ asset, size:350, artStyle:{left:0,top:0,width:300,height:400},
    action,showInfluence:false,onInteract }));
  render();
  return { render, shared, animations, feedback, cancelled, h, get handler() { return handler; }, get interactions() { return interactions; } };
}

test('body taps wobble once; local drags keep their old influence and do not become taps', () => {
  const t = toyHarness();
  t.handler.onPanResponderGrant({nativeEvent:{locationX:150,locationY:200}});
  t.handler.onPanResponderRelease();
  assert.deepEqual(t.animations.at(-1).steps.map(s => s.value), [.9,-.7,.45,-.2,0]);
  assert.equal(t.interactions,1);
  t.animations.length = 0;
  t.handler.onPanResponderGrant({nativeEvent:{locationX:150,locationY:200}});
  t.handler.onPanResponderMove(null,{dx:120,dy:160});
  assert.ok(Math.hypot(t.shared[3].value,t.shared[4].value)<=275*.5*.15+1e-8);
  t.handler.onPanResponderRelease();
  assert.equal(t.animations.length,0);
  assert.equal(t.interactions,2);
  t.handler.onPanResponderGrant({nativeEvent:{locationX:150,locationY:200}});
  t.handler.onPanResponderTerminate();
  assert.equal(t.interactions,2);
});

test('each button restarts its impact immediately, independently of last drag, with punch shake', () => {
  const t = toyHarness();
  t.render({kind:'squeeze',token:1});
  assert.equal(t.shared[5].value,1);
  assert.deepEqual(t.shared[6].value.steps.map(s=>s.value),[1,1,0]);
  assert.equal(t.shared[6].value.steps[0].duration,240);
  t.render({kind:'punch',token:2});
  assert.equal(t.shared[5].value,2);
  assert.equal(t.shared[6].value.steps[0].duration,55);
  assert.ok(t.shared[8].value.steps.some(s=>s.value<0));
  assert.ok(t.shared[8].value.steps.some(s=>s.value>0));
  assert.equal(t.shared[3].value,0); assert.equal(t.shared[4].value,0);
  const firstImpact = t.shared[6].value;
  t.render({kind:'punch',token:3});
  assert.notEqual(t.shared[6].value,firstImpact);
  assert.deepEqual(t.feedback,['light','medium','medium']);
  t.h.unmount(); assert.equal(t.cancelled.length,6);
});

test('native-view fallback also wobbles, squeezes by fifty percent and punches the head without separating the photo', () => {
  const h=hooks(), started=[];
  class Value {
    constructor(value){this.value=value;}
    setValue(value){this.value=value;}
    stopAnimation(){}
    interpolate(config){return {value:this,...config};}
  }
  class ValueXY extends Value {constructor(){super({x:0,y:0});this.x=new Value(0);this.y=new Value(0);}}
  const animation=(kind,...args)=>({kind,args,start(){started.push({kind,args});}});
  const Animated={Value,ValueXY,View:'AnimatedView',Text:'AnimatedText',
    timing:(...args)=>animation('timing',...args),spring:(...args)=>animation('spring',...args),delay:(...args)=>animation('delay',...args),
    sequence:steps=>animation('sequence',steps),parallel:steps=>animation('parallel',steps),add:(...args)=>({add:args}),multiply:(...args)=>({multiply:args})};
  const {InteractiveDoll}=load('apps/mobile/src/components/burrow/interactive-doll.tsx',{
    react:h.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-native':{Animated,View:'View',Pressable:'Pressable',Text:'Text',PanResponder:{create:()=>({panHandlers:{}})},StyleSheet:{create:x=>x,flatten:x=>x,absoluteFillObject:{}}},
    './burrow-image':{Image:'Image'},'./room-photo':{RoomPhoto:'Photo'},
    '@/lib/burrow-doll-face':{dollFaceBounds:()=>[162,267,437,519],dollFaceRect:()=>({left:'27%',top:'33%',width:'46%',height:'32%'})},
    '@/lib/burrow-toy-warp':warp,'@/lib/haptics':{haptics:{light(){},medium(){}}},
  });
  const props={asset:{source:1,width:600,height:800},photo:{id:'photo'},style:{width:350,height:350},artStyle:{left:0,top:0,width:300,height:400}};
  const render=action=>h.render(()=>InteractiveDoll({...props,action}));
  const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
  const root=render();root.props.onPressIn();root.props.onPress();
  assert.ok(started.some(a=>a.kind==='sequence'&&a.args[0].some(s=>s.args?.[1]?.toValue===-.7)));
  const tree=render({kind:'squeeze',token:1});
  const whole=nodes(tree).find(n=>n.type==='AnimatedView'&&Array.isArray(n.props.style));
  const transform=whole.props.style[1].transform;
  assert.deepEqual(Array.from(transform.find(s=>s.scaleX).scaleX.multiply[1].outputRange),[1,.5]);
  const head=nodes(tree).find(n=>n.type==='AnimatedView'&&n.props.style?.height);
  assert.deepEqual(Array.from(head.props.style.transform[1].scaleY.outputRange),[1,.8]);
  assert.ok(Math.abs(head.props.style.transform[0].translateY.outputRange[1]-head.props.style.height*.1)<1e-8);
  const photo=nodes(head).find(n=>n.type==='Photo');assert.ok(photo);
  assert.equal(head.props.children.props.children[0].props.style.some(s=>s.transform),false);
  render({kind:'punch',token:2});
  assert.ok(started.some(a=>a.kind==='parallel'&&a.args[0].some(s=>s.kind==='sequence'&&s.args[0].some(t=>t.args?.[1]?.toValue===-1))));
  h.unmount();
});

test('Toy local-warp shader compiles against the installed Skia runtime', async () => {
  const { LoadSkiaWeb } = require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
  const { getSkiaExports } = require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/headless');
  await LoadSkiaWeb();
  assert.ok(getSkiaExports().Skia.RuntimeEffect.Make(warp.TOY_WARP_SKSL));
});

test('rendered Skia pixels confirm half-width squeeze and a stationary torso during punch', async () => {
  const { LoadSkiaWeb } = require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
  const { getSkiaExports, TileMode, FilterMode, MipmapMode } = require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/headless');
  await LoadSkiaWeb();
  const { Skia } = getSkiaExports();
  const source = Skia.Surface.MakeOffscreen(760,960), paint=Skia.Paint();
  source.getCanvas().clear(Skia.Color('transparent'));
  paint.setColor(Skia.Color('#ff0000')); source.getCanvas().drawRect({x:180,y:160,width:400,height:400},paint);
  paint.setColor(Skia.Color('#0000ff')); source.getCanvas().drawRect({x:180,y:640,width:400,height:160},paint);
  source.flush(); const image=source.makeImageSnapshot();
  const child=image.makeShaderOptions(TileMode.Decal,TileMode.Decal,FilterMode.Nearest,MipmapMode.None);
  const effect=Skia.RuntimeEffect.Make(warp.TOY_WARP_SKSL);
  const render=action=>{
    const surface=Skia.Surface.MakeOffscreen(760,960), brush=Skia.Paint();
    brush.setShader(effect.makeShaderWithChildren([380,360,0,0,100,action,1,380,616,600,40],[child]));
    surface.getCanvas().drawPaint(brush); surface.flush(); return surface.makeImageSnapshot().readPixels();
  };
  const squeeze=render(1), punch=render(2);
  const pixel=(bytes,x,y)=>Array.from(bytes.slice((y*760+x)*4,(y*760+x)*4+4));
  const occupied=(bytes,y)=>Array.from({length:760},(_,x)=>x).filter(x=>pixel(bytes,x,y)[3]>0);
  assert.equal(occupied(squeeze,400).length,200);
  const headRows=Array.from({length:600},(_,y)=>y).filter(y=>pixel(punch,380,y)[0]>200);
  assert.ok(Math.abs(headRows[0]-248)<=1); // 600 - (600-160) * .8
  for(const [x,y] of [[180,640],[380,700],[579,799]]) assert.deepEqual(pixel(punch,x,y),[0,0,255,255]);
});
