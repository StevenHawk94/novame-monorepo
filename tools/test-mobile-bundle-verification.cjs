const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {bundleArgs,verifyMobileBundles}=require('./verify-mobile-bundles.cjs');
const {deferred,flush}=require('./lifecycle-test-utils.cjs');
test('native bundle verification uses an absolute monorepo entry, production transforms and two workers',()=>{
 for(const platform of ['android','ios']){
  const args=bundleArgs(platform,'/tmp/fixture'),value=flag=>args[args.indexOf(flag)+1];
  assert.ok(path.isAbsolute(value('--entry-file')));assert.ok(fs.existsSync(value('--entry-file')));
  assert.equal(value('--platform'),platform);assert.equal(value('--dev'),'false');assert.equal(value('--max-workers'),'2');
  assert.equal(value('--assets-dest'),'/tmp/fixture/assets');
 }
 assert.throws(()=>bundleArgs('web','/tmp/fixture'),/Unsupported/);
});
test('platforms run sequentially, require real output and stop on failure rather than timing out an HTTP request',async()=>{
 const outputRoot=fs.mkdtempSync(path.join(os.tmpdir(),'novame-bundle-test-')),gate=deferred(),starts=[];
 const run=async args=>{
  const value=flag=>args[args.indexOf(flag)+1],platform=value('--platform');starts.push(platform);
  if(platform==='android')await gate.promise;
  fs.writeFileSync(value('--bundle-output'),'fixture');fs.mkdirSync(value('--assets-dest'));
  fs.writeFileSync(path.join(value('--assets-dest'),'fixture.webp'),'fixture');
 };
 try{
  let preflights=0;
  const pending=verifyMobileBundles({outputRoot,run,preflight:async()=>{preflights++;}});await flush();assert.deepEqual(starts,['android']);
  gate.resolve();const result=await pending;assert.deepEqual(starts,['android','ios']);
  assert.ok(result.results.every(row=>row.bytes>0&&row.assets===1));
  assert.equal(preflights,1);
  const failed=[];await assert.rejects(verifyMobileBundles({outputRoot,preflight:async()=>{},run:async args=>{failed.push(args);throw Error('transform failed');}}),/transform failed/);
  assert.equal(failed.length,1);
  await assert.rejects(verifyMobileBundles({outputRoot,preflight:async()=>{throw Error('missing asset');},run:async()=>{assert.fail('cannot bundle missing assets');}}),/missing asset/);
 }finally{fs.rmSync(outputRoot,{recursive:true,force:true});}
});
test('successful CLI exit with no generated artifact cannot pass validation',async()=>{
 const outputRoot=fs.mkdtempSync(path.join(os.tmpdir(),'novame-bundle-missing-test-'));
 try{await assert.rejects(verifyMobileBundles({outputRoot,preflight:async()=>{},run:async()=>{}}),/ENOENT/);}
 finally{fs.rmSync(outputRoot,{recursive:true,force:true});}
});
