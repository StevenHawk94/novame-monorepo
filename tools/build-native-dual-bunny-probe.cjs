const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),host=process.argv[2],baseApp=process.argv[3];
const decorate=process.argv[4]==='decorate';
const memories=process.argv[4]==='memories';
const adventureClock=process.argv[4]==='adventure-clock';
const adventurePages=process.argv[4]==='adventure-pages';
const burrowMap=process.argv[4]==='burrow-map';
const splashEntry=process.argv[4]==='splash-entry';
const retiredArt=process.argv[4]==='retired-art';
const touch=process.argv[4]==='plushie-touch';
if(!host?.startsWith('/private/tmp/burrow-dual-bunny-native.'))throw Error('Isolated QA directory required');
if(!baseApp?.endsWith('.app')||!path.isAbsolute(baseApp)||!fs.existsSync(baseApp))throw Error('Pass a compatible built Release simulator .app as the second argument');
const app=host+(touch?'/PlushieTouchQA.app':adventureClock?'/AdventureClockQA.app':memories?'/MemoriesLayoutQA.app':decorate?'/DecorateQA.app':'/DualBunnyQA.app');
if(process.env.BURROW_QA_REUSE_HOST!=='1'||!fs.existsSync(app))fs.cpSync(baseApp,app,{recursive:true});
const plist=app+'/Info.plist';execFileSync('/usr/libexec/PlistBuddy',['-c','Set CFBundleIdentifier '+(touch?'com.novame.plushtouchqa':adventureClock?'com.novame.adventureclockqa':memories?'com.novame.memorieslayoutqa':decorate?'com.novame.decorateqa':'com.novame.dualbunnyqa'),plist]);
for(const key of ['FacebookAutoInitEnabled','FacebookAutoLogAppEventsEnabled','FacebookAdvertiserIDCollectionEnabled']){
 try{execFileSync('/usr/libexec/PlistBuddy',['-c','Set '+key+' false',plist],{stdio:'ignore'});}catch{execFileSync('/usr/libexec/PlistBuddy',['-c','Add '+key+' bool false',plist]);}
}
const Metro=require(root+'/node_modules/.pnpm/metro@0.83.3/node_modules/metro');
(async()=>{
 const config=await Metro.loadConfig({config:root+'/apps/mobile/metro.config.js',cwd:root+'/apps/mobile'});
 config.maxWorkers=2;config.resolver.useWatchman=false;config.watchFolders=[...config.watchFolders,host];
 const original=config.resolver.resolveRequest;
 config.resolver.resolveRequest=(context,name,platform)=>{
  if(touch&&process.env.BURROW_QA_TOUCH_FULL==='1'&&name==='@/lib/touch-note-runtime')return{type:'sourceFile',filePath:__dirname+'/native-touch-runtime.js'};
  if(retiredArt&&name==='expo-router')return{type:'sourceFile',filePath:__dirname+'/native-splash-entry-state.jsx'};
  if(retiredArt&&name==='@/lib/use-burrow-environment')return{type:'sourceFile',filePath:__dirname+'/native-burrow-map-probe.jsx'};
  if(splashEntry&&['expo-router','@/lib/auth','@/lib/onboarding','@/lib/subscription','@/lib/me-stats','@/lib/app-config-api','@/lib/burrow-store','@/lib/onboarding-announcement-entry','@/lib/rating-navigation','@/lib/burrow-environment-state','@/lib/use-burrow-storefront','@/lib/session-lifecycle'].includes(name))return{type:'sourceFile',filePath:__dirname+'/native-splash-entry-state.jsx'};
  if(burrowMap&&name==='@/lib/use-burrow-environment')return{type:'sourceFile',filePath:__dirname+'/native-burrow-map-probe.jsx'};
  if(adventurePages&&['expo-router','@/lib/burrow-store','./burrow-store','@/lib/adventure-journal-jobs'].includes(name))return{type:'sourceFile',filePath:__dirname+'/native-adventure-pages-state.jsx'};
  const memorySeam=__dirname+'/native-memories-layout-state.jsx';
  if(touch&&['expo-router','@/lib/burrow-store','./burrow-store','@/lib/session-lifecycle','./session-lifecycle'].includes(name))return{type:'sourceFile',filePath:__dirname+'/native-plushie-touch-state.js'};
  if(touch&&['@/lib/burrow-room-photo-cache','./burrow-room-photo-cache'].includes(name))return{type:'sourceFile',filePath:__dirname+'/native-plushie-touch-state.js'};
  if(memories&&['expo-router','@/lib/burrow-store','@/lib/use-partner-entry-gate','@/lib/session-lifecycle','@/components/ui/user-avatar'].includes(name))return{type:'sourceFile',filePath:memorySeam};
  if(decorate&&name==='expo-router')return{type:'sourceFile',filePath:__dirname+'/native-decorate-router.js'};
  if(decorate&&name==='./home-art-preview'&&context.originModulePath.endsWith('/burrow-shop.tsx'))return{type:'sourceFile',filePath:__dirname+'/native-decorate-observer.jsx'};
  if(name==='react'||name.startsWith('react/'))return{type:'sourceFile',filePath:require.resolve(name,{paths:[root+'/apps/mobile']})};
  if(['@/lib/burrow-store','@/lib/adventure-journal-jobs','@/lib/adventure-nudge'].includes(name))return{type:'sourceFile',filePath:__dirname+'/native-dual-bunny-state.js'};
  if(name==='@react-native/assets-registry/registry')return{type:'sourceFile',filePath:require('node:module').createRequire(require.resolve('react-native/package.json',{paths:[root+'/apps/mobile']})).resolve(name)};
  if(name.startsWith('@babel/runtime/helpers/'))return{type:'sourceFile',filePath:root+'/node_modules/.pnpm/@babel+runtime@7.29.2/node_modules/'+name+'.js'};
  if(name.startsWith('@/'))name=root+'/apps/mobile/src/'+name.slice(2);
  if(name==='@react-navigation/native-stack')return{type:'sourceFile',filePath:require('node:module').createRequire(require.resolve('expo-router/package.json',{paths:[root+'/apps/mobile']})).resolve(name)};
  if(name==='./api'&&context.originModulePath.includes('/src/lib/'))return{type:'sourceFile',filePath:touch?__dirname+'/native-plushie-touch-state.js':memories?memorySeam:__dirname+'/native-dual-bunny-state.js'};
  const result=original?original(context,name,platform):context.resolveRequest(context,name,platform);
  if(result.type==='sourceFile'&&['/src/lib/storage.ts','/src/shared/storage/mmkv.ts',...(memories?['/src/lib/session-lifecycle.ts']:[])].some(s=>result.filePath.endsWith(s)))return{type:'sourceFile',filePath:touch?__dirname+'/native-plushie-touch-storage.js':memories?memorySeam:__dirname+'/native-dual-bunny-state.js'};
  return result;
 };
 const result=await Metro.runBuild(config,{entry:__dirname+(retiredArt?'/native-retired-art-probe.jsx':splashEntry?'/native-splash-entry-probe.jsx':burrowMap?'/native-burrow-map-probe.jsx':adventurePages?'/native-adventure-pages-probe.jsx':touch?'/native-plushie-touch-probe.jsx':adventureClock?'/native-adventure-clock-probe.jsx':memories?'/native-memories-layout-probe.jsx':decorate?'/native-decorate-probe.jsx':'/native-dual-bunny-probe.jsx'),platform:'ios',dev:false,minify:true,assets:true,bundleOut:app+'/main.jsbundle'});
 const save=require(root+'/node_modules/.pnpm/@react-native+community-cli-plugin@0.81.5/node_modules/@react-native/community-cli-plugin/dist/commands/bundle/saveAssets').default;
 await save(result.assets,'ios',app);
 // Expo's transform writes project-relative registry locations; Metro's raw
 // runBuild asset list here is monorepo-relative. Match the registry in this
 // hand-repacked QA host (normal Expo export handles this itself).
 fs.cpSync(app+'/assets/apps/mobile/assets',app+'/assets/assets',{recursive:true});
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app]);
 console.log(JSON.stringify({app,assets:result.assets.length,dev:false,minify:true,productionBusinessApi:'stubbed',hostNativeSdkNetwork:'not asserted'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
