#!/usr/bin/env node
// Deterministic WebP ALPH-chunk repair, NOT an image repaint/re-encode.
// The VP8 colour payload, ICC profile, canvas, transparent holes and all
// other chunks remain byte-identical. Never flatten the cave over a colour.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const next=createRequire(path.join(root,'apps/api/package.json')).resolve('next/package.json');
const sharp=createRequire(next)('sharp');
const directory=path.join(root,'apps/mobile/assets/burrow-webp/room decoration/background-season');
const files=['autumn','spring','summer','winter'].flatMap(s=>[s+'-day.webp',s+'-night.webp']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function chunks(bytes){
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)!==bytes.length-8)throw Error('Invalid WebP container');
 const result=[];let offset=12;
 while(offset<bytes.length){
  if(offset+8>bytes.length)throw Error('Truncated chunk header');
  const size=bytes.readUInt32LE(offset+4),end=offset+8+size+(size%2);
  if(end>bytes.length)throw Error('Truncated chunk');
  result.push({type:bytes.toString('ascii',offset,offset+4),bytes:bytes.subarray(offset,end)});offset=end;
 }
 return result;
}
function correctedAlpha(rgba,width,height){
 const output=Buffer.alloc(width*height);
 let changed=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,a=rgba[i*4+3];let next=a;
  // Export residue in otherwise solid artwork. Keep curved antialiasing and
  // intentional transparency (<250) exactly, except the anomalous edge below.
  if(a>=250)next=255;
  // Autumn/winter daytime have a ~59%-opaque outermost right column.
  // Only solid-body edge rows qualify: do not fill the cave's lower contour.
  if((x===0||x===width-1)&&a>=128){
   const neighbour=rgba[(y*width+(x===0?1:width-2))*4+3];
   if(a>=249||neighbour>=250)next=255;
  }
  output[i]=next;if(next!==a)changed++;
 }
 return{alpha:output,changed};
}
async function repair(bytes){
 const original=chunks(bytes),{data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==800||info.height!==560)throw Error('Expected the exact 800x560 Home header');
 if(original.filter(c=>c.type==='ALPH').length!==1||!original.some(c=>c.type==='VP8 '))throw Error('Expected one ALPH plus original VP8 colour payload');
 const {alpha,changed}=correctedAlpha(data,info.width,info.height);
 if(!changed)return{bytes,changed};
 // Encode ONLY an alpha plane in a throwaway black WebP, then transplant its
 // independent ALPH chunk. Never re-encode the original lossy RGB payload.
 const black=Buffer.alloc(data.length);for(let i=0;i<alpha.length;i++)black[i*4+3]=alpha[i];
 const encoded=await sharp(black,{raw:{width:info.width,height:info.height,channels:4}})
  .webp({lossless:false,quality:80,alphaQuality:100,effort:6}).toBuffer();
 const alphaChunk=chunks(encoded).find(c=>c.type==='ALPH');if(!alphaChunk)throw Error('Missing encoded alpha');
 const result=Buffer.concat([bytes.subarray(0,12),...original.map(c=>c.type==='ALPH'?alphaChunk.bytes:c.bytes)]);
 result.writeUInt32LE(result.length-8,4);
 const decoded=await sharp(result).ensureAlpha().raw().toBuffer();
 for(let i=0;i<alpha.length;i++)if(decoded[i*4+3]!==alpha[i])throw Error('Alpha lossless verification failed');
 for(const chunk of original.filter(c=>c.type!=='ALPH'))if(!chunks(result).find(c=>c.type===chunk.type)?.bytes.equals(chunk.bytes))throw Error('Non-alpha chunk changed');
 return{bytes:result,changed};
}
async function main(){
 const write=process.argv.includes('--write'),results=[];
 for(const name of files){
  const source=fs.readFileSync(path.join(directory,name)),result=await repair(source);
  const rgba=await sharp(source).ensureAlpha().raw().toBuffer();
  const silhouette=Buffer.alloc(rgba.length/4);for(let i=0;i<silhouette.length;i++)silhouette[i]=rgba[i*4+3]>0?1:0;
  results.push({name,source,result,report:{name,changed:result.changed,beforeBytes:source.length,afterBytes:result.bytes.length,
   rgbHash:hash(chunks(source).find(c=>c.type==='VP8 ').bytes),silhouetteHash:hash(silhouette)}});
 }
 // All outputs are validated BEFORE any overwrite. Preserve exact originals.
 const backup=write&&results.some(r=>r.result.changed)?fs.mkdtempSync(path.join(os.tmpdir(),'novame-home-alpha-originals-')):null;
 if(backup)for(const r of results)fs.copyFileSync(path.join(directory,r.name),path.join(backup,r.name));
 if(write)for(const r of results)if(r.result.changed)fs.writeFileSync(path.join(directory,r.name),r.result.bytes);
 console.log(JSON.stringify({write,backup,results:results.map(r=>r.report)},null,2));
}
module.exports={chunks,correctedAlpha,repair,files,hash};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
