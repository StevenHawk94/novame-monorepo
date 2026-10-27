import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from './app-major-update-api';
/** Display-only grouping; UUIDs/catalogue order are never acquisition dates.
 * Older caches without timestamps keep their stable order until silent sync. */
export function giftCollectionModel(data:MajorUpdateBootstrap,ownerId:string){
 const inventory=data.inventory.filter(row=>row.owner_id===ownerId).slice().sort((a,b)=>{
  const first=Date.parse(a.acquired_at??''),second=Date.parse(b.acquired_at??'');
  if(Number.isFinite(first)&&Number.isFinite(second)&&first!==second)return first-second;
  if(/^\d+$/.test(a.id)&&/^\d+$/.test(b.id))return BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0;
  return 0;
 });
 const owned=new Set(inventory.map(row=>row.item_id));
 const acquired=new Map<string,number>();inventory.forEach((row,i)=>{if(!acquired.has(row.item_id))acquired.set(row.item_id,i);});
 const groups=new Map<string,MajorUpdateCatalogItem[]>();
 for(const item of data.catalog){if(!item.tags.includes('adventure_v2_gift')||!item.metadata.giftCategory)continue;
  const list=groups.get(item.metadata.giftCategory)??[];if(!list.some(row=>row.stable_id===item.stable_id))list.push(item);groups.set(item.metadata.giftCategory,list);
 }
 const categories=[...groups].map(([name,items])=>{
  items.sort((a,b)=>{
   const first=acquired.get(a.stable_id),second=acquired.get(b.stable_id);
   if(first!==undefined||second!==undefined)return (first??Infinity)-(second??Infinity);
   return a.stable_id.localeCompare(b.stable_id,undefined,{numeric:true});
  });
  const found=items.filter(item=>owned.has(item.stable_id));
  const first=found.slice().sort((a,b)=>(acquired.get(a.stable_id)??Infinity)-(acquired.get(b.stable_id)??Infinity))[0]??null;
  const friend=data.friends?.find(friend=>friend.stable_id===items[0]?.metadata.friendId);
  return {name,items,found:first,count:found.length,total:items.length,friendName:friend?.name??'a Burrow friend',code:items[0]?.metadata.giftCategoryCode??name};
 }).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true}));
 return {categories,owned};
}
