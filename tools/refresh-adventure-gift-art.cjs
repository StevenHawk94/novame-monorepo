// Refresh changed remote collectible bytes without changing identity or rewards.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {dimensions}=require('./sync-shop-catalog.cjs');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'apps/api/src/data/adventure-friends');
function refresh({apply=false}={}){
 const changed=[];
 for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.json'))){
  const target=path.join(directory,file),document=JSON.parse(fs.readFileSync(target));let dirty=false;
  for(const gift of document.gifts){
   const bytes=fs.readFileSync(path.join(root,'apps/mobile/assets/burrow-webp/Gift Collection Webp',gift.file));
   const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
   if(sha256===gift.sha256)continue;
   const oldKey=gift.key,key=`burrow/adventure-gifts/v1/${gift.sourceId}-${sha256.slice(0,16)}.webp`,[width,height]=dimensions(bytes);
   changed.push({id:gift.id,friendId:gift.friendId,categoryCode:gift.categoryCode,oldKey,
    asset:{renderer:'r2',key,url:'https://media.novameapp.com/'+key,width,height},sha256,bytes:bytes.length});
   gift.key=key;gift.sha256=sha256;gift.bytes=bytes.length;dirty=true;
  }
  if(apply&&dirty)fs.writeFileSync(target,JSON.stringify(document,null,2)+'\n');
 }
 return changed;
}
module.exports={refresh};
if(require.main===module){
 const updates=refresh({apply:process.argv.includes('--apply')});
 const target=process.argv.find(v=>v.startsWith('--report='))?.slice(9);
 if(target)fs.writeFileSync(target,JSON.stringify(updates,null,2)+'\n');
 console.log(JSON.stringify({changed:updates.length,friends:[...new Set(updates.map(g=>g.friendId))],applied:process.argv.includes('--apply')}));
}
