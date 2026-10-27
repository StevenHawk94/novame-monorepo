const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),mobile=path.join(root,'apps/mobile');
const appRequire=createRequire(path.join(mobile,'package.json'));
const expoRequire=createRequire(appRequire.resolve('expo/package.json'));
const cli=path.dirname(expoRequire.resolve('@expo/cli/package.json'));
// Exercise the installed Expo resolver, not a substitute implementation: it
// intentionally excludes explicit .d.ts aliases from runtime resolution.
const {resolveWithTsConfigPaths:resolveAlias}=require(path.join(cli,'build/src/utils/tsconfig/resolveWithTsConfigPaths.js'));
const config=JSON.parse(fs.readFileSync(path.join(mobile,'tsconfig.json'),'utf8')).compilerOptions;
const origin=path.join(mobile,'src/components/secure-storage-recovery.tsx');
function resolveRuntime(name,paths=config.paths){
 const requests=[];
 const result=resolveAlias({paths,baseUrl:mobile,hasBaseUrl:true},{moduleName:name,originModulePath:origin},candidate=>{
  requests.push(candidate);
  // Native Metro's file callback accepts TS/TSX app sources; Node's package
  // resolver below exercises the real React package.json/main behavior.
  for(const ext of ['.ts','.tsx'])if(fs.existsSync(candidate+ext))return {filePath:candidate+ext};
  return {filePath:appRequire.resolve(candidate)};
 });
 return {file:result?.filePath??createRequire(origin).resolve(name),requests};
}
test('old directory alias reproduces the reported React package entry failure',()=>{
 assert.throws(()=>resolveRuntime('react',{react:['./node_modules/@types/react']}),/Cannot find module|valid "main" entry/);
});
test('React and JSX runtime resolve to executable React 19, never declaration packages',()=>{
 for(const name of ['react','react/jsx-runtime','react/jsx-dev-runtime']){
  const {file,requests}=resolveRuntime(name);
  assert.equal(file,appRequire.resolve(name));assert.match(file,/\.js$/);
  assert.doesNotMatch(file,/@types|\.d\.ts$/);assert.deepEqual(requests,[]);
 }
 assert.equal(appRequire('react').version,'19.1.0');
 assert.equal(typeof appRequire('react').useState,'function');
 assert.equal(typeof appRequire('react/jsx-runtime').jsx,'function');
});
test('TypeScript keeps mobile React 19 declarations while ordinary app aliases remain usable',()=>{
 for(const targets of Object.values(config.paths))for(const target of targets)
  if(target.includes('/@types/'))assert.ok(target.endsWith('.d.ts'),'Declaration aliases must be explicit so Expo skips them: '+target);
 const ts=appRequire('typescript');
 const file=path.join(mobile,'tsconfig.json');
 const parsed=ts.parseJsonConfigFileContent(ts.readConfigFile(file,ts.sys.readFile).config,ts.sys,mobile);
 for(const name of ['react','react/jsx-runtime','react/jsx-dev-runtime']){
  const module=ts.resolveModuleName(name,origin,parsed.options,ts.sys).resolvedModule;
  assert.ok(module?.resolvedFileName.endsWith('.d.ts'),name);
  assert.match(fs.realpathSync(module.resolvedFileName),/@types\+react@19\./);
 }
 const runtime=resolveRuntime('@/lib/api');
 assert.equal(runtime.requests[0],path.join(mobile,'src/lib/api'));
 assert.ok(fs.existsSync(path.join(mobile,'src/lib/api.ts')));
});
