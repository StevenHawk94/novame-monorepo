// Read-only inspection. Preview composites never replace bundled artwork.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {load}=require('./lifecycle-test-utils.cjs');
const root=path.resolve(__dirname,'..'),file=path.join(root,'apps/mobile/src/lib/burrow-art-assets.ts');
const imports=Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],path.resolve(path.dirname(file),m[2])]));
const toys=load('apps/mobile/src/lib/burrow-art-assets.ts',imports).BURROW_ART.couple_dolls;
const sharp=createRequire(createRequire(path.join(root,'apps/api/package.json')).resolve('next/package.json'))('sharp');
const output=process.argv[2]||'/private/tmp/burrow-plushie-alpha-audit';
async function main(){
 fs.mkdirSync(output,{recursive:true});const rows=[],originals=[],placeholders=[],corrected=[];
 const masks=require('../apps/mobile/src/lib/generated/plushie-face-masks.json');
 for(const [i,toy] of toys.entries()){
  const {data,info}=await sharp(toy.source).ensureAlpha().raw().toBuffer({resolveWithObject:true}),w=info.width,h=info.height;
  const [l,t,r,b]=toy.photoBounds,seen=new Uint8Array(w*h),queue=[Math.floor((t+b)/2)*w+Math.floor((l+r)/2)];seen[queue[0]]=1;
  for(let q=0;q<queue.length;q++){const p=queue[q],x=p%w,y=Math.floor(p/w);
   for(const n of [x>0?p-1:-1,x<w-1?p+1:-1,y>0?p-w:-1,y<h-1?p+w:-1])if(n>=0&&!seen[n]&&data[n*4+3]<16){seen[n]=1;queue.push(n);}
  }
  const enclosed=!queue.some(p=>p%w===0||p%w===w-1||p<w||p>=w*(h-1));
  let bright=0,exteriorPhotoPixels=0;
  for(let p=0;p<w*h;p++){const k=p*4;if(data[k+3]>=128&&Math.min(data[k],data[k+1],data[k+2])>=230&&Math.max(data[k],data[k+1],data[k+2])-Math.min(data[k],data[k+1],data[k+2])<18)bright++;
   const x=p%w,y=Math.floor(p/w);if(x>=l&&x<r&&y>=t&&y<b&&!seen[p]&&data[k+3]<16)exteriorPhotoPixels++;
  }
  rows.push({name:toy.name,path:path.relative(root,toy.source),faceEnclosed:enclosed,facePixels:queue.length,brightOpaquePixels:bright,photoRectangleExteriorTransparentPixels:exteriorPhotoPixels});
  const label=Buffer.from(`<svg width="200" height="224"><rect width="200" height="224" fill="#542B1D"/><text x="100" y="216" text-anchor="middle" fill="white" font-size="13">${toy.name}</text></svg>`);
  const art=await sharp(toy.source).resize(200,200).png().toBuffer();
  originals.push({input:await sharp(label).composite([{input:art,left:0,top:0}]).png().toBuffer(),left:(i%6)*200,top:Math.floor(i/6)*224});
  const rect=Buffer.from(`<svg width="200" height="200"><rect x="${l/w*200}" y="${t/h*200}" width="${(r-l)/w*200}" height="${(b-t)/h*200}" fill="#fff2dc"/></svg>`);
  placeholders.push({input:await sharp(label).composite([{input:rect,left:0,top:0},{input:art,left:0,top:0}]).png().toBuffer(),left:(i%6)*200,top:Math.floor(i/6)*224});
  const clip=Buffer.from(`<svg width="200" height="200"><g transform="translate(${l/w*200} ${t/h*200}) scale(${200/w} ${200/h})"><path d="${masks[toy.name].path}" fill="#fff2dc"/></g></svg>`);
  corrected.push({input:await sharp(label).composite([{input:clip,left:0,top:0},{input:art,left:0,top:0}]).png().toBuffer(),left:(i%6)*200,top:Math.floor(i/6)*224});
  if(toy.name==='Super Hero'){
   const before=await sharp(await sharp(label).composite([{input:rect,left:0,top:0},{input:art,left:0,top:0}]).png().toBuffer()).resize(600,672).png().toBuffer();
   const after=await sharp(await sharp(label).composite([{input:clip,left:0,top:0},{input:art,left:0,top:0}]).png().toBuffer()).resize(600,672).png().toBuffer();
   await sharp({create:{width:1200,height:672,channels:4,background:'#542B1D'}}).composite([{input:before,left:0,top:0},{input:after,left:600,top:0}]).png().toFile(path.join(output,'super-hero-before-after.png'));
  }
 }
 const canvas={create:{width:1200,height:Math.ceil(toys.length/6)*224,channels:4,background:'#542B1D'}};
 await sharp(canvas).composite(originals).png().toFile(path.join(output,'original-assets.png'));
 await sharp(canvas).composite(placeholders).png().toFile(path.join(output,'current-face-rectangle.png'));
 await sharp(canvas).composite(corrected).png().toFile(path.join(output,'corrected-face-clipping.png'));
 fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(rows,null,2));
 console.log(JSON.stringify({output,count:rows.length,faceOpenToExterior:rows.filter(r=>!r.faceEnclosed).map(r=>r.name),rectangleLeaks:rows.filter(r=>r.photoRectangleExteriorTransparentPixels>0).map(r=>({name:r.name,pixels:r.photoRectangleExteriorTransparentPixels})),brightPixelCandidates:rows.filter(r=>r.brightOpaquePixels>0).map(r=>({name:r.name,pixels:r.brightOpaquePixels}))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
