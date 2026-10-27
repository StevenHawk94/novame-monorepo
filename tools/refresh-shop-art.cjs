// Explicit local authoring operation. Never match products by array position.
// Existing style names/defaults keep their IDs; new styles receive UUIDs once.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),assetRoot=path.join(root,'apps/mobile/assets');
const req=createRequire(path.join(root,'apps/api/package.json'));
const sharp=req(req.resolve('sharp',{paths:[path.dirname(req.resolve('next/package.json'))]}));
const directories={cabinets:'burrow-webp/room decoration/Dresser',wallpapers:'burrow-webp/room decoration/wallpaper'};
const title=file=>path.basename(file,'.webp').replace(/^\d+[. _-]*/,'').replace(/^Default[ _-]*/i,'').replaceAll('_',' ').trim();
const normal=value=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function geometry(file){
 const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let x0=info.width,y0=info.height,x1=0,y1=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*info.channels+3]>=12){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
 assert.ok(x1>x0&&y1>y0,'Empty artwork: '+file);
 return {width:info.width,height:info.height,bounds:[x0,y0,x1,y1]};
}
async function refresh({apply=false,price=150}={}){
 assert.ok(Number.isSafeInteger(price)&&price>0&&price<=1000000);
 const source=path.join(root,'catalog/burrow-shop-products.json'),manifest=JSON.parse(fs.readFileSync(source));
 const prior=JSON.parse(fs.readFileSync(path.join(root,'packages/domain/src/generated/shop-catalog-release.json')));
 const report={categories:{},newPrice:price,newPlusOnly:false,apply};
 for(const [category,directory]of Object.entries(directories)){
  const old=manifest.products.filter(p=>p.category===category),active=old.filter(p=>p.status==='active');
  const template=active.find(p=>!p.metadata.starter),starter=active.find(p=>p.metadata.starter);
  assert.ok(template&&starter,'Missing category template/default');
  const files=fs.readdirSync(path.join(assetRoot,directory)).filter(f=>f.endsWith('.webp')).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  const defaults=files.filter(f=>/^\d*[. _-]*Default[ _-]/i.test(f));assert.equal(defaults.length,1,'Exactly one default required: '+category);
  const seen=new Set(),added=[],kept=[],retired=[];let ordinal=Math.max(...old.map(p=>p.metadata.artOrdinal??0));
  for(const file of files){
   const relative=directory+'/'+file,name=title(file);
   let product=file===defaults[0]?starter:active.find(p=>p.art?.file===relative||normal(p.title)===normal(name));
   if(!product){
    product={id:'shop:'+category+':'+crypto.randomUUID(),type:template.type,category,title:name,
     description:template.description,status:'active',seed:{price,plusOnly:false,tradable:true},tags:[...template.tags],
     asset:{renderer:'bundled',artCategory:category,file:relative,ordinal:++ordinal},
     metadata:{slot:template.metadata.slot,starter:false,artOrdinal:ordinal,artName:name}};
    manifest.products.push(product);added.push({id:product.id,title:name});
   }else kept.push({id:product.id,previousTitle:product.title,title:name,renamedFile:product.art.file!==relative});
   assert.ok(!seen.has(product.id),'Ambiguous style name: '+name);seen.add(product.id);
   product.title=name;product.asset={...product.asset,file:relative};product.metadata={...product.metadata,artName:name};
   product.art={file:relative,...await geometry(path.join(assetRoot,relative))};
   if(category==='wallpapers'){
    product.art.thumbnail='burrow-webp/wallpaper-thumbnails/'+file;
    if(apply){const target=path.join(assetRoot,product.art.thumbnail);fs.mkdirSync(path.dirname(target),{recursive:true});await sharp(path.join(assetRoot,relative)).resize(256,256,{fit:'cover',position:'centre'}).webp({quality:90}).toFile(target);}
   }
  }
  for(const product of active.filter(p=>!seen.has(p.id))){
   assert.ok(!product.metadata.starter,'Cannot retire the default without a replacement');
   const original=product.art.file,relative='burrow-webp/retired-shop/'+product.id+'/original.webp';
   let bytes;
   try{bytes=fs.readFileSync(path.join(assetRoot,original));}
   catch{bytes=execFileSync('git',['show','HEAD:apps/mobile/assets/'+original],{cwd:root,maxBuffer:10000000,stdio:['ignore','pipe','pipe']});}
   const fingerprint=digest(Buffer.concat([bytes,...(product.art.thumbnail?[fs.readFileSync(path.join(assetRoot,product.art.thumbnail))]:[])]));
   assert.equal(fingerprint,prior.products[product.id].artHash,'Cannot archive unverified historical art: '+product.id);
   if(apply){const target=path.join(assetRoot,relative);fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target))assert.ok(fs.readFileSync(target).equals(bytes));else fs.writeFileSync(target,bytes);}
   product.status='retired';product.art.file=relative;product.asset={...product.asset,file:relative};
   retired.push({id:product.id,title:product.title,original,archive:relative});
  }
  report.categories[category]={active:files.length,kept,added,retired};
 }
 if(apply)fs.writeFileSync(source,JSON.stringify(manifest,null,2)+'\n');
 return report;
}
module.exports={refresh,geometry,title};
if(require.main===module)refresh({apply:process.argv.includes('--apply')}).then(r=>{
 const report=process.argv.find(v=>v.startsWith('--report='))?.slice(9);
 if(report)fs.writeFileSync(report,JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(Object.entries(r.categories).map(([c,v])=>[c,{active:v.active,kept:v.kept.length,added:v.added.length,retired:v.retired.length}]))));
}).catch(e=>{console.error(e.message);process.exitCode=1;});
