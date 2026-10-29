// One authoring manifest -> Metro literals, Admin previews, release capabilities
// and a transactional SQL publication artifact. No remote image delivery.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),SOURCE='catalog/burrow-shop-products.json',LEDGER='catalog/burrow-shop-identities.json';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const categories=['outfits','wallpapers','couple_dolls','cushions','tables','rugs','vases','lamps','windows','cabinets','music_players','frames','dresser_plants','light_strings','ladders','shelves','games','surprises'];
const treasureCategories=categories.filter(c=>!['outfits','wallpapers','couple_dolls','games','surprises'].includes(c));
function read(file){return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));}
function emit(file,bytes,check=false){const target=path.join(ROOT,file),body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);if(check){assert.ok(fs.existsSync(target),'Missing generated file: '+file);assert.ok(fs.readFileSync(target).equals(body),'Stale generated file: '+file+'; run pnpm catalog:sync');}else{fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)||!fs.readFileSync(target).equals(body))fs.writeFileSync(target,body);}}
function moduleAt(file){const ts=require('typescript'),m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:request=>{assert.ok(request.includes('assets/'),'Bootstrap only supports asset imports');return path.relative(path.join(ROOT,'apps/mobile/assets'),path.resolve(ROOT,path.dirname(file),request)).replaceAll(path.sep,'/');}});return m.exports;}
function dimensions(bytes){assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');for(let p=12;p+8<=bytes.length;){const kind=bytes.toString('ascii',p,p+4),n=bytes.readUInt32LE(p+4),at=p+8;assert.ok(at+n<=bytes.length,'Truncated WebP');if(kind==='VP8X')return[1+bytes.readUIntLE(at+4,3),1+bytes.readUIntLE(at+7,3)];if(kind==='VP8L'){assert.equal(bytes[at],47);const v=bytes.readUInt32LE(at+1);return[1+(v&16383),1+((v>>>14)&16383)];}if(kind==='VP8 ')return[bytes.readUInt16LE(at+6)&16383,bytes.readUInt16LE(at+8)&16383];p=at+n+(n%2);}throw Error('Missing WebP dimensions');}
function asset(file){assert.ok(typeof file==='string'&&!file.split(/[\\/]/).includes('..')&&!path.isAbsolute(file)&&file.endsWith('.webp'),'Invalid bundled asset: '+file);const target=path.resolve(ROOT,'apps/mobile/assets',file);assert.ok(fs.existsSync(target),'Required current/historical asset missing: '+file);return fs.readFileSync(target);}
function validate(manifest,ledger){
 assert.equal(manifest.schema,1);assert.deepEqual(manifest.categories,categories);
 const developmentDescriptions=new Set(['Replaceable artwork. Fixed-slot room decoration.',
  'Replaceable catalog content used to validate purchase, gifting and decoration.']);
 const ids=new Set(),ordinals=new Set();
 for(const p of manifest.products){
  assert.ok(!developmentDescriptions.has(p.description),'Development placeholder description: '+p.id);
  assert.ok(typeof p.id==='string'&&/^[a-zA-Z0-9_:-]{1,160}$/.test(p.id)&&!ids.has(p.id),'Duplicate/invalid permanent ID: '+p.id);ids.add(p.id);
  assert.ok(categories.includes(p.category)&&p.type===({outfits:'outfit',games:'game',surprises:'surprise'}[p.category]??'decor'),'Unsupported type/category: '+p.id);
  assert.ok(['active','retired','draft'].includes(p.status),'Invalid status: '+p.id);
  assert.ok(typeof p.title==='string'&&p.title.trim()&&Number.isSafeInteger(p.seed.price)&&p.seed.price>=0&&p.seed.price<=1000000&&typeof p.seed.plusOnly==='boolean'&&typeof p.seed.tradable==='boolean','Invalid title/seed: '+p.id);
  const old=ledger.identities[p.id];if(old){assert.deepEqual([p.category,p.type,p.metadata.slot??null],[old.category,old.type,old.slot],'Permanent identity reused: '+p.id);if(old.legacyMissingArt||old.retiredArtRemoved)assert.equal(p.status,'retired','Legacy unbundled item must stay retired: '+p.id);}
  if(old?.retiredArtRemoved)assert.ok(!p.art&&!p.asset.file,'Removed retired artwork cannot be silently restored: '+p.id);
  if(!p.art){assert.ok(p.type==='outfit'&&p.metadata.starter||(old?.legacyMissingArt||old?.retiredArtRemoved)&&p.status==='retired','Missing artwork: '+p.id);}
  else{
   const [w,h]=dimensions(asset(p.art.file));assert.equal(w,p.art.width,'Wrong width: '+p.id);assert.equal(h,p.art.height,'Wrong height: '+p.id);
   assert.ok(p.art.bounds?.length===4&&p.art.bounds.every(Number.isFinite)&&p.art.bounds[0]>=0&&p.art.bounds[1]>=0&&p.art.bounds[2]<=w&&p.art.bounds[3]<=h&&p.art.bounds[2]>p.art.bounds[0]&&p.art.bounds[3]>p.art.bounds[1],'Invalid visible bounds: '+p.id);
   if(p.art.thumbnail)asset(p.art.thumbnail);if(p.art.photoBounds)assert.ok(p.art.photoBounds.length===4&&p.art.photoBounds.every(Number.isFinite),'Invalid photo inset');
  }
  if(p.type==='outfit'){assert.ok(typeof p.asset.outfitKey==='string'&&p.layers,'Missing outfit layers: '+p.id);for(const k of ['head','body','earLeft','earRight','tail'])asset(p.layers[k]);
   if(p.bunnyVariants)for(const k of ['head','body'])asset(p.bunnyVariants.pinky[k]);
   if(p.bunnyThumbnails)for(const variant of ['biscuit','pinky'])asset(p.bunnyThumbnails[variant]);}
  if(p.status==='active'){const key=p.category+':'+p.metadata.artOrdinal;assert.ok(Number.isSafeInteger(p.metadata.artOrdinal)&&(p.metadata.artOrdinal>0||p.type==='outfit'&&p.metadata.starter)&&!ordinals.has(key),'Duplicate active display order: '+p.id);ordinals.add(key);}
 }
 for(const id of Object.keys(ledger.identities))assert.ok(ids.has(id),'Do not delete a product identity: set status=retired; art removal requires explicit ledger approval: '+id);
 for(const category of categories.filter(c=>!['games','surprises'].includes(c)))assert.equal(manifest.products.filter(p=>p.category===category&&p.status==='active'&&p.metadata.starter).length,1,'Keep exactly one active room default: '+category);
 const games=require('../apps/api/src/data/burrow-game-room-v1.json').games;
 for(const p of manifest.products.filter(p=>p.type==='game'))assert.ok(games.some(g=>g.id===p.metadata.gameId),'Game content missing: '+p.id);
 return true;
}
function bootstrap(input){
 assert.ok(!fs.existsSync(path.join(ROOT,SOURCE)),'Bootstrap is one-time only');
 const data=JSON.parse(fs.readFileSync(input)),rows=data.rows??data;
 const {BURROW_ART}=moduleAt('apps/mobile/src/lib/burrow-art-assets.ts'),{OUTFIT_LAYERS}=moduleAt('apps/mobile/src/lib/burrow-outfit-assets.ts');
 const frames=moduleAt('apps/mobile/src/lib/surprise-frame-assets.ts').SURPRISE_FRAME_OPTIONS;
 const products=rows.map(row=>{
  let art=null,layers;
  if(row.status==='active'){
   if(row.item_type==='game')art={source:'burrow-webp/game-room-icons/'+row.title+'.webp',width:512,height:512,bounds:[0,0,512,512]};
   else if(row.item_type==='surprise')art={source:frames.find(f=>f.id===row.metadata.frameId)?.source,width:768,height:768,bounds:[0,0,768,768]};
   else if(!(row.item_type==='outfit'&&row.metadata.starter))art=row.category==='windows'?BURROW_ART.windows.find(a=>a.windowFrameKey===row.metadata.windowFrameKey):BURROW_ART[row.category]?.[(row.metadata.starter?1:row.metadata.artOrdinal)-1];
   assert.ok(art||row.item_type==='outfit'&&row.metadata.starter,'No exact current art: '+row.stable_id);
  }
  if(row.item_type==='outfit'){const o=OUTFIT_LAYERS[row.asset.outfitKey];assert.ok(o);layers=Object.fromEntries(Object.entries(o).filter(([k])=>k!=='name'));}
  return{id:row.stable_id,type:row.item_type,category:row.category,title:row.title,description:row.description,status:row.status,
   seed:{price:row.price??0,plusOnly:row.plus_only,tradable:row.tradable},tags:row.tags,asset:row.asset,metadata:row.metadata,
   art:art?{file:art.source,width:art.width,height:art.height,bounds:Array.from(art.bounds),...(art.thumbnail?{thumbnail:art.thumbnail}:{}),...(art.photoBounds?{photoBounds:Array.from(art.photoBounds)}:{}),...(art.windowFrameKey?{windowFrameKey:art.windowFrameKey}:{})}:null,...(layers?{layers}:{})};
 });
 const identities=Object.fromEntries(products.map(p=>[p.id,{category:p.category,type:p.type,slot:p.metadata.slot??null,...(!p.art&&p.status==='retired'?{legacyMissingArt:true}:{})}]));
 emit(SOURCE,json({schema:1,categories,products}));emit(LEDGER,json({schema:1,identities}));
}
function sync({check=false}={}){
 const m=read(SOURCE),ledger=read(LEDGER);validate(m,ledger);
 // Questions remain editorial content; product names/hooks are presentation
 // derived from the same manifest, including the locally bundled game pages.
 const gameFile='apps/api/src/data/burrow-game-room-v1.json',gameBytes=fs.readFileSync(path.join(ROOT,gameFile),'utf8'),gameData=JSON.parse(gameBytes);let gameCopyChanged=false;
 for(const p of m.products.filter(p=>p.type==='game')){
  const game=gameData.games.find(g=>g.id===p.metadata.gameId);
  if(game.title.replace(/\s+[^\x00-\x7F].*$/u,'').trim()!==p.title){game.title=p.title;gameCopyChanged=true;}
  if(game.hook!==p.description){game.hook=p.description;gameCopyChanged=true;}
 }
 emit(gameFile,gameCopyChanged?json(gameData):gameBytes,check);
 const products=m.products.slice().sort((a,b)=>a.id.localeCompare(b.id));
 const fingerprints=Object.fromEntries(products.map(p=>[p.id,p.art?hash(Buffer.concat([asset(p.art.file),...(p.art.thumbnail?[asset(p.art.thumbnail)]:[]),...Object.values(p.layers??{}).map(asset),...Object.values(p.bunnyVariants?.pinky??{}).map(asset),...Object.values(p.bunnyThumbnails??{}).map(asset)])):p.layers?hash(Buffer.concat([...Object.values(p.layers).map(asset),...Object.values(p.bunnyVariants?.pinky??{}).map(asset),...Object.values(p.bunnyThumbnails??{}).map(asset)])):null]));
 // Derive the face cutout from the actual bytes after a Surprise art refresh.
 // Reuse hash-keyed geometry on unchanged art; no network/decode at runtime.
 const geometryFile='catalog/generated/surprise-geometry-cache.json';
 const geometryCache=fs.existsSync(path.join(ROOT,geometryFile))?read(geometryFile):{};
 const geometry={},frames=products.filter(p=>p.type==='surprise'&&p.art).sort((a,b)=>a.metadata.artOrdinal-b.metadata.artOrdinal);
 for(const p of frames){
  const key='cutout-v1:'+fingerprints[p.id];
  if(!geometryCache[key]){
   assert.ok(!check,'Missing generated face geometry: '+p.id+'; run pnpm catalog:sync');
   const code='require('+JSON.stringify(path.join(ROOT,'tools/build-surprise-frames.cjs'))+').cutout(process.argv[1]).then(x=>process.stdout.write(JSON.stringify(x))).catch(e=>{console.error(e);process.exit(1)})';
   geometryCache[key]=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',code,path.join(ROOT,'apps/mobile/assets',p.art.file)],{encoding:'utf8',maxBuffer:2000000}));
  }
  geometry[p.metadata.frameId]=geometryCache[key];
 }
 emit(geometryFile,json(geometryCache),check);
 emit('apps/mobile/src/lib/surprise-frame-geometry.json',json(geometry),check);
 for(const [file,ts]of [['apps/mobile/src/lib/surprise-api.ts',true],['apps/api/src/lib/burrow-surprise.mjs',false]]){
  const source=fs.readFileSync(path.join(ROOT,file),'utf8');
  emit(file,source.replace(/export const SURPRISE_FRAMES = \[[^\n]+/,'export const SURPRISE_FRAMES = ['+frames.map(p=>JSON.stringify(p.metadata.frameId)).join(',')+']'+(ts?' as const;':'')),check);
 }
 const release=hash(JSON.stringify({manifest:m,assets:fingerprints,appVersion:read('apps/mobile/app.json').expo.version}));
 const supported=products.filter(p=>p.art||p.layers).map(p=>p.id);
 const serverFile='packages/domain/src/generated/shop-catalog-release.json';
 const previous=fs.existsSync(path.join(ROOT,serverFile))?read(serverFile):null;
 const clients={...(previous?.clients??{}),[release]:supported};
 const baseline=previous?.legacyRelease??release;
 const index=Object.fromEntries(products.map(p=>[p.id,{category:p.category,type:p.type,status:p.status,artHash:fingerprints[p.id],title:p.title}]));
 emit(serverFile,json({schema:1,release,legacyRelease:baseline,categories,treasureCategories,products:index,clients}),check);
 emit('apps/mobile/src/lib/generated/shop-catalog-version.ts',`// Generated; capabilities alone must not eagerly register/decode Shop artwork.\nexport const BUNDLED_SHOP_RELEASE=${JSON.stringify(release)};\n`,check);
 const req=file=>'require('+JSON.stringify('../../../assets/'+file)+')';
 // Preserve the non-Shop floor/season/fixed artwork and rendering code, while
 // regenerating every Shop category's compatibility array from the same IDs.
 const registryFile='apps/mobile/src/lib/burrow-art-assets.ts';let registry=fs.readFileSync(path.join(ROOT,registryFile),'utf8');
 for(const category of categories.filter(c=>!['games','surprises'].includes(c))){
  const entries=products.filter(p=>p.category===category&&p.art&&p.status==='active').sort((a,b)=>a.metadata.artOrdinal-b.metadata.artOrdinal);
  const rows=entries.map(p=>'    { source: '+req(p.art.file).replace('../../../assets/','../../assets/')+', name: '+JSON.stringify(p.title)+', width: '+p.art.width+', height: '+p.art.height+', bounds: '+JSON.stringify(p.art.bounds)+
   (p.art.thumbnail?', thumbnail: '+req(p.art.thumbnail).replace('../../../assets/','../../assets/'):'')+(p.art.photoBounds?', photoBounds: '+JSON.stringify(p.art.photoBounds):'')+(p.art.windowFrameKey?', windowFrameKey: '+JSON.stringify(p.art.windowFrameKey):'')+' },');
  const block=new RegExp('  '+category+': \\[[\\s\\S]*?\\n  \\],');assert.ok(block.test(registry),'Missing compatibility group '+category);
  registry=registry.replace(block,'  '+category+': [\n'+rows.join('\n')+'\n  ],');
 }
 emit(registryFile,registry,check);
 const artRows=products.filter(p=>p.art).map(p=>'  '+JSON.stringify(p.id)+': {source:'+req(p.art.file)+', name:'+JSON.stringify(p.title)+', width:'+p.art.width+', height:'+p.art.height+', bounds:'+JSON.stringify(p.art.bounds)+
   (p.art.thumbnail?',thumbnail:'+req(p.art.thumbnail):'')+(p.art.photoBounds?',photoBounds:'+JSON.stringify(p.art.photoBounds):'')+(p.art.windowFrameKey?',windowFrameKey:'+JSON.stringify(p.art.windowFrameKey):'')+'},');
 const removedArt=products.filter(p=>ledger.identities[p.id]?.retiredArtRemoved).map(p=>p.id);
 emit('apps/mobile/src/lib/generated/shop-product-art.ts',`// Generated by pnpm catalog:sync. Never identify a product by its array position.\nimport type {BurrowArtAsset} from '../burrow-art-assets';\nexport const BUNDLED_SHOP_RELEASE=${JSON.stringify(release)};\nexport const SHOP_PRODUCT_ART:Record<string,BurrowArtAsset>={\n${artRows.join('\n')}\n};\nexport const SHOP_PRODUCT_IDS=new Set(${JSON.stringify(supported)});\nexport const SHOP_REMOVED_ART_IDS=new Set(${JSON.stringify(removedArt)});\n`,check);
 const outfitRows=products.filter(p=>p.layers).map(p=>'  '+JSON.stringify(p.asset.outfitKey)+': {name:'+JSON.stringify(p.title)+','+Object.entries(p.layers).map(([k,v])=>k+':'+req(v)).join(',')+'},');
 const originalOutfit=fs.readFileSync(path.join(ROOT,'apps/mobile/src/lib/burrow-outfit-assets.ts'),'utf8');
 const outfitTail=originalOutfit.slice(originalOutfit.indexOf('export type OutfitKey'));
 emit('apps/mobile/src/lib/burrow-outfit-assets.ts',`// Generated by pnpm catalog:sync. Permanent outfit keys never follow array order.\nimport type {MajorUpdateCatalogItem} from './app-major-update-api';\nexport const OUTFIT_LAYERS={\n${outfitRows.join('\n').replaceAll('../../../assets/','../../assets/')}\n} as const;\n${outfitTail}`,check);
 const pinkRows=products.filter(p=>p.layers).map(p=>'  '+JSON.stringify(p.asset.outfitKey)+': {...OUTFIT_LAYERS['+JSON.stringify(p.asset.outfitKey)+'],'+Object.entries(p.bunnyVariants?.pinky??{}).map(([k,v])=>k+':'+req(v).replace('../../../assets/','../../assets/')).join(',')+'},');
 const thumbRows=products.filter(p=>p.bunnyThumbnails).map(p=>JSON.stringify(p.asset.outfitKey)+':{'+Object.entries(p.bunnyThumbnails).map(([k,v])=>k+':'+req(v).replace('../../../assets/','../../assets/')).join(',')+'},');
 emit('apps/mobile/src/lib/bunny-variant-assets.ts',`// Generated from the same product manifest; no new products or entitlements.\nimport {OUTFIT_LAYERS,type OutfitKey} from './burrow-outfit-assets';\nexport type BunnyVariant='biscuit'|'pinky';\nexport const PINKY_LAYERS={\n${pinkRows.join('\n')}\n} as const;\nexport const BUNNY_THUMBNAILS={\n${thumbRows.join('\n')}\n} as const;\nexport function bunnyLayers(key:OutfitKey,variant:BunnyVariant='biscuit'){return variant==='pinky'?PINKY_LAYERS[key]:OUTFIT_LAYERS[key];}\nexport const BUNNY_ICONS={biscuit:require('../../assets/burrow-webp/adventure-page/process-icon-biscuit.webp'),pinky:require('../../assets/burrow-webp/adventure-page/process-icon-pinky.webp')} as const;\n`,check);
 emit('apps/mobile/src/lib/burrow-game-room-art.ts',`// Generated by pnpm catalog:sync.\nimport type {ImageSourcePropType} from 'react-native';\nexport const gameRoomBackground=require('../../assets/burrow-webp/basic-bg.webp') as ImageSourcePropType;\nexport const gameRoomIcons:Record<string,ImageSourcePropType>={\n${products.filter(p=>p.type==='game'&&p.art).map(p=>JSON.stringify(p.metadata.gameId)+':'+req(p.art.file).replace('../../../assets/','../../assets/')+',').join('\n')}\n};\n`,check);
 emit('apps/mobile/src/lib/surprise-frame-assets.ts',`// Generated by pnpm catalog:sync; history keeps its retired frame art.\nimport type {SurpriseFrame} from '@/lib/surprise-api';\nexport const SURPRISE_DEFAULT_FACE=require('../../assets/burrow-webp/surprise-room/default-face.webp');\nexport const SURPRISE_FRAME_OPTIONS=[\n${products.filter(p=>p.type==='surprise'&&p.art).sort((a,b)=>a.metadata.artOrdinal-b.metadata.artOrdinal).map(p=>'{id:'+JSON.stringify(p.metadata.frameId)+' as SurpriseFrame,name:'+JSON.stringify(p.title)+',source:'+req(p.art.file).replace('../../../assets/','../../assets/')+'},').join('\n')}\n];\nexport const surpriseFrameName=(id:string)=>SURPRISE_FRAME_OPTIONS.find(frame=>frame.id===id)?.name??id.replace(/_/g,' ').replace(/\\b\\w/g,c=>c.toUpperCase());\n`,check);
 const adminCategories=Object.fromEntries(categories.map(c=>[c,[]])),adminProducts={};
 const copy=file=>{const b=asset(file),url='/shop-art/'+hash(b).slice(0,24)+'.webp';emit('apps/admin/public'+url,b,check);return url;};
 for(const p of products){let preview=null;if(p.art){preview={name:p.title,url:copy(p.art.thumbnail??p.art.file),width:p.art.width,height:p.art.height,bounds:p.art.bounds,squareThumbnail:!!p.art.thumbnail,
   ...(p.metadata.frameId?{frameId:p.metadata.frameId}:{}),...(p.art.windowFrameKey?{windowFrameKey:p.art.windowFrameKey,landscapeUrl:copy('burrow-webp/room decoration/windows/Autumn_Day.webp')}:{})};}
  adminProducts[p.id]={status:p.status,preview};if(p.status==='active'&&preview)adminCategories[p.category][p.metadata.artOrdinal-1]=preview;
 }
 emit('apps/admin/src/generated/shop-art.json',json({appVersion:read('apps/mobile/app.json').expo.version,catalogRelease:release,categories:adminCategories,products:adminProducts}),check);
 const games=require('../apps/api/src/data/burrow-game-room-v1.json').games;
 emit('apps/admin/src/generated/game-details.json',json(Object.fromEntries(games.map(g=>[g.id,g.questions]))),check);
 const identityNext={...ledger,identities:{...ledger.identities}};
 for(const p of products)identityNext.identities[p.id]??={category:p.category,type:p.type,slot:p.metadata.slot??null};
 emit(LEDGER,json(identityNext),check);
 const publication={schema:1,release,appVersion:read('apps/mobile/app.json').expo.version,legacyRelease:baseline,categories,treasureCategories,clients,
   products:products.map(p=>({id:p.id,type:p.type,category:p.category,title:p.title,description:p.description,status:p.status,seed:p.seed,tags:p.tags,
    asset:{...p.asset,productId:p.id,bundledArtHash:fingerprints[p.id]},metadata:{...p.metadata,catalogManaged:true}}))};
 const encoded=JSON.stringify(publication);assert.ok(!encoded.includes('$shop_release$'));
 emit('catalog/generated/shop-catalog-release.json',json(publication),check);
 emit('catalog/generated/shop-catalog-release.sql',`-- Generated by pnpm catalog:sync. Run only after API/Admin and the supporting App are available.\nbegin;\nselect public.publish_burrow_shop_catalog_v1($shop_release$${encoded}$shop_release$::jsonb);\ncommit;\n`,check);
 console.log(JSON.stringify({release,products:products.length,active:products.filter(p=>p.status==='active').length,check,remoteAssets:false}));
 return{release,products:products.length};
}
module.exports={validate,sync,dimensions,ROOT,categories,treasureCategories};
if(require.main===module){const args=process.argv.slice(2);if(args[0]==='--bootstrap'){assert.ok(args[1]);bootstrap(args[1]);}else sync({check:args.includes('--check')});}
