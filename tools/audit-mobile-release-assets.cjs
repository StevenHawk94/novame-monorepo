// Static asset resolution, including dormant routes Metro still traverses.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),mobile=path.join(root,'apps/mobile'),missing=new Map();let references=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.expo','ios','android','.git','dist'].includes(entry.name))continue;
 const file=path.join(dir,entry.name);if(entry.isDirectory()){walk(file);continue;}if(!/\.(tsx?|jsx?|mjs|cjs)$/.test(file))continue;
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){let value;
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'&&ts.isStringLiteralLike(node.arguments[0]??{}))value=node.arguments[0].text;
  if(ts.isImportDeclaration(node)&&ts.isStringLiteralLike(node.moduleSpecifier))value=node.moduleSpecifier.text;
  if(value&&/\.(png|jpe?g|gif|webp|avif|heic|svg|wav|mp3|m4a|aac|aiff|mp4|mov|m4v|lottie|ttf|otf|json|dict)$/i.test(value)){
   const target=value.startsWith('@/')?path.join(mobile,'src',value.slice(2)):value.startsWith('.')?path.resolve(path.dirname(file),value):null;
   if(target){references++;if(!fs.existsSync(target)){const key=path.relative(root,target);missing.set(key,[...(missing.get(key)??[]),path.relative(root,file)]);}}
  }ts.forEachChild(node,visit);
 }visit(ast);
}}
walk(mobile);
// An import is not proof that retired artwork belongs in the current app.
// This audit never restores assets; remove dead consumers or explicitly
// retain a still-supported feature before deciding how to fix a missing file.
if(process.argv.includes('--restore-required'))throw new Error('Asset restoration is disabled. Review and clean the referring code first.');
console.log(JSON.stringify({references,missingAssets:missing.size,files:Object.fromEntries(missing)},null,2));
if(missing.size)process.exitCode=1;
