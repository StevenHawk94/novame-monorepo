const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, clock } = require('./lifecycle-test-utils.cjs');

function harness(type = 'kiss') {
  const h = hooks(), time = clock(), calls = [], hapticCalls = [];
  let handlers, appListener, tick, focused = true, status = 'ready';
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
    spring: () => ({ start() {}, stop() {} }),
    timing: () => ({ start() {}, stop() {} }),
    parallel: () => ({ start() {}, stop() {} }),
  };
  const { AffectionGesture, HEART_TRACE_POINTS, kissArtScale } = load('apps/mobile/src/components/burrow/affection-gesture.tsx', {
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
    recipientName: 'Alex', onComplete: metrics => calls.push(metrics) }));
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
    calls, hapticCalls, heartPoints: HEART_TRACE_POINTS, kissArtScale, render, setStatus(value) { status = value; }, handlers: () => handlers,
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

test('sending keeps the gesture card in place until the delivery animation and server finish', () => {
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

test('ten spicy taps send immediately and not before', () => {
  const h = harness('spicy');
  for (let i = 0; i < 9; i++) h.tapSpark();
  assert.equal(h.calls.length, 0);
  h.tapSpark();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].taps, 10);
  assert.equal(h.hapticCalls.filter(value => value === 'light').length, 10);
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

test('cuddle needs ten direction reversals', () => {
  const h = harness('cuddle'); h.render();
  h.handlers().onPanResponderGrant({ nativeEvent: { touches: [{}] } });
  for (let i = 0; i < 10; i++) {
    h.handlers().onPanResponderMove({ nativeEvent: { touches: [{}] } }, { dx: i % 2 ? -40 : 40 });
  }
  assert.equal(h.calls.length, 0);
  h.handlers().onPanResponderMove({ nativeEvent: { touches: [{}] } }, { dx: 40 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].turns, 10);
  assert.equal(h.hapticCalls.filter(value => value === 'light').length, 10);
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
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].scale >= 1.5);
  assert.ok(h.calls[0].holdMs >= 3000);
  assert.ok(h.hapticCalls.filter(value => value === 'selection').length >= 10);
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
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].pathPoints, h.heartPoints.length);
  assert.ok(h.hapticCalls.filter(value => value === 'selection').length >= 10);
});
