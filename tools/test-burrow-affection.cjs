const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, clock } = require('./lifecycle-test-utils.cjs');

test('all six Affection icons use the replacement WebPs with exact filename casing, including Miss You',()=>{
  const registry='apps/mobile/src/lib/burrow-ui-assets.ts';
  const source=fs.readFileSync(registry,'utf8');
  const imports=Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(match=>[match[2],match[2]]));
  imports['./adventure-friend-bounds.json']={};
  const icons=load(registry,imports).BURROW_AFFECTION_ICONS;
  const expected={hug:'Hug.webp',kiss:'Kiss.webp',cuddle:'Cuddle.webp',spicy:'Spicy.webp',miss_you:'Miss You.webp',gratitude:'Gratitude.webp'};
  for(const [type,file] of Object.entries(expected)){
    assert.equal(path.basename(icons[type]),file);
    const absolute=path.resolve(path.dirname(registry),icons[type]);
    assert.ok(fs.readdirSync(path.dirname(absolute)).includes(file),'case-sensitive Metro path: '+file);
  }
  const hub=fs.readFileSync('apps/mobile/src/components/burrow/affection-hub.tsx','utf8');
  assert.equal([...hub.matchAll(/source=\{BURROW_AFFECTION_ICONS\[type\]\}/g)].length,2,'selection and receipt both use supplied art');
  assert.doesNotMatch(hub,/MissYouIcon|react-native-svg/,'legacy SVG must not override the new Miss You icon');
});

function harness(type = 'kiss') {
  const h = hooks(), time = clock(), calls = [], hapticCalls = [], springs = [];
  let handlers, appListener, tick, focused = true, status = 'ready', done = 0;
  const app = { currentState: 'active', addEventListener: (_name, fn) => {
    appListener = fn; return { remove() {} };
  } };
  const jsx = (kind, props) => ({ type: kind, props });
  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate() { return this.value; }
  }
  const Animated = { Value: AnimatedValue, View: 'AnimatedView', Text: 'AnimatedText',
    spring: (value, config) => {
      const spring = { value, config, starts: 0, start() { this.starts++; }, stop() {} };
      springs.push(spring); return spring;
    },
    timing: () => ({ start() {}, stop() {} }),
    parallel: () => ({ start() {}, stop() {} }),
  };
  const motion = require('./motion-test-utils.cjs').motionHarness(h,time);
  const { AffectionGesture, HEART_TRACE_POINTS, kissArtScale, cuddleFill, hugArtPose } = load('apps/mobile/src/components/burrow/affection-gesture.tsx', {
    './burrow-image':{Image:'Image'},
    '../../../assets/burrow-webp/affection page icons/finger.webp':'finger.webp',
    './affection-sent-visual':{AffectionSentVisual:function AffectionSentVisual(){}},
    'react-native-reanimated':motion.reanimated,
    react: { ...h.react, useMemo: fn => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
      AppState: app,
      PanResponder: { create: value => { handlers = value; return { panHandlers: value }; } },
      Animated,
      Pressable: 'Button', Text: 'Text', View: 'View',
      StyleSheet: { create: value => value, absoluteFillObject: {} },
    },
    '@react-navigation/native': { useIsFocused: () => focused },
    '@/lib/haptics': { haptics: Object.fromEntries(['light', 'medium', 'selection', 'success'].map(name =>
      [name, async () => { hapticCalls.push(name); }])) },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-svg': { default: 'Svg', Circle: 'Circle', ClipPath: 'ClipPath', Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', LinearGradient: 'LinearGradient', Path: 'Path', RadialGradient: 'RadialGradient', Rect: 'Rect', Stop: 'Stop' },
  }, {
    ...time.globals,
    performance: { now: () => time.globals.Date.now() },
    setInterval: fn => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
  });
  const render = () => h.render(() => AffectionGesture({ type, disabled: status !== 'ready', status,
    recipientName: 'Alex', onComplete: metrics => calls.push(metrics), onDone: () => done++ }));
  function find(node, label) {
    if (!node) return;
    if (Array.isArray(node)) return node.map(child => find(child, label)).find(Boolean);
    if (node.props?.accessibilityLabel === label) return node;
    return find(node.props?.children, label);
  }
  const labels = {
    hug: 'Press and hold until the hearts meet', spicy: 'Tap ten times', cuddle: 'Sway left and right ten times',
    gratitude: 'Pinch two fingers in and hold', kiss: 'Spread two fingers apart and hold',
    miss_you: 'Draw a heart in one stroke',
  };
  return {
    calls, hapticCalls, springs, motion, heartPoints: HEART_TRACE_POINTS, kissArtScale, cuddleFill, hugArtPose, render, done: () => done, setStatus(value) { status = value; }, handlers: () => handlers,
    advance(ms) {
      while (ms > 0) {
        const step = Math.min(40, ms);
        time.advance(step);
        tick?.();
        ms -= step;
      }
    },
    activateGesture() {
      const node = find(render(), `${labels[type]}. Gesture area.`);
      assert.ok(node); node.props.onAccessibilityAction();
    },
    tapSpark() { const node = find(render(), 'Tap to add a spark'); assert.ok(node); node.props.onPress(); },
    background() { app.currentState = 'background'; appListener('background'); },
    blur() { focused = false; render(); },
  };
}

function renderedText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  return renderedText(node.props?.children);
}

function hasComponent(node, name) {
  if (node == null) return false;
  if (Array.isArray(node)) return node.some(child => hasComponent(child, name));
  return node.type?.name === name || hasComponent(node.props?.children, name);
}

test('each card keeps its heading, instruction and footer visible', () => {
  const copy = {
    kiss: ['Make Your Kiss Bigger', 'Spread two fingers apart and hold', 'Hold for 3 seconds'],
    hug: ['Hold Your Hug Close', 'Press and hold until the hearts meet', 'Hold for 3 seconds'],
    spicy: ['Turn Up the Heat', 'Tap ten times', 'Sends on the 10th tap'],
    cuddle: ['Rock It Into a Cuddle', 'Sway left and right ten times', 'Sends after the tenth sway'],
    gratitude: ['Bring Your Thanks Together', 'Pinch two fingers in and hold', 'Hold for 3 seconds'],
    miss_you: ['Trace the Distance Closed', 'Draw a heart in one stroke', 'Lift to send when complete'],
  };
  for (const [type, captions] of Object.entries(copy)) {
    const h = harness(type);
    const text = renderedText(h.render());
    for (const caption of captions) assert.ok(text.includes(caption), `${type}: ${caption}`);
  }
});

test('all six first-use demos share supplied finger.webp, preserving aspect and mirrored two-finger poses',()=>{
  const file='apps/mobile/src/components/burrow/affection-gesture.tsx',source=fs.readFileSync(file,'utf8');
  const asset=source.match(/const GESTURE_FINGER=require\('([^']+)'\)/)[1];
  assert.ok(fs.existsSync(path.resolve(path.dirname(file),asset)));
  const hand=source.slice(source.indexOf('function Finger('),source.indexOf('// Start the contour'));
  assert.match(hand,/<Image source=\{GESTURE_FINGER\}/);assert.match(hand,/contentFit="contain"/);
  assert.match(hand,/width:76,height:114/);assert.equal(76/114,200/300);
  assert.match(hand,/scaleX:flip\?-1:1/);assert.doesNotMatch(hand,/<Path|<Ellipse|<Svg/);
  const demo=source.slice(source.indexOf('function GestureDemo('),source.indexOf('function TapSparks('));
  assert.match(demo,/<Finger flip=\{flip\}/);
  for(const type of ['gratitude','kiss','cuddle','miss_you'])assert.ok(demo.includes(`type === '${type}'`));
  assert.match(demo,/finger\('press', 0, tap\)/,'Hug and Spicy share the same replacement');
  assert.match(demo,/left:flip\?-53:-23,top:-10/,'all six motions anchor at the fingertip, not the image centre');
  assert.match(demo,/finger\('left', inward, 0, true\)/);assert.match(demo,/finger\('right', inwardRight, 0\)/);
  assert.match(demo,/finger\('left', outward, 0, true\)/);assert.match(demo,/finger\('right', outwardRight, 0\)/);
});

test('sending keeps the final gesture card in place during delivery', () => {
  const h = harness('kiss');
  h.render();
  h.setStatus('sending');
  const text = renderedText(h.render());
  assert.match(text, /Make Your Kiss Bigger/);
  assert.doesNotMatch(text, /Kiss Sent|Sending/);
});

test('Kiss and Cuddle gesture arrows disappear as soon as interaction starts', () => {
  for (const type of ['kiss', 'cuddle']) {
    const h = harness(type);
    assert.equal(hasComponent(h.render(), 'GestureGuides'), true, type);
    h.handlers().onPanResponderGrant({ nativeEvent: { touches: [] } });
    assert.equal(hasComponent(h.render(), 'GestureGuides'), false, type);
  }
});

test('each completed gesture has its own recipient-specific Sent copy', () => {
  const copy = {
    kiss: ['Kiss Sent', 'Your kiss is on its way to Alex.'],
    hug: ['Hug Sent', 'Your arms are wrapped around Alex right now.'],
    spicy: ['Spice Sent', 'Ten sparks are flying over to Alex.'],
    cuddle: ['Cuddle Sent', 'All that warmth is heading to Alex.'],
    gratitude: ['Gratitude Sent', "Your thanks is in Alex's hands now."],
    miss_you: ['Miss You Sent', 'Alex will know you were thinking of them.'],
  };
  for (const [type, captions] of Object.entries(copy)) {
    const h = harness(type);
    h.setStatus('sent');
    const text = renderedText(h.render());
    for (const caption of captions) assert.ok(text.includes(caption), `${type}: ${caption}`);
    assert.match(text, /Done/);
  }
});

test('accessible affection still requires three seconds', () => {
  const h = harness();
  h.activateGesture();
  h.advance(2999);
  assert.equal(h.calls.length, 0);
  h.advance(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].assistedHoldMs, 3000);
});

test('all six Sent Done buttons depress on touch, restore on release/cancel, and keep the original exit callback', () => {
  const findDone = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.map(findDone).find(Boolean);
    if (node.type === 'Button' && renderedText(node) === 'Done') return node;
    return findDone(node.props?.children);
  };
  for (const type of ['kiss', 'hug', 'spicy', 'cuddle', 'gratitude', 'miss_you']) {
    const h = harness(type); h.setStatus('sent');
    const button = findDone(h.render()); assert.ok(button, type);
    const style = pressed => Object.assign({}, ...button.props.style({pressed}).filter(Boolean));
    const idle = style(false), down = style(true), released = style(false);
    assert.equal(idle.shadowOffset.height,3.5,'Done shadow is half its old 7px height');
    assert.equal(down.transform[0].translateY, 2.5, type);
    assert.equal(down.transform[0].translateY + down.shadowOffset.height, idle.shadowOffset.height, 'shadow base stays fixed');
    assert.equal(down.minHeight, idle.minHeight, 'press feedback does not reflow the Sent page');
    assert.deepEqual(released, idle); assert.equal(h.done(), 0, 'press/cancel feedback never navigates');
    button.props.onPress(); assert.equal(h.done(), 1); assert.equal(h.calls.length, 0, 'Done cannot resend affection');
  }
});
test('a completed hold yields its responder to Sent Done; the decorative gradient cannot intercept taps',()=>{
 const h=harness('hug');h.activateGesture();assert.equal(h.handlers().onPanResponderTerminationRequest(),false);
 const old=h.handlers();h.advance(3000);assert.equal(old.onPanResponderTerminationRequest(),true,'completed pad must release even before finger-up');
 h.setStatus('sent');const tree=h.render();assert.equal(old.onPanResponderTerminationRequest(),true);
 const all=t=>Array.isArray(t)?t.flatMap(all):t&&typeof t==='object'?[t,...all(t.props?.children)]:[];
 const list=all(tree);assert.equal(list.find(n=>n.type==='LinearGradient').props.pointerEvents,'none');
 assert.equal(list.some(n=>n.props?.onStartShouldSetPanResponder),false,'Sent mounts no gesture pad');
 assert.ok(list.some(n=>n.props?.collapsable===false&&n.props.style.zIndex===1),'success has its own foreground native view');
});

test('ten spicy taps send on the completed visual frame, with one final success haptic', () => {
  const h = harness('spicy');
  for (let i = 0; i < 9; i++) h.tapSpark();
  assert.equal(h.calls.length, 0);
  h.tapSpark();
  assert.equal(h.calls.length, 0);
  h.advance(80);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].taps, 10);
  assert.equal(h.hapticCalls.filter(value => value === 'light').length, 9);
  assert.equal(h.hapticCalls.at(-1),'success');
});

test('background cancels an accessible gesture', () => {
  const h = harness();
  h.activateGesture();
  h.background();
  h.render();
  h.advance(10000);
  assert.equal(h.calls.length, 0);
});

test('background or blur prevents an old hold release from completing', () => {
  for (const change of ['background', 'blur']) {
    const h = harness('hug');
    h.render();
    h.handlers().onPanResponderGrant({ nativeEvent: { touches: [] } });
    h.advance(2000);
    h[change]();
    h.handlers().onPanResponderRelease();
    h.advance(5000);
    assert.equal(h.calls.length, 0);
  }
});

test('hug sends after a continuous three-second hold', () => {
  const h = harness('hug'); h.render();
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: [] } });
  h.advance(2999); assert.equal(h.calls.length, 0);
  h.advance(1); assert.equal(h.calls.length, 1);
  assert.ok(h.hapticCalls.filter(value => value === 'selection').length >= 10);
});

test('cuddle counts the first valid stroke, fills on the tenth, then sends exactly once', () => {
  const h = harness('cuddle'); h.render();
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: [{}] } });
  for (let i = 0; i < 9; i++) {
    h.handlers().onPanResponderMove({ nativeEvent: { touches: [{}] } }, { dx: i % 2 ? -40 : 40 });
  }
  assert.equal(h.calls.length, 0);
  h.advance(80);assert.equal(h.calls.length,0);
  assert.ok(h.cuddleFill(.9).y>72,'nine strokes must still leave the top unfilled');
  h.handlers().onPanResponderMove({ nativeEvent: { touches: [{}] } }, { dx: -40 });
  h.advance(79);assert.equal(h.calls.length,0);
  assert.equal(h.springs.length,0,'keep following the finger until the final fill frame');
  h.advance(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].turns, 10);
  assert.equal(h.hapticCalls.filter(value => value === 'light').length, 9);
  assert.equal(h.hapticCalls.at(-1),'success');
  assert.equal(h.springs.length,1,'full heart springs upright before finger-up');
  const spring=h.springs[0];assert.equal(spring.config.toValue,0);assert.equal(spring.config.useNativeDriver,true);
  assert.equal(spring.config.friction,5);assert.equal(spring.starts,1);
  h.handlers().onPanResponderMove({nativeEvent:{touches:[{}]}},{dx:40});
  h.handlers().onPanResponderRelease();
  assert.equal(h.springs.length,1,'late move/release must not interrupt or restart the completion bounce');
  h.advance(1000);assert.equal(h.calls.length,1);
});

test('gratitude needs an inward pinch held for three seconds', () => {
  const h = harness('gratitude'); h.render();
  const pair = distance => [{ pageX: 0, pageY: 0 }, { pageX: distance, pageY: 0 }];
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: pair(100) } });
  h.handlers().onPanResponderMove({ nativeEvent: { touches: pair(40) } }, { dx: 0 });
  h.advance(2999); assert.equal(h.calls.length, 0);
  h.advance(1); assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].holdMs >= 3000);
  assert.ok(h.hapticCalls.filter(value => value === 'selection').length >= 10);
});

test('kiss sends as soon as an outward pinch completes a three-second hold', () => {
  const h = harness('kiss'); h.render();
  const pair = distance => [{ pageX: 0, pageY: 0 }, { pageX: distance, pageY: 0 }];
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: pair(100) } });
  h.handlers().onPanResponderMove({ nativeEvent: { touches: pair(160) } }, { dx: 0 });
  h.advance(2999); assert.equal(h.calls.length, 0);
  h.advance(1); assert.equal(h.calls.length, 1);
  h.handlers().onPanResponderRelease();
  h.advance(80);
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].scale >= 1.5);
  assert.ok(h.calls[0].holdMs >= 3000);
  assert.ok(h.hapticCalls.filter(value => value === 'selection').length >= 10);
});

test('Kiss retains its original .82..1.24 bounds and distributes growth through the whole hold',()=>{
 const h=harness('kiss');
 assert.equal(h.kissArtScale(0),.82);assert.equal(h.kissArtScale(1),1.24);
 for(const p of [.25,.5,.75,.9,.99]){
  assert.ok(h.kissArtScale(p)<1.24);assert.ok(150-105*h.kissArtScale(p)>=18);
  assert.ok(Math.abs(h.kissArtScale(p)-(.82+.42*p))<1e-12);
 }
});
test('Cuddle uses the visible heart bounds and Hug only fully merges at progress one',()=>{
 const h=harness();
 assert.equal(h.cuddleFill(0).height,0);assert.ok(h.cuddleFill(.8).y>72);assert.equal(h.cuddleFill(1).y,70);
 for(const p of [0,.5,.8,.95,.999])assert.ok(h.hugArtPose(p,1).matrix[4]>h.hugArtPose(p,-1).matrix[4]);
 assert.deepEqual(h.hugArtPose(1,1),h.hugArtPose(1,-1));
});
test('Hug translates and scales at a constant speed, including the final second',()=>{
 const h=harness('hug');
 for(const side of [-1,1]){
  const start=h.hugArtPose(0,side).matrix,end=h.hugArtPose(1,side).matrix;
  for(const p of [.1,.25,.5,.66,.75,.9,.99]){
   const actual=h.hugArtPose(p,side).matrix;
   for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-(start[i]+(end[i]-start[i])*p))<1e-10,'every transform channel stays linear');
  }
 }
});
test('qualified holds use a single visual clock; unqualified two-finger input never vibrates',()=>{
 for(const type of ['hug','kiss','gratitude']){
  const h=harness(type);h.render();
  const pair=n=>[{pageX:0,pageY:0},{pageX:n,pageY:0}];
  h.handlers().onPanResponderGrant({nativeEvent:{touches:type==='hug'?[{}]:pair(100)}});
  if(type!=='hug'){
   h.advance(600);assert.equal(h.hapticCalls.length,0);
   h.handlers().onPanResponderMove({nativeEvent:{touches:pair(type==='kiss'?160:40)}},{dx:0});
  }
  h.advance(2999);assert.equal(h.calls.length,0);
  assert.equal(h.motion.timings.filter(t=>t.config.duration>100).length,1,'refreshes cannot restart the hold');
  h.advance(1);assert.equal(h.calls.length,1);assert.equal(h.hapticCalls.at(-1),'success');
  const count=h.hapticCalls.length;h.advance(1000);assert.equal(h.hapticCalls.length,count);
 }
});
test('lifting either finger cancels Kiss/Gratitude even without another move event',()=>{
 for(const type of ['kiss','gratitude']){
  const h=harness(type);h.render();const pair=n=>[{pageX:0,pageY:0},{pageX:n,pageY:0}];
  h.handlers().onPanResponderGrant({nativeEvent:{touches:pair(100)}});
  h.handlers().onPanResponderMove({nativeEvent:{touches:pair(type==='kiss'?160:40)}},{dx:0});
  h.advance(2999);h.handlers().onPanResponderEnd({nativeEvent:{touches:[{}]}});
  const haptics=h.hapticCalls.length;h.advance(5000);assert.equal(h.calls.length,0);assert.equal(h.hapticCalls.length,haptics);
 }
});
test('small cuddle jitter does not count and repeated moves in one direction cannot fill the heart',()=>{
 const h=harness('cuddle');h.render();h.handlers().onPanResponderGrant({nativeEvent:{touches:[{}]}});
 for(const dx of [5,-5,10,-10,24,-24,40,80,120])h.handlers().onPanResponderMove({nativeEvent:{touches:[{}]}},{dx});
 assert.equal(h.hapticCalls.filter(x=>x==='light').length,1);h.advance(1000);assert.equal(h.calls.length,0);
});

test('kiss resets if fingers release early and stays inside the artwork bounds', () => {
  const h = harness('kiss'); h.render();
  const pair = distance => [{ pageX: 0, pageY: 0 }, { pageX: distance, pageY: 0 }];
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: pair(100) } });
  h.handlers().onPanResponderMove({ nativeEvent: { touches: pair(160) } }, { dx: 0 });
  h.advance(2500);
  h.handlers().onPanResponderRelease();
  h.advance(1000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.kissArtScale(0), .82);
  assert.ok(h.kissArtScale(.5) < 1.1);
  assert.ok(h.kissArtScale(1) <= 1.25);
  assert.ok(150 - 105 * h.kissArtScale(1) >= 18);
});

test('Miss You sends only after a one-stroke heart is finished and lifted', () => {
  const h = harness('miss_you'); h.render();
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: [{}] } });
  for (const [x, y] of h.heartPoints) {
    h.handlers().onPanResponderMove({ nativeEvent: { touches: [{}], locationX: x * 300, locationY: y * 250 } }, { dx: 0 });
  }
  assert.equal(h.calls.length, 0);
  h.handlers().onPanResponderRelease();
  h.advance(80);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].pathPoints, h.heartPoints.length);
  assert.ok(h.hapticCalls.filter(value => value === 'selection').length >= 10);
});
