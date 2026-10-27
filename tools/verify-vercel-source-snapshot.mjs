// Read-only verification of the actual Vercel source-file receipt, not build output.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const [receipt, snapshot] = process.argv.slice(2);
assert.ok(receipt && snapshot, 'Supply deployment-file receipt and release snapshot');
const root = path.resolve(import.meta.dirname, '..');
const tree = JSON.parse(fs.readFileSync(receipt, 'utf8'));
const source = tree.find(entry => entry.name === 'src' && entry.type === 'directory');
assert.ok(source?.children, 'Expected Vercel source tree');
const entries = [];
function visit(nodes, prefix = '') {
  for (const node of nodes) {
    const name = prefix + node.name;
    if (node.type === 'directory') visit(node.children ?? [], name + '/');
    else {
      assert.equal(node.type, 'file');
      assert.ok(!name.includes('..') && !name.startsWith('/'));
      assert.ok(!name.startsWith('apps/mobile/') && !name.split('/').some(part => part.startsWith('.env')));
      const bytes = fs.readFileSync(path.join(snapshot, name));
      assert.equal(createHash('sha1').update(bytes).digest('hex'), node.uid, 'Deployed bytes differ: ' + name);
      assert.deepEqual(bytes, fs.readFileSync(path.join(root, name)), 'Current workspace differs: ' + name);
      entries.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
visit(source.children);
const uploaded = new Set(entries.map(entry => entry.path));
function checkCoverage(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (name === '.vercel' || entry.name === '.DS_Store' || entry.name === '.gitignore') continue;
    if (entry.isDirectory()) checkCoverage(path.join(directory, entry.name), name + '/');
    else assert.ok(uploaded.has(name), 'Release source omitted from deployment: ' + name);
  }
}
checkCoverage(snapshot);
assert.ok(entries.length > 200);
assert.ok(entries.some(entry => entry.path === 'pnpm-lock.yaml'));
entries.sort((a, b) => a.path.localeCompare(b.path));
console.log(JSON.stringify({ verifiedSourceFiles: entries.length, matchesCurrentWorkspace: true,
  includesCurrentUncommittedFiles: true, nativeAndSecretsExcluded: true,
  sourceManifestSha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex') }));
