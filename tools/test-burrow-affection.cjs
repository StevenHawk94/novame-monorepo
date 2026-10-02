const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, clock } = require('./lifecycle-test-utils.cjs');

function harness(type = 'kiss') {
  const h = hooks(), time = clock(), calls = [];
  let handlers, appListener, tick, focused = true;
  const app = { currentState: 'active', addEventListener: (_name, fn) => {
    appListener = fn; return { remove() {} };
  } };
  const jsx = (kind, props) => ({ type: kind, props });
  const { AffectionGesture } = load('apps/mobile/src/components/burrow/affection-gesture.tsx', {
    react: { ...h.react, useMemo: fn => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
      AppState: app,
      PanResponder: { create: value => { handlers = value; return { panHandlers: value }; } },
      Pressable: 'Button', Text: 'Text', View: 'View',
      StyleSheet: { create: value => value, absoluteFillObject: {} },
    },
    '@react-navigation/native': { useIsFocused: () => focused },
    '@/lib/haptics': { haptics: { light: async () => {}, medium: async () => {} } },
    'react-native-svg': { default: 'Svg', Circle: 'Circle', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Path: 'Path', Stop: 'Stop' },
  }, {
    ...time.globals,
    performance: { now: () => time.globals.Date.now() },
    setInterval: fn => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
  });
  const render = () => h.render(() => AffectionGesture({ type, disabled: false, onComplete: metrics => calls.push(metrics) }));
  function find(node, label) {
    if (!node) return;
    if (Array.isArray(node)) return node.map(child => find(child, label)).find(Boolean);
    if (node.props?.accessibilityLabel === label) return node;
    return find(node.props?.children, label);
  }
  const labels = {
    hug: 'Press and hold for 3 seconds', spicy: 'Tap 10 times', cuddle: 'Swipe gently left and right',
    gratitude: 'Slide two fingers inward, then hold', kiss: 'Spread two fingers apart',
    miss_you: 'Trace a heart with one finger',
  };
  return {
    calls, render, handlers: () => handlers,
    advance(ms) { time.advance(ms); tick?.(); },
    activateGesture() {
      const node = find(render(), `${labels[type]}. Three-second gesture area.`);
      assert.ok(node); node.props.onAccessibilityAction();
    },
    tapSpark() { const node = find(render(), 'Tap to add a spark'); assert.ok(node); node.props.onPress(); },
    background() { app.currentState = 'background'; appListener('background'); },
    blur() { focused = false; render(); },
  };
}

test('accessible affection still requires three seconds', () => {
  const h = harness();
  h.activateGesture();
  h.advance(2999);
  assert.equal(h.calls.length, 0);
  h.advance(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].assistedHoldMs, 3000);
});

test('ten spicy taps cannot bypass the three-second minimum', () => {
  const h = harness('spicy');
  for (let i = 0; i < 10; i++) h.tapSpark();
  h.advance(2999);
  assert.equal(h.calls.length, 0);
  h.advance(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].taps, 10);
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
