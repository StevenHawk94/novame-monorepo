// Generate code-native clipping geometry from the existing alpha channel.
// Never edit, re-encode or delete a pixel of any Plushie image.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const {load}=require('./lifecycle-test-utils.cjs');
const root=path.resolve(__dirname,'..'),source=path.join(root,'apps/mobile/src/lib/burrow-art-assets.ts');
const sharp=createRequire(createRequire(path.join(root,'apps/api/package.json')).resolve('next/package.json'))('sharp');
const target=path.join(root,'apps/mobile/src/lib/generated/plushie-face-masks.json');
function faceMask(data,width,height,bounds){
 const [l,t,r,b]=bounds,seed=Math.floor((t+b)/2)*width+Math.floor((l+r)/2),face=new Uint8Array(width*height),queue=[seed];
 if(data[seed*4+3]>=16)throw Error('Face center is not transparent');face[seed]=1;
 const neighbours=p=>{const x=p%width,y=Math.floor(p/width);return[x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1];};
 for(let i=0;i<queue.length;i++)for(const n of neighbours(queue[i]))if(n>=0&&!face[n]&&data[n*4+3]<16){face[n]=1;queue.push(n);}
 if(queue.some(p=>p%width===0||p%width===width-1||p<width||p>=width*(height-1)))throw Error('Face hole reaches exterior; requires manual review');
 const mask=face.slice();let frontier=queue;
 // Cover the costume's own antialiased boundary from underneath, but never
 // enter another transparent component (the actual background / hair gaps).
 for(let step=0;step<2;step++){const next=[];for(const p of frontier)for(const n of neighbours(p))if(n>=0&&!mask[n]&&data[n*4+3]>=16){mask[n]=1;next.push(n);}frontier=next;}
 const fringe=new Uint8Array(width*height),visited=face.slice();frontier=queue;
 const whitePixel=n=>{const [r,g,b,a]=data.subarray(n*4,n*4+4);return a>0&&Math.min(r,g,b)>=235&&Math.max(r,g,b)-Math.min(r,g,b)<=20;};
 // Very low-alpha white antialiasing can belong to the transparent flood too.
 // Cover that residual colour, but never an alpha-zero/exterior pixel.
 for(const p of queue)if(whitePixel(p))fringe[p]=1;
 // Only near-white pixels connected to the enclosed hole, at most 3 source
 // pixels inward. Never erase dark hair, skin, the exterior, or remote whites.
 for(let step=0;step<3;step++){const next=[];for(const p of frontier)for(const n of neighbours(p)){
  if(n<0||visited[n])continue;
  if(whitePixel(n)){visited[n]=1;fringe[n]=1;next.push(n);}
 }frontier=next;}
 const pathFor=pixels=>{const rects=[];let previous=new Map();
 for(let y=t;y<b;y++){const current=new Map();for(let x=l;x<r;){if(!pixels[y*width+x]){x++;continue;}const start=x;while(x<r&&pixels[y*width+x])x++;
  const key=start+':'+x,prior=previous.get(key);if(prior){prior.h++;current.set(key,prior);}else{const row={x:start-l,y:y-t,w:x-start,h:1};rects.push(row);current.set(key,row);}}
  previous=current;
 }
 return {rects,path:rects.map(row=>`M${row.x} ${row.y}h${row.w}v${row.h}h-${row.w}z`).join('')};};
 const shape=pathFor(mask);
 return {width:r-l,height:b-t,...shape,edgePath:pathFor(fringe).path,fringe,mask,face};
}
async function generate(){
 const imports=Object.fromEntries([...fs.readFileSync(source,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],path.resolve(path.dirname(source),m[2])]));
 const toys=load('apps/mobile/src/lib/burrow-art-assets.ts',imports).BURROW_ART.couple_dolls,result={};
 for(const toy of toys){const bytes=fs.readFileSync(toy.source),{data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const shape=faceMask(data,info.width,info.height,toy.photoBounds);
  result[toy.name]={sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),canvas:[toy.width,toy.height],bounds:toy.photoBounds,width:shape.width,height:shape.height,path:shape.path,edgePath:shape.edgePath};
 }
 return JSON.stringify(result,null,2)+'\n';
}
if(require.main===module)generate().then(output=>{
 if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw Error('Plushie clipping geometry is stale; run node tools/generate-plushie-face-masks.cjs');console.log('33 Plushie masks match original alpha, canvas and photo bounds');}
 else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);console.log(target);}
}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={faceMask,generate};
