const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {load}=require('./lifecycle-test-utils.cjs');
const file='apps/mobile/src/lib/burrow-art-assets.ts';
const imports=Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],path.resolve(path.dirname(file),m[2])]));
const art=load(file,imports),toys=art.BURROW_ART.couple_dolls;
test('all 33 supplied toys are bundled exactly once; 29 existing identities retain ordinal/file and four new items append',()=>{
 const folder='apps/mobile/assets/burrow-webp/room decoration/interative toys on dresser';
 assert.equal(toys.length,33);assert.equal(new Set(toys.map(t=>t.source)).size,33);
 assert.deepEqual(Array.from(toys,t=>path.basename(t.source)).sort(),fs.readdirSync(folder).filter(n=>n.endsWith('.webp')).sort());
 const original=fs.readFileSync('supabase/migrations/20261004000155_burrow_named_art_and_wallpapers.sql','utf8');
 const rows=[...original.matchAll(/\('([^']+)', 'couple_dolls', 'couple_doll', (\d+), '([^']+)', '([^']+)'\)/g)];
 assert.equal(rows.length,29);
 for(const [,id,ordinal,name,source] of rows){const item={stable_id:id,category:'couple_dolls',metadata:{artOrdinal:Number(ordinal),starter:Number(ordinal)===1}};
  assert.equal(art.burrowArtForItem(item).name,name);assert.equal(toys[Number(ordinal)-1].source,path.resolve('apps/mobile/assets',source));}
 assert.deepEqual(Array.from(toys.slice(29),t=>t.name),['Racing Ace','Rockstar','Skater Boy','Y2K Idol']);
});
test('actual decoded WebPs match refreshed dimensions/alpha bounds and every face opening remains transparent',()=>{
 const script=`import sys,json
from PIL import Image
for item in json.load(sys.stdin):
 image=Image.open(item['source']).convert('RGBA')
 assert list(image.size)==[item['width'],item['height']],item['name']
 alpha=image.getchannel('A')
 assert list(alpha.point(lambda a:255 if a>=12 else 0).getbbox())==item['bounds'],item['name']
 l,t,r,b=item['photoBounds']
 assert 0<l<r<image.width and 0<t<b<image.height,item['name']
 assert r-l>100 and b-t>100,item['name']
 assert alpha.getpixel(((l+r)//2,(t+b)//2))<32,item['name']
print('33 toy geometries and face openings verified')`;
 const result=spawnSync('python3',['-c',script],{input:JSON.stringify(toys),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/33 toy geometries/);
});
test('new toys appear in the toy-only shop at 300, become selectable after personal purchase, and preserve the rest of the room',()=>{
 const model=load('apps/mobile/src/lib/toy-collection.ts',{'./burrow-art-assets':art,'./burrow-presentation':{roomSlots:()=>({lamp:{item_type:'decor',metadata:{slot:'lamp'},stable_id:'lamp'}})}});
 const catalog=toys.map((t,i)=>({stable_id:i===0?'placeholder_couple_dolls_01':i===1?'placeholder_couple_dolls_02':`burrow_art_couple_dolls_${String(i+1).padStart(2,'0')}`,
  item_type:'decor',category:'couple_dolls',title:t.name,price:i===0?0:i>=29?300:150,is_placeholder:false,metadata:{slot:'couple_doll',starter:i===0,artOrdinal:i+1}}));
 const data={profile:{id:'A'},catalog,inventory:[]};
 assert.deepEqual(Array.from(model.toyShopItems(data).slice(-4),t=>t.price),[300,300,300,300]);
 const item=catalog[29];assert.throws(()=>model.toyRoomLoadout(data,item.stable_id),/item_not_owned/);
 data.inventory.push({owner_id:'B',item_id:item.stable_id});assert.throws(()=>model.toyRoomLoadout(data,item.stable_id),/item_not_owned/);
 data.inventory.push({owner_id:'A',item_id:item.stable_id});assert.equal(model.toyShopItems(data).some(t=>t.stable_id===item.stable_id),false);
 assert.deepEqual(JSON.parse(JSON.stringify(model.toyRoomLoadout(data,item.stable_id))),{lamp:'lamp',couple_doll:item.stable_id});
});
