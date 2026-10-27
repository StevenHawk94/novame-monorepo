const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
test('avatar native tracing is route-scoped and the deployed build checks actual binary/library/codec',()=>{
 const config=require('../apps/api/next.config.js');
 assert.equal(config.outputFileTracingRoot,path.resolve(__dirname,'..'));
 assert.deepEqual(Object.keys(config.outputFileTracingIncludes),['/api/upload-avatar']);
 const patterns=config.outputFileTracingIncludes['/api/upload-avatar'];
 assert.ok(patterns.some(p=>p.includes('@img+sharp-')&&p.endsWith('/**/*')));
 assert.ok(patterns.every(p=>!p.includes('apps/mobile')&&!p.includes('.env')));
 assert.match(require('../apps/api/package.json').scripts.build,/next build && node .*check-avatar-runtime\.mjs/);
 assert.match(fs.readFileSync(path.resolve(__dirname,'../.vercelignore'),'utf8'),/!\/tools\/check-avatar-runtime\.mjs/);
});
