const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../apps/mobile');
const asset=/\.(png|jpe?g|gif|webp|avif|heic|svg|wav|mp3|m4a|aac|aiff|mp4|mov|m4v|lottie|ttf|otf|json|dict)$/i;
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  if(['node_modules','.expo','ios','android','.git','dist'].includes(entry.name))return [];
  const file=path.join(dir,entry.name);
  return entry.isDirectory()?files(file):/\.(tsx?|jsx?|mjs|cjs)$/.test(file)?[file]:[];
});}
test('deleted legacy backgrounds have no registry, fallback, render or startup warm-up references',()=>{
  for(const file of [...files(path.join(root,'app')),...files(path.join(root,'src'))]){
    const source=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source,/assets\/Background|DEFAULT_SCENE_BG|DEFAULT_SCENE_THUMB|warmEntryBackgrounds/,
      'retired background dependency: '+path.relative(root,file));
  }
  assert.equal(fs.existsSync(path.join(root,'src/lib/cosmetic-images.ts')),false,'unused legacy image map removed');
  const home=fs.readFileSync(path.join(root,'app/(main)/(tabs)/index.tsx'),'utf8');
  assert.match(home,/<BurrowScreen section="home"/);
  assert.doesNotMatch(home,/LegacyHomeScreen|CompanionVideo|getHomeSceneSource/);
  const reflect=fs.readFileSync(path.join(root,'app/(main)/reflect.tsx'),'utf8');
  assert.match(reflect,/section=adventure/,'old picker redirects to the current Adventure entry');
});
test('legacy scene defaults stay image-free while a selected remote scene retains verified-file rendering',()=>{
  const {load}=require('./lifecycle-test-utils.cjs');
  let selected=null,local;
  const scenes=load('apps/mobile/src/lib/scenes.ts',{
    '../shared/storage/keys':{kSceneCatalog:{name:'scenes'}},
    './storage':{storage:{getString:()=>JSON.stringify([{key:'remote',image:'Maps/Test.webp'}])}},
    './cosmetics-store':{getSelectedScene:()=>selected},'./asset-cache':{fetchManifestFromR2:async()=>({})},
    './android-r2-file-cache':{androidR2ImageSource:()=>local},
  });
  for(const value of [null,'mushroom-wood','scene1','missing']){
    selected=value;assert.equal(scenes.getHomeSceneSource(),undefined);assert.equal(scenes.getHomeSceneRemoteUrl(),null);
  }
  selected='remote';assert.equal(scenes.getHomeSceneRemoteUrl(),'https://media.novameapp.com/Maps/Test.webp');
  assert.equal(scenes.getHomeSceneSource(),undefined,'no deleted image fallback while offline');
  local=null;assert.equal(scenes.getHomeSceneSource(),undefined,'null native cache result must not reach the renderer');
  local={uri:'file:///cached-scene.webp'};assert.equal(scenes.getHomeSceneSource(),local);
});
test('every literal mobile asset require/import resolves after user asset cleanup',()=>{
  const missing=[];let checked=0;
  for(const file of files(root)){
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function visit(node){
      let value;
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'
        &&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))value=node.arguments[0].text;
      if(ts.isImportDeclaration(node)&&ts.isStringLiteralLike(node.moduleSpecifier))value=node.moduleSpecifier.text;
      if(value&&asset.test(value)){
        const target=value.startsWith('@/')?path.join(root,'src',value.slice(2))
          :value.startsWith('.')?path.resolve(path.dirname(file),value):null;
        if(target){checked++;if(!fs.existsSync(target))missing.push(`${path.relative(root,file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line+1} ${value}`);}
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  assert.ok(checked>1000,'scan must include generated registries, not just visible pages');
  assert.deepEqual(missing,[],'Metro fails even when a missing require belongs to a retired screen');
});
test('retired Burrow backgrounds and unused coin mapping cannot return as bundled dependencies',()=>{
  assert.equal(fs.existsSync(path.join(root,'assets/burrow-webp/home-bunny.webp')),false,'retired flattened Home bunny removed');
  for(const file of [...files(path.join(root,'app')),...files(path.join(root,'src'))]){
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),
      /home-bunny\.webp|BURROW_FIXED_ART\.bunny|HOME_BUNNY_PLACEMENT|home-background\.webp|burrow-page-bg-(?:day|night)\.webp|affection-select-bg\.webp|7526eef1-0d6a-4d6b-ad95-d26b93fb7c21\.webp|BURROW_COIN_ART|Coin-purchase-page\/(?:200|400|1000)coins\.webp/,
      'removed artwork dependency: '+path.relative(root,file));
  }
  assert.match(fs.readFileSync(path.join(root,'src/components/burrow/burrow-shop.tsx'),'utf8'),
    /source=\{BURROW_BACKGROUNDS\.common\}/,'Shop header uses existing common artwork');
});
test('Expo icon, splash, notification and adaptive-icon assets exist',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
  const missing=[];
  function visit(value){if(typeof value==='string'&&value.startsWith('./assets/')&&!fs.existsSync(path.join(root,value)))missing.push(value);
    else if(value&&typeof value==='object')Object.values(value).forEach(visit);}
  visit(config);assert.deepEqual(missing,[]);
});
test('Metro explicitly recognizes supplied uppercase MP3 filenames',()=>{
  const config=require('../apps/mobile/metro.config.js');
  assert.ok(config.resolver.assetExts.includes('MP3'));
});
test('SVG fractional string attributes include a leading zero (react-native-svg gradient parser)',()=>{
  const malformed=[];
  for(const file of files(path.join(root,'src'))){
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function visit(node){
      if(ts.isJsxAttribute(node)&&node.initializer&&ts.isStringLiteral(node.initializer)
        &&/^\.[0-9]+$/.test(node.initializer.text))malformed.push(`${path.relative(root,file)} ${node.name.getText(source)}=${node.initializer.text}`);
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  assert.deepEqual(malformed,[]);
});
