// Read the exact mobile registry; never infer product identity from filenames.
// Admin previews are local static copies, not R2 URLs. Originals stay untouched.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const registry = path.join(root, 'apps/mobile/src/lib/burrow-art-assets.ts');
const mobileAssets = path.join(root, 'apps/mobile/assets');
const output = path.join(root, 'apps/admin/public/shop-art');
const generated = path.join(root, 'apps/admin/src/generated/shop-art.json');
// CLI deployments intentionally omit the native project. Use the generated
// manifest and byte-identical copies, but fail closed if any file is missing
// or corrupt. Local builds regenerate from the mobile source as before.
if (!fs.existsSync(registry)) {
  const manifest = JSON.parse(fs.readFileSync(generated, 'utf8'));
  const entries = Object.values(manifest.categories).flat();
  if (!entries.length) throw Error('No generated Shop previews');
  for (const entry of entries) {
    if (!/^\/shop-art\/[a-f0-9]{24}\.webp$/.test(entry.url)) throw Error('Invalid Shop preview path');
    const bytes = fs.readFileSync(path.join(output, path.basename(entry.url)));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    if (entry.url !== `/shop-art/${hash}.webp`) throw Error('Corrupt generated Shop preview');
  }
  console.log(`Admin Shop previews: ${entries.length} pre-generated bundled assets verified`);
  process.exit(0);
}
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(registry, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports, require: name => {
  const file = path.resolve(path.dirname(registry), name);
  if (!file.startsWith(mobileAssets + path.sep) || !file.endsWith('.webp')) throw Error('Unexpected asset import');
  return file;
} });
fs.mkdirSync(output, { recursive: true });
const copy = file => {
  const bytes = fs.readFileSync(file), hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const target = path.join(output, `${hash}.webp`);
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
  return `/shop-art/${hash}.webp`;
};
const categories = Object.fromEntries(Object.entries(moduleValue.exports.BURROW_ART)
  .filter(([key]) => key !== 'backgrounds' && key !== 'posters')
  .map(([key, assets]) => [key, assets.map(asset => ({ name: asset.name, url: copy(asset.thumbnail ?? asset.source),
    width: asset.width, height: asset.height, bounds: asset.bounds, squareThumbnail: !!asset.thumbnail }))]));
const result = { appVersion: JSON.parse(fs.readFileSync(path.join(root, 'apps/mobile/app.json'), 'utf8')).expo.version, categories };
fs.mkdirSync(path.dirname(generated), { recursive: true });
fs.writeFileSync(generated, JSON.stringify(result, null, 2) + '\n');
console.log(`Admin Shop previews: ${Object.values(categories).reduce((n, rows) => n + rows.length, 0)} bundled assets`);
