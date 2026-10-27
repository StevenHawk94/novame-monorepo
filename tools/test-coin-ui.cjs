const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lifecycle-test-utils.cjs');

const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : [];
const assetPath = '../../assets/burrow-webp/Coin-purchase-page/coin-ui.webp';
const { COIN_UI_ASSET } = load('apps/mobile/src/lib/coin-ui-asset.ts', { [assetPath]: 123 });
const ui = load('apps/mobile/src/components/burrow/coin-ui.tsx', {
  react: { memo: fn => fn, Fragment: 'Fragment' }, 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
  '@/lib/coin-ui-asset': { COIN_UI_ASSET }, './burrow-image': { Image: 'Image' },
});

test('coin source exists and is bundled locally, preserving aspect ratio without a placeholder', () => {
  assert.ok(fs.existsSync(path.resolve('apps/mobile/src/lib', assetPath)));
  const icon = ui.CoinIcon({ size: 30 });
  assert.equal(icon.type, 'Image');
  assert.equal(icon.props.source, COIN_UI_ASSET);
  assert.equal(icon.props.contentFit, 'contain');
  assert.equal(icon.props.cachePolicy, 'memory-disk');
  assert.equal(icon.props.transition, 0);
  assert.equal(icon.props.pointerEvents, 'none');
  assert.deepEqual({ ...icon.props.style[0] }, { width: 30, height: 30 });
  assert.equal(icon.props.style[0].backgroundColor, undefined);
});

test('currency labels render the same image and keep readable balances, with no literal marker or emoji', () => {
  const style = { fontSize: 20 };
  const label = ui.CoinLabel({ children: 'Total: {coin} 1,240', iconSize: 22, style });
  const children = nodes(label);
  const coin = children.find(node => node.type === ui.CoinIcon);
  assert.equal(coin.props.size, 22);
  assert.equal(children.filter(node => node.type === 'Text').map(node => node.props.children).join(' '), 'Total: 1,240');
  assert.ok(children.filter(node => node.type === 'Text').every(node => node.props.style === style));
  assert.equal(label.props.accessibilityLabel, 'Total: coins 1,240');
});

test('non-currency button labels stay plain text; explicit accessible wallet description is preserved', () => {
  assert.equal(ui.CoinLabel({ children: 'Saving…' }).props.children, 'Saving…');
  assert.equal(ui.CoinLabel({ children: 'Saving…' }).type, 'Text');
  const label = ui.CoinLabel({ children: '{coin} 200', accessibilityLabel: 'Balance 200 coins' });
  assert.equal(label.props.accessibilityLabel, 'Balance 200 coins');
});

test('wallet add circle is orange and its plus is geometrically centred at every screen scale', () => {
  for (const size of [20, 26, 34, 60]) {
    const icon = ui.CoinAddIcon({ size });
    assert.equal(icon.props.style.backgroundColor, '#D97335');
    assert.equal(icon.props.style.borderRadius, size / 2);
    assert.equal(nodes(icon).filter(node => node.type === 'Text').length, 0);
    for (const bar of icon.props.children) {
      const s = bar.props.style;
      assert.ok(Math.abs(s.left + s.width / 2 - size / 2) < 1e-8);
      assert.ok(Math.abs(s.top + s.height / 2 - size / 2) < 1e-8);
    }
  }
  const home = fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx', 'utf8');
  assert.match(home, /<CoinWallet balance=\{balance\} fontSize=\{36\*scale\}/);
  const face=fs.readFileSync('apps/mobile/src/components/burrow/coin-wallet-face.tsx','utf8');
  assert.match(face,/<CoinAddIcon size=\{m.addSize\}/);
  assert.doesNotMatch(home, /#188B69|>＋<|styles\.plus/);
});

test('purchase packs use their supplied WebP files directly, preserving proportions without reconstruction', () => {
  const assets = Object.fromEntries([200, 400, 1000].map(amount =>
    [`../../../assets/burrow-webp/Coin-purchase-page/${amount}.webp`, amount]));
  const { CoinPackArt } = load('apps/mobile/src/components/burrow/coin-pack-art.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, './burrow-image': { Image: 'Image' }, ...assets,
  });
  for (const amount of [200, 400, 1000]) {
    assert.ok(fs.existsSync(`apps/mobile/assets/burrow-webp/Coin-purchase-page/${amount}.webp`));
    const tree = CoinPackArt({ amount });
    assert.equal(tree.type, 'Image'); assert.equal(tree.props.source, amount);
    assert.equal(tree.props.contentFit, 'contain'); assert.equal(tree.props.transition, 0);
    assert.equal(tree.props.style.transform, undefined); assert.equal(tree.props.children, undefined);
  }
});

test('wallets, shop prices and animated reward particles use the shared coin source, with no legacy registry', () => {
  assert.equal(fs.existsSync('apps/mobile/src/lib/icons.ts'), false);
  for (const name of ['home-art-scene', 'burrow-shop', 'game-room-screen',
    'toy-collection-screen', 'burrow-screen', 'surprise-frame-picker', 'surprise-room-screen', 'coin-reward-banner']) {
    const source = fs.readFileSync(`apps/mobile/src/components/burrow/${name}.tsx`, 'utf8');
    assert.match(source, /from '\.\/coin-(ui|wallet)'/, name);
    // The food meter is not a wallet: its carrot remains a food illustration.
    assert.doesNotMatch(source.replace(/`🥕 Food[^`]*`/, ''), /🥕|🍀|🪙|💰|function CarrotCoin/, name);
  }
  const rewards = fs.readFileSync('apps/mobile/src/components/burrow/coin-reward-banner.tsx', 'utf8');
  assert.match(rewards, /<CoinIcon size=\{25\}/);
});

test('Collection is browse-only and must not regain a wallet or coin-shop shortcut',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/collection-room-screen.tsx','utf8');
  assert.doesNotMatch(source,/from '\.\/coin-ui'|CoinIcon|CoinLabel/);
  assert.doesNotMatch(source,/wallet\.balance|Open coin shop|\/coin-shop|onCarrots/);
});
