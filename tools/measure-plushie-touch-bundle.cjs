const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out?.startsWith('/private/tmp/burrow-touch-bundle.'))throw Error('Isolated bundle directory required');
process.env.EXPO_ROUTER_APP_ROOT=root+'/apps/mobile/app';process.env.EXPO_ROUTER_IMPORT_MODE='sync';
const Metro=require(root+'/node_modules/.pnpm/metro@0.83.3/node_modules/metro');
(async()=>{
 const results=[];
 for(const enabled of [false,true]){
  const c=await Metro.loadConfig({config:root+'/apps/mobile/metro.config.js',cwd:root+'/apps/mobile'});
  c.maxWorkers=2;c.resolver.useWatchman=false;const original=c.resolver.resolveRequest;
  c.resolver.resolveRequest=(context,name,platform)=>{
   if(!enabled&&['@/lib/plushie-touch-store','@/components/burrow/plushie-touch-sync-gate','@/components/burrow/plushie-touch-screen','./plushie-touch-badge'].includes(name))return{type:'sourceFile',filePath:__dirname+'/native-touch-disabled.js'};
   if(name==='react'||name.startsWith('react/'))return{type:'sourceFile',filePath:require.resolve(name,{paths:[root+'/apps/mobile']})};
   if(name==='@react-native/assets-registry/registry')return{type:'sourceFile',filePath:require('node:module').createRequire(require.resolve('react-native/package.json',{paths:[root+'/apps/mobile']})).resolve(name)};
   if(name.startsWith('@babel/runtime/helpers/'))return{type:'sourceFile',filePath:root+'/node_modules/.pnpm/@babel+runtime@7.29.2/node_modules/'+name+'.js'};
   if(name.startsWith('@/'))name=root+'/apps/mobile/src/'+name.slice(2);
   return original?original(context,name,platform):context.resolveRequest(context,name,platform);
  };
  const result=await Metro.runBuild(c,{entry:root+'/apps/mobile/index.js',platform:'ios',dev:false,minify:true,assets:true,bundleOut:out+(enabled?'/enabled.js':'/baseline.js')});
  const bytes=fs.readFileSync(out+(enabled?'/enabled.js':'/baseline.js'));
  results.push({enabled,minifiedBytes:bytes.length,gzipBytes:zlib.gzipSync(bytes,{level:9}).length,assets:result.assets.map(a=>a.hash).sort()});
 }
 const [before,after]=results;const report={environment:'iOS production-mode minified Metro full-app JS, no mobile publication',
  comparison:'Current source with touch modules enabled vs no-op new entry/store/badge modules; shared renderer capture plumbing remains in both. Not an IPA/APK download delta.',
  baseline:{...before,assets:before.assets.length},enabled:{...after,assets:after.assets.length},delta:{minifiedBytes:after.minifiedBytes-before.minifiedBytes,gzipBytes:after.gzipBytes-before.gzipBytes,newAssets:after.assets.filter(a=>!before.assets.includes(a)).length},newNativeDependencies:0};
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
