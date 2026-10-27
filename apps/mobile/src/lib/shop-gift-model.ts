import type { MajorUpdateBootstrap } from './app-major-update-api';
export const shopGiftItem=(data:MajorUpdateBootstrap,id:string)=>data.catalog.find(item=>item.stable_id===id)
  ??data.giftCatalog?.find(item=>item.stable_id===id);

export function pendingShopGifts(data:MajorUpdateBootstrap) {
  if(!data.partner||data.pairAccessVerified!==true)return [];
  const unique=new Map((data.gifts??[]).filter(gift=>gift.sender_id===data.partner!.id).map(gift=>[gift.id,gift]));
  return [...unique.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
}
export type ShopGiftIntent={gift:MajorUpdateBootstrap['gifts'][number];itemId:string;slot:string|null;replace:boolean;previousItemId:string|null};
export function projectShopGift(data:MajorUpdateBootstrap,intent:ShopGiftIntent,rollback=false) {
  const owner=data.profile.id,{gift,itemId,slot}=intent;
  const hasGift=data.gifts.some(row=>row.id===gift.id);
  const inventory=rollback?data.inventory.filter(row=>row.id!==`shop-gift:${gift.id}`)
    :data.inventory.some(row=>row.owner_id===owner&&row.item_id===itemId)?data.inventory
    :[...data.inventory,{id:`shop-gift:${gift.id}`,owner_id:owner,item_id:itemId,source:'shop-gift-preview'}];
  const target=(row:MajorUpdateBootstrap['loadouts'][number])=>row.slot===slot&&row.room_type==='home'&&row.owner_id===owner;
  const current=data.loadouts.find(target);
  // A later explicit Decorate choice wins over this earlier optimistic delta.
  const change=intent.replace&&slot&&(rollback?current?.item_id===itemId:(!current||current.item_id===intent.previousItemId||current.item_id===itemId));
  const desired=rollback?intent.previousItemId:itemId;
  const loadouts=change?[...data.loadouts.filter(row=>!target(row)),...(desired?[{slot:slot!,item_id:desired,
    room_type:'home' as const,owner_id:owner}]:[])]:data.loadouts;
  return {...data,inventory,loadouts,gifts:rollback?(hasGift?data.gifts:[...data.gifts,gift]):data.gifts.filter(row=>row.id!==gift.id),
    unread:{...data.unread,gifts:Math.max(0,data.unread.gifts+(rollback?(hasGift?0:1):(hasGift?-1:0)))}};
}
