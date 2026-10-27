const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sourceRoot=path.join(root,'apps/mobile/src');
const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.[jt]sx?$/.test(p))files.push(p);}}walk(sourceRoot);
const violations=[];
for(const file of files){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(n){
  if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='react-native-svg'){
   const imports=n.importClause?.namedBindings;
   if(imports&&ts.isNamedImports(imports)&&imports.elements.some(x=>(x.propertyName??x.name).text==='ForeignObject'))violations.push(file+': unsafe ForeignObject');
  }
  if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='react-native-mmkv'&&!file.endsWith('/shared/storage/mmkv.ts'))
   violations.push(file+': bypasses shared encrypted storage boundary');
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='loadAsync'
   &&['Image','ExpoImage'].includes(n.expression.expression.getText(ast))&&!file.endsWith('/lib/native-image-decoder.ts'))
   violations.push(file+': bypasses shared native decoder initialization');
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['storage','mmkv'].includes(n.expression.expression.getText(ast))
   &&['set','getString','getBoolean','getNumber','delete','remove','contains'].includes(n.expression.name.text)&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0]))
   violations.push(file+': raw persistent key '+n.arguments[0].text);
  ts.forEachChild(n,visit);
 }visit(ast);
}
const store=fs.readFileSync(path.join(sourceRoot,'lib/burrow-store.ts'),'utf8');
assert.doesNotMatch(fs.readFileSync(path.join(sourceRoot,'components/burrow/localized-toy.tsx'),'utf8'),
 /from\s+['"]\.\/room-photo['"]/,'toy renderer must not import the camera/editor feature');
assert.match(store,/kPersonalRoomEdits as kBurrowRoomEdits/,'personal charges must never overwrite shared v1 journal');
assert.match(store,/export function enqueueBurrowPlushie/);
for(const file of ['components/burrow/burrow-shop.tsx','components/burrow/toy-collection-screen.tsx'])
 assert.match(fs.readFileSync(path.join(sourceRoot,file),'utf8'),/enqueueBurrowPlushie\(/,'both purchase entrances must use common controller');
assert.deepEqual(violations,[],'Domain boundary violations');
console.log(JSON.stringify({domainBoundaries:'passed',sourceFiles:files.length,unsafeNativeImports:0,rawStorageKeys:0}));
