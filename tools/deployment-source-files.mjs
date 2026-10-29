import assert from 'node:assert/strict';

// Archive uploads expose a transport artifact, not a verifiable source tree.
// Never accept zero ordinary files as successful source verification.
export function deploymentSourceFiles(tree) {
  const map = new Map();
  function walk(rows, prefix = '') {
    for (const row of rows) {
      const name = prefix + row.name;
      assert.ok(!name.split('/').some(part => part === '..'), 'Unsafe source path');
      if (row.type === 'directory') walk(row.children ?? [], name + '/');
      else {
        assert.equal(row.type, 'file', 'Unverifiable source entry ' + name + '; deploy without --archive');
        assert.ok(row.uid && !map.has(name), 'Missing or duplicate source digest');
        map.set(name, row.uid);
      }
    }
  }
  const src = tree.find(node => node.name === 'src');
  assert.ok(src?.children, 'Missing deployment source tree');
  walk(src.children);
  assert.ok(map.size > 0, 'An empty source tree is not a verified deployment');
  return map;
}
