// Verify the actual native screenshot, not only JSX gradient node existence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{PNG}=require('../node_modules/.pnpm/pngjs@3.4.0/node_modules/pngjs');
const out=path.resolve(__dirname,'../outputs/garden-care-review-2026-10-28'),checks=[];
for(const file of ['fertilizer-ready.png','fertilizer-paused.png','fertilizer-compact-paused.png']){
 const image=PNG.sync.read(fs.readFileSync(path.join(out,file)));let sage=0,cream=0;
 for(let i=0;i<image.data.length;i+=4){const[r,g,b]=image.data.subarray(i,i+3);
  if(r>=110&&r<=190&&g>=130&&g<=200&&b>=60&&b<=150&&g>r&&g>b)sage++;
  if(r>=230&&g>=220&&b>=190&&b<=225)cream++;
 }
 assert.ok(sage>10000,file+': bag must be sage green, not a black native gradient fallback');
 assert.ok(cream>1000,file+': original cream label must remain visible');checks.push({file,sagePixels:sage,creamPixels:cream});
}
const result={passed:true,method:'Decoded unedited native PNG pixels; original sage bag and cream-label colors, including rotated and compact views',checks};
fs.writeFileSync(path.join(out,'gradient-paint.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
