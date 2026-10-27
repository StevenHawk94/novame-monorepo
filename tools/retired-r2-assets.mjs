// Explicit, resumable retirement. Inventory first; local verified backup before delete.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'apps/admin/package.json'));
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root,'apps/admin'),false,{info(){},error(){}});
const {S3Client,ListObjectsV2Command,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const [mode,directory]=process.argv.slice(2);
assert.ok(directory?.startsWith('/private/tmp/burrow-r2-refresh.'));
const client=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,forcePathStyle:true,maxAttempts:2,
 credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const Bucket=process.env.R2_BUCKET_NAME;
const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(30000)});
const manifestFile=path.join(directory,'retired-inventory.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const baseIcons=new Map(JSON.parse(fs.readFileSync(path.join(root,'tools/item-source/memory-items/r2-base-icons-manifest.json'))).entries.map(x=>[x.key,x]));
const oldOutfits=['Aloha Friday','Candy Cape','Exotic Princess','Granny Sweater','Green Fuzzy','Magician Set','Pilot Jacket','Pirate Set','Red Hood','Sweetheart Maid','Yeehaw Sheriff'];
const retiredKeys=new Set([...baseIcons.keys(),...oldOutfits.flatMap(name=>[`Character Videos/${name}.mov`,`Character Videos-Android/${name}.webp`]),'Items/base-icons/v33-8a1a98aedd3763b1/manifest.json']);
if(mode==='inventory'||mode==='verify'){
 const objects=[];let token;
 do {const page=await send(new ListObjectsV2Command({Bucket,ContinuationToken:token}));
  objects.push(...(page.Contents??[]).map(x=>({key:x.Key,bytes:x.Size,etag:x.ETag})));
  token=page.IsTruncated?page.NextContinuationToken:undefined;
 }while(token);
 const groups={};for(const x of objects){const prefix=x.key.includes('/')?x.key.split('/')[0]:'(root)';groups[prefix]??={count:0,bytes:0};groups[prefix].count++;groups[prefix].bytes+=x.bytes;}
 if(mode==='inventory')fs.writeFileSync(manifestFile,JSON.stringify({at:new Date().toISOString(),bucket:Bucket,objects},null,2),{mode:0o600});
 else{
  const remaining=new Map(objects.map(x=>[x.key,x]));
  assert.equal(objects.filter(x=>retiredKeys.has(x.key)).length,0);
  const original=JSON.parse(fs.readFileSync(manifestFile));
  const protectedObjects=original.objects.filter(x=>!retiredKeys.has(x.key)&&!['video-manifest.json','content-version.json'].includes(x.key));
  for(const x of protectedObjects)assert.deepEqual(remaining.get(x.key),x);
  const gifts=fs.readdirSync(path.join(root,'apps/api/src/data/adventure-friends')).flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,'apps/api/src/data/adventure-friends',f))).gifts);
  for(const g of gifts)assert.equal(remaining.get(g.key)?.bytes,g.bytes);
  const report={at:new Date().toISOString(),retiredRemaining:0,currentGiftsVerified:gifts.length,protectedObjectsUnchanged:protectedObjects.length,objects:objects.length,groups};
  fs.writeFileSync(path.join(directory,'r2-verification.json'),JSON.stringify(report,null,2),{mode:0o600});
 }
 console.log(JSON.stringify({mode,objects:objects.length,groups}));
}else if(mode==='plan'){
 const inventory=JSON.parse(fs.readFileSync(manifestFile));assert.equal(inventory.bucket,Bucket);
 const objects=inventory.objects.filter(x=>retiredKeys.has(x.key));
 assert.equal(objects.length,5462);
 fs.writeFileSync(path.join(directory,'retired-approved.json'),JSON.stringify({bucket:Bucket,objects},null,2),{mode:0o600});
 console.log(JSON.stringify({exactKnownDiaryIcons:baseIcons.size,explicitNamedAnimations:oldOutfits.length*2,oldIconManifest:1,objects:objects.length,bytes:objects.reduce((n,x)=>n+x.bytes,0)}));
}else if(mode==='retire-manifests'){
 for(const key of ['video-manifest.json','content-version.json']){
  const object=await send(new GetObjectCommand({Bucket,Key:key}));const bytes=Buffer.from(await object.Body.transformToByteArray());
  const saved=path.join(directory,key+'.before');if(!fs.existsSync(saved))fs.writeFileSync(saved,bytes,{mode:0o600});
  const value=JSON.parse(bytes);const updated=key==='video-manifest.json'?{...value,videos:[],cards:[],productAssets:[],outfits:[],scenes:[],outfitsUpdatedAt:new Date().toISOString(),scenesUpdatedAt:new Date().toISOString()}:{...value,itemsVersion:'0',assetsVersion:'0',updatedAt:new Date().toISOString()};
  await send(new PutObjectCommand({Bucket,Key:key,Body:JSON.stringify(updated),ContentType:'application/json',CacheControl:'no-cache',IfMatch:object.ETag}));
  console.log(JSON.stringify({retiredPointer:key,backup:saved}));
 }
}else if(mode==='backup'||mode==='delete'||mode==='restore'){
 const plan=JSON.parse(fs.readFileSync(path.join(directory,'retired-approved.json')));
 const inventory=JSON.parse(fs.readFileSync(manifestFile));assert.equal(plan.bucket,Bucket);assert.equal(inventory.bucket,Bucket);
 const known=new Map(inventory.objects.map(x=>[x.key,x]));
 // No wildcard deletion and no current gifts, announcements, unknown or user paths.
 assert.equal(new Set(plan.objects.map(x=>x.key)).size,plan.objects.length);
 for(const x of plan.objects){assert.ok(retiredKeys.has(x.key),'Unknown/non-retired object');assert.deepEqual(x,known.get(x.key));}
 fs.mkdirSync(path.join(directory,'backup'),{recursive:true});
 const pending=[...plan.objects];let done=0;
 await Promise.all(Array.from({length:mode==='delete'?8:4},async()=>{while(pending.length){
  const x=pending.shift(),file=path.join(directory,'backup',hash(x.key));
  const receipt=file+'.json';
  if(mode==='backup'){
   if(fs.existsSync(file)&&fs.existsSync(receipt)){
    const bytes=fs.readFileSync(file),saved=JSON.parse(fs.readFileSync(receipt));assert.equal(saved.key,x.key);assert.equal(bytes.length,x.bytes);assert.equal(hash(bytes),saved.sha256);
   }else{
    const local=baseIcons.get(x.key);
    let bytes,object;
    if(local){
     const candidate=fs.readFileSync(path.join(root,'tools/item-source/memory-items/each',local.itemId+'.webp'));
     assert.equal(hash(candidate),local.sha256);
     if(candidate.length===x.bytes&&'"'+crypto.createHash('md5').update(candidate).digest('hex')+'"'===x.etag){
      bytes=candidate;object={ContentType:'image/webp',CacheControl:'public, max-age=31536000, immutable'};
     }
    }
    if(!bytes){object=await send(new GetObjectCommand({Bucket,Key:x.key,IfMatch:x.etag}));bytes=Buffer.from(await object.Body.transformToByteArray());}
    assert.equal(bytes.length,x.bytes);
    fs.writeFileSync(file,bytes,{mode:0o600});
    fs.writeFileSync(receipt,JSON.stringify({...x,sha256:hash(bytes),contentType:object.ContentType,cacheControl:object.CacheControl,metadata:object.Metadata}),{mode:0o600});
   }
  }else if(mode==='restore'){
   const bytes=fs.readFileSync(file),saved=JSON.parse(fs.readFileSync(receipt));assert.equal(saved.key,x.key);assert.equal(bytes.length,x.bytes);assert.equal(hash(bytes),saved.sha256);
   let head;try{head=await send(new HeadObjectCommand({Bucket,Key:x.key}));}catch(error){if(error.$metadata?.httpStatusCode!==404)throw error;}
   if(head)assert.equal(head.ETag,x.etag);
   else await send(new PutObjectCommand({Bucket,Key:x.key,Body:bytes,ContentType:saved.contentType,CacheControl:saved.cacheControl,Metadata:saved.metadata,IfNoneMatch:'*'}));
  }else{
   const bytes=fs.readFileSync(file),saved=JSON.parse(fs.readFileSync(receipt));assert.equal(saved.key,x.key);assert.equal(bytes.length,x.bytes);assert.equal(hash(bytes),saved.sha256);
   let head;try{head=await send(new HeadObjectCommand({Bucket,Key:x.key}));}catch(error){if(error.$metadata?.httpStatusCode!==404)throw error;}
   if(head){assert.equal(head.ETag,x.etag);assert.equal(head.ContentLength,x.bytes);await send(new DeleteObjectCommand({Bucket,Key:x.key,IfMatch:x.etag}));}
  }
  done++;if(done%250===0)console.log(`${mode}: ${done}/${plan.objects.length}`);
 }}));
 console.log(JSON.stringify({mode,objects:done,bytes:plan.objects.reduce((n,x)=>n+x.bytes,0),backup:directory+'/backup'}));
}else throw Error('Use inventory, backup or delete with a reviewed exact-key plan');
