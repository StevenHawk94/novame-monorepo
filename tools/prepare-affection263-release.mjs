import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const base=process.argv[2],manifestFile=process.argv[3];assert.ok(base&&manifestFile);
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const destination=fs.mkdtempSync(path.join(os.tmpdir(),'burrow-affection263-api-'));
const sha=bytes=>createHash('sha1').update(bytes).digest('hex');
for(const row of manifest){
 assert.ok(!path.isAbsolute(row.file)&&!row.file.split('/').includes('..'));
 assert.ok(!row.file.includes('node_modules/')&&!row.file.includes('apps/mobile/')&&!row.file.includes('apps/admin/')&&!/(^|\/)\.env/.test(row.file));
 const bytes=fs.readFileSync(path.join(base,row.file));assert.equal(sha(bytes),row.sha1,'Verified production source: '+row.file);
 const target=path.join(destination,row.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
}
const changed='apps/api/src/app/api/vnext/command/route.js';
fs.copyFileSync(path.join(root,changed),path.join(destination,changed));
const changes=manifest.filter(row=>sha(fs.readFileSync(path.join(destination,row.file)))!==row.sha1).map(row=>row.file);
assert.deepEqual(changes,[changed]);
fs.mkdirSync(path.join(destination,'.vercel'),{recursive:true});
fs.copyFileSync(path.join(base,'.vercel/project.json'),path.join(destination,'.vercel/project.json'));
assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'.vercel/project.json'),'utf8')).projectId,'prj_M1hAWoSKmvvq5KVVp2z1waeNK2d4');
const report={destination,files:manifest.length,changes,bytes:manifest.reduce((n,row)=>n+fs.statSync(path.join(destination,row.file)).size,0)};
fs.writeFileSync(destination+'.audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
