const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),{createHash}=require('node:crypto');
const base=process.argv[2];assert.ok(base?.startsWith('/private/tmp/burrow-eas125-'));const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else{assert.ok(!entry.isSymbolicLink(),'Unexpected symlink: '+file);files.push(path.relative(base,file));}}}walk(base);
for(const file of files){
 assert.ok(!/^(\.git|\.vercel|\.pnpm-store|\.turbo|tools|docs|outputs|supabase|apps\/admin)\//.test(file),file);
 assert.ok(!/^apps\/mobile\/(ios|android)\//.test(file),file);
 assert.ok(!file.split('/').some(part=>part==='node_modules'||part==='.next'||part==='.expo'),file);
 assert.ok(!file.split('/').some(part=>part.startsWith('.env')&&part!=='.env.example'),file);
 assert.ok(!/\.(p8|pem|key|p12|mobileprovision|keystore|ipa|apk|aab|log|zip|tsbuildinfo)$/.test(file),file);
 assert.ok(!/firebase-adminsdk|firebase-fcm-service-account|credentials\.json/.test(file),file);
 if(file.startsWith('apps/api/'))assert.equal(file,'apps/api/src/data/burrow-game-room-v1.json');
 assert.deepEqual(fs.readFileSync(path.join(base,file)),fs.readFileSync(file),'Archive bytes differ from current workspace: '+file);
}
for(const required of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','apps/mobile/app.json','apps/mobile/eas.json','apps/mobile/metro.config.js','apps/api/src/data/burrow-game-room-v1.json',
 'apps/mobile/modules/adventure-video/ios/BurrowAdventureVideoModule.swift','apps/mobile/modules/tiktok-events/ios/TikTokEventsModule.swift',
 'apps/mobile/modules/widget-sync/ios/WidgetSyncModule.swift'])assert.ok(files.includes(required),'Required archive input missing: '+required);
assert.equal(JSON.parse(fs.readFileSync(path.join(base,'apps/mobile/app.json'),'utf8')).expo.version,'1.0.25');
let resolved=0;
for(const file of files.filter(f=>f.startsWith('apps/mobile/')&&/\.(tsx?|jsx?|cjs|mjs)$/.test(f))){
 const ast=ts.createSourceFile(file,fs.readFileSync(path.join(base,file),'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){let value;
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'&&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))value=node.arguments[0].text;
  if(ts.isImportDeclaration(node)&&ts.isStringLiteralLike(node.moduleSpecifier))value=node.moduleSpecifier.text;
  if(value&&/\.(png|jpe?g|gif|webp|avif|heic|svg|wav|mp3|m4a|aac|aiff|mp4|mov|m4v|lottie|ttf|otf|json|dict)$/i.test(value)){
   const target=value.startsWith('@/')?path.join(base,'apps/mobile/src',value.slice(2)):value.startsWith('.')?path.resolve(base,path.dirname(file),value):null;
   if(target){assert.ok(fs.existsSync(target),'Archived import missing: '+file+' -> '+value);resolved++;}
  }ts.forEachChild(node,visit);
 }visit(ast);
}
console.log(JSON.stringify({files:files.length,resolvedAssetReferences:resolved,bytes:files.reduce((n,f)=>n+fs.statSync(path.join(base,f)).size,0),version:'1.0.25',rootIgnoreApplied:true,secretsAndLocalOutputsExcluded:true,customNativeModulesIncluded:true,sourceManifest:createHash('sha256').update(files.sort().map(f=>f+':'+createHash('sha256').update(fs.readFileSync(path.join(base,f))).digest('hex')).join('\n')).digest('hex')}));
