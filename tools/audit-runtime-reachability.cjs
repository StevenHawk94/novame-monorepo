// Conservative static inventory, not a deletion list. All file-based routes,
// platform variants and package exports are roots/edges; dynamic paths still
// require manual review. Tests/tooling do not make a module runtime-reachable.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const relative = file => path.relative(root, file).replaceAll(path.sep, '/');
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const code = file => /\.(tsx?|jsx?|mjs|cjs)$/.test(file) && !/(\.d\.ts|\.test\.[jt]sx?)$/.test(file);
const files = new Set(), packages = new Map(), dynamic = [], unresolved = [];
const applicationEntries = new Map();
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', 'build', '.next', 'coverage', '.turbo'].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : code(file) ? [file] : [];
  });
}
for (const name of fs.readdirSync(path.join(root, 'packages'))) {
  const dir = path.join(root, 'packages', name), manifest = path.join(dir, 'package.json');
  if (fs.existsSync(manifest)) packages.set(JSON.parse(fs.readFileSync(manifest)).name, dir);
}
for (const app of ['mobile', 'api', 'admin']) {
  for (const dir of ['src', 'app']) walk(path.join(root, 'apps', app, dir)).forEach(file => files.add(file));
  // Expo's manifest entrypoint also runs during native/headless launches.
  // Route-only roots would falsely mark background task definitions as dead.
  const appRoot = path.join(root, 'apps', app);
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const entry = manifest.main && path.resolve(appRoot, manifest.main);
  if (entry && fs.existsSync(entry) && fs.statSync(entry).isFile()) {
    files.add(entry);
    applicationEntries.set(app, entry);
  }
}
walk(path.join(root, 'packages')).forEach(file => files.add(file));
function candidates(base) {
  const suffixes = ['', '.ios', '.android', '.native'];
  const names = [base, ...suffixes.flatMap(suffix => extensions.map(ext => base + suffix + ext)),
    ...suffixes.flatMap(suffix => extensions.map(ext => path.join(base, 'index' + suffix + ext)))];
  return [...new Set(names)].filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
function resolve(from, name) {
  if (name.startsWith('.')) return candidates(path.resolve(path.dirname(from), name));
  const app = relative(from).match(/^apps\/([^/]+)\//)?.[1];
  if (name.startsWith('@/') && app) return candidates(path.join(root, 'apps', app, 'src', name.slice(2)));
  const packageName = [...packages.keys()].find(key => name === key || name.startsWith(key + '/'));
  if (!packageName) return [];
  const dir = packages.get(packageName), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
  const suffix = name.slice(packageName.length), entry = suffix ? manifest.exports?.['.' + suffix] : manifest.exports?.['.'];
  const target = typeof entry === 'string' ? entry : entry?.reactNative ?? entry?.import ?? entry?.default
    ?? (app === 'mobile' && !suffix && typeof manifest['react-native'] === 'string' ? manifest['react-native'] : undefined);
  return candidates(path.join(dir, target ?? (suffix ? 'src' + suffix : manifest.main ?? 'src/index.ts')));
}
const graph = new Map();
for (const file of files) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const edges = new Set();
  function dependency(node, text) {
    const found = resolve(file, text);
    found.forEach(target => edges.add(target));
    if (!found.length && (text.startsWith('.') || text.startsWith('@/') || [...packages.keys()].includes(text)))
      unresolved.push({ file: relative(file), line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, dependency: text });
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly)
      || (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node, node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require')) {
      if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) dependency(node, node.arguments[0].text);
      else dynamic.push({ file: relative(file), line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); graph.set(file, edges);
}
const result = {};
for (const app of ['mobile', 'api', 'admin']) {
  const appRoot = path.join(root, 'apps', app);
  const roots = [...files].filter(file => file.startsWith(appRoot + path.sep)
    && (file === applicationEntries.get(app) || relative(file).startsWith('apps/' + app + '/app/') || relative(file).startsWith('apps/' + app + '/src/app/')
      || /\/(middleware|instrumentation(?:-client)?)\.[jt]s$/.test(file)));
  const seen = new Set();
  function mark(file) { if (seen.has(file)) return; seen.add(file); for (const target of graph.get(file) ?? []) mark(target); }
  roots.forEach(mark);
  const own = [...files].filter(file => file.startsWith(appRoot + path.sep));
  result[app] = {
    roots: roots.length, codeFiles: own.length, reachableCodeFiles: own.filter(file => seen.has(file)).length,
    candidates: own.filter(file => !seen.has(file)).map(file => ({ file: relative(file), bytes: fs.statSync(file).size })),
    largestReachableData: [...seen].filter(file => file.endsWith('.json')).map(file => ({ file: relative(file), bytes: fs.statSync(file).size }))
      .sort((a, b) => b.bytes - a.bytes).slice(0, 12),
  };
}
console.log(JSON.stringify({ caveat: 'Candidates only: review dynamic loading, native entrypoints, tooling and rollback support before deletion.', apps: result, dynamic, unresolved }, null, 2));
