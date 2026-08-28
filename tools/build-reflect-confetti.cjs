/** Build once, not in the mobile render path. node tools/build-reflect-confetti.cjs --check */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'apps/mobile/assets/animations/reflect.json');
const outputPath = path.join(root, 'apps/mobile/assets/animations/reflect-dense.json');
const questOutputPath = path.join(root, 'apps/mobile/assets/animations/quest-dense.json');

function shiftKeyframes(value, delay) {
  if (!value || typeof value !== 'object') return;
  if (value.a === 1 && Array.isArray(value.k)) {
    for (const key of value.k) if (typeof key.t === 'number') key.t += delay;
  }
  for (const child of Object.values(value)) shiftKeyframes(child, delay);
}
function buildDenseConfetti(source) {
  const result = structuredClone(source);
  result.nm = 'Reflect celebration — double density';
  for (const asset of result.assets) {
    if (!asset.layers?.every((layer) => layer.ty === 4)) continue;
    const original = asset.layers;
    let nextIndex = Math.max(...original.map((layer) => layer.ind)) + 1;
    const extras = original.map((layer, index) => {
      const copy = structuredClone(layer);
      copy.ind = nextIndex++;
      copy.nm = `${layer.nm} extra`;
      // Offset trajectories, not shape-local coordinates: spinning particles
      // remain independent rather than orbiting a coincident original.
      const dx = (index % 2 ? -1 : 1) * (24 + (index * 13) % 35);
      const dy = (index % 3 - 1) * 18;
      const position = copy.ks.p;
      const offset = (point) => { point[0] += dx; point[1] += dy; };
      if (position.a === 1) {
        for (const key of position.k) {
          if (key.s) offset(key.s);
          if (key.e) offset(key.e);
        }
      } else offset(position.k);
      const delay = 3 + index % 7;
      shiftKeyframes(copy, delay);
      copy.ip += delay;
      copy.op = Math.min(copy.op + delay, result.op);
      return copy;
    });
    asset.layers = original.flatMap((layer, index) => [layer, extras[index]]);
  }
  // Keep the original 5s timeline, paths, colours and four emitter placements.
  return result;
}

/** Same composition and motion, with the existing Quests gold/orange/green/blue palette. */
function buildQuestConfetti(dense) {
  const result = structuredClone(dense);
  result.nm = 'Quest celebration — double density';
  const palette = {
    '255,67,51': [242, 160, 61],
    '255,31,144': [242, 193, 78],
    '31,215,255': [107, 163, 214],
    '0,133,69': [123, 182, 97],
  };
  function recolor(value) {
    if (!value || typeof value !== 'object') return;
    if (value.ty === 'fl' || value.ty === 'st') {
      if (value.c?.a !== 0 || !Array.isArray(value.c.k)) throw new Error('Unexpected animated confetti color');
      const rgb = value.c.k.slice(0, 3).map(v => Math.round(v * 255)).join(',');
      const replacement = palette[rgb];
      if (!replacement) throw new Error(`Unmapped confetti color: ${rgb}`);
      value.c.k = [...replacement.map(v => v / 255), ...value.c.k.slice(3)];
    }
    for (const child of Object.values(value)) recolor(child);
  }
  recolor(result);
  return result;
}
if (require.main === module) {
  const dense = buildDenseConfetti(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  for (const [file, composition] of [[outputPath, dense], [questOutputPath, buildQuestConfetti(dense)]]) {
    const generated = JSON.stringify(composition);
    if (process.argv.includes('--check')) {
      if (fs.readFileSync(file, 'utf8').trim() !== generated) throw new Error(`Rebuild ${path.basename(file)}`);
      console.log(`${path.basename(file)} is up to date.`);
    } else if (process.argv.includes('--write')) {
      fs.writeFileSync(file, generated + '\n');
      console.log(`Generated ${path.basename(file)}`);
    } else if (file === outputPath) process.stdout.write(generated + '\n');
  }
}
module.exports = { buildDenseConfetti, buildQuestConfetti };
