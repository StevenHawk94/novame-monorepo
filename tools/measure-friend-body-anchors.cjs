// Alpha-weighted torso median, excluding heads/ears and the bottom of the feet.
// No bitmap is modified. Keep the reproducible source alongside its metadata.
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {default:sharp}=await import('../node_modules/.pnpm/sharp@0.35.0/node_modules/sharp/dist/index.mjs');
 const bounds=require('../apps/mobile/src/lib/adventure-friend-bounds.json');
 const source=fs.readFileSync('apps/mobile/src/lib/burrow-ui-assets.ts','utf8'),result={};
 for(const [name,poses]of Object.entries(bounds)){
  const row=source.split('\n').find(line=>line.startsWith(`  "${name}":`));
  const files=[...row.matchAll(/require\("([^\"]+)"\)/g)].map(m=>m[1]);
  result[name]=[];
  for(let pose=0;pose<2;pose++){
   const {data,info}=await sharp(path.resolve('apps/mobile/src/lib',files[pose])).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   const b=poses[pose],columns=new Float64Array(info.width);
   for(let y=Math.round(b[1]+(b[3]-b[1])*.55);y<b[1]+(b[3]-b[1])*.85;y++)for(let x=b[0];x<b[2];x++)columns[x]+=data[(y*info.width+x)*4+3]/255;
   const total=columns.reduce((a,b)=>a+b,0);let sum=0,center=0;
   for(let x=0;x<columns.length;x++){sum+=columns[x];if(sum>=total/2){center=x+.5;break;}}
   result[name].push(center);
  }
 }
 fs.writeFileSync('apps/mobile/src/lib/adventure-friend-body-anchors.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
