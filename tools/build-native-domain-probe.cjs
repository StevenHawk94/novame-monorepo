const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),host=process.argv[2];
if(!host?.startsWith('/private/tmp/burrow-plushie-audit-'))throw Error('Expected isolated diagnostic host');
const Metro=require(path.join(root,'node_modules/.pnpm/metro@0.83.3/node_modules/metro'));
(async()=>{
 const config=await Metro.loadConfig({config:host+'/metro.cjs',cwd:root+'/apps/mobile'});
 const original=config.resolver.resolveRequest;
 config.resolver.resolveRequest=(context,name,platform)=>{
  if(name.startsWith('@/'))name=root+'/apps/mobile/src/'+name.slice(2);
  if(name==='@react-navigation/native-stack')return{type:'sourceFile',filePath:require('node:module').createRequire(require.resolve('expo-router/package.json',{paths:[root+'/apps/mobile']})).resolve(name)};
  if(name==='./api'&&context.originModulePath.includes('/src/lib/'))return{type:'sourceFile',filePath:host+'/no-network.js'};
  const result=original?original(context,name,platform):context.resolveRequest(context,name,platform);
  if(result.type==='sourceFile'&&['/src/lib/storage.ts','/src/shared/storage/mmkv.ts'].some(s=>result.filePath.endsWith(s)))return{type:'sourceFile',filePath:host+'/no-network.js'};
  return result;
 };
 await Metro.runBuild(config,{entry:__dirname+'/native-domain-isolation-probe.jsx',platform:'ios',dev:false,minify:true,bundleOut:host+'/probe.bundle.js'});
})().catch(error=>{console.error(error);process.exitCode=1;});
