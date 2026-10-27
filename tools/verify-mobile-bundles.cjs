const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');

function bundleArgs(platform,output){
 if(!['android','ios'].includes(platform))throw Error('Unsupported mobile platform');
 return ['--filter','@novame/mobile','exec','expo','export:embed',
  '--entry-file',path.join(root,'apps/mobile/index.js'),'--platform',platform,
  '--dev','false','--max-workers','2','--bundle-output',path.join(output,'index.bundle'),
  '--assets-dest',path.join(output,'assets')];
}
function runCommand(command,args,timeout){
 return new Promise((resolve,reject)=>{
  // No dependency on a running dev server, proxy settings, or an HTTP deadline.
  const child=spawn(command,args,{
   cwd:root,stdio:'inherit',env:{...process.env,EXPO_OFFLINE:'1',CI:'1'},timeout,
  });
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`Mobile bundle failed (${signal??code})`)));
 });
}
const runBundle=args=>runCommand(process.platform==='win32'?'pnpm.cmd':'pnpm',args,10*60*1000);
const checkAssets=()=>runCommand(process.execPath,['--test','tools/test-mobile-asset-references.cjs','tools/test-mobile-lazy-item-data.cjs'],60*1000);
function fileCount(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).reduce((count,entry)=>count+
  (entry.isDirectory()?fileCount(path.join(directory,entry.name)):1),0);
}
async function verifyMobileBundles({outputRoot=fs.mkdtempSync(path.join(os.tmpdir(),'novame-mobile-bundles-')),run=runBundle,preflight=checkAssets,now=Date.now}={}){
 const results=[];
 console.log(`Mobile bundle artifacts: ${outputRoot}`);
 await preflight();
 // Serial platforms and a bounded pool keep low-memory hosts out of contention.
 for(const platform of ['android','ios']){
  const output=path.join(outputRoot,platform);fs.mkdirSync(output,{recursive:true});
  const start=now();await run(bundleArgs(platform,output));
  const bytes=fs.statSync(path.join(output,'index.bundle')).size;
  const assets=fileCount(path.join(output,'assets'));
  if(bytes===0||assets===0)throw Error(`${platform}: bundle or assets missing`);
  const result={platform,seconds:Math.round((now()-start)/1000),bytes,assets};results.push(result);
  console.log(`Verified ${JSON.stringify(result)}`);
 }
 return {outputRoot,results};
}
module.exports={bundleArgs,verifyMobileBundles};
if(require.main===module)verifyMobileBundles().catch(error=>{console.error(error.message);process.exitCode=1;});
