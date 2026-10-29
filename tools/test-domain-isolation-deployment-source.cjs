const {test}=require('node:test'),assert=require('node:assert/strict');
const source=children=>[{name:'src',type:'directory',children}];
test('deployment audit recursively verifies actual nonempty source, never archive transport artifacts',async()=>{
 const {deploymentSourceFiles:files}=await import('./deployment-source-files.mjs');
 assert.deepEqual([...files(source([{name:'apps',type:'directory',children:[{name:'route.js',type:'file',uid:'abc'}]}]))],[['apps/route.js','abc']]);
 assert.throws(()=>files([]),/Missing deployment source/);
 assert.throws(()=>files(source([])),/empty source/);
 assert.throws(()=>files(source([{name:'source.tgz.part1',type:'invalid',uid:'archive'}])),/Unverifiable/);
 assert.throws(()=>files(source([{name:'../secret',type:'file',uid:'x'}])),/Unsafe/);
 assert.throws(()=>files(source([{name:'a',type:'file',uid:'x'},{name:'a',type:'file',uid:'y'}])),/duplicate/);
 assert.throws(()=>files(source([{name:'a',type:'file'}])),/Missing or duplicate/);
});
