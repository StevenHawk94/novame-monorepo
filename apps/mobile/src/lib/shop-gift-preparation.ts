import type { MajorUpdateBootstrap } from './app-major-update-api';
import { pendingShopGifts, shopGiftItem } from './shop-gift-model';
import { burrowArtForItem, HOME_WINDOW_LANDSCAPES } from './burrow-art-assets';
import { prepareBurrowImages, retainGiftImages } from './prepared-burrow-images';
import { notificationScope } from './notification-content-version';
let preparedScope='';
const prepared=new Map<string,string>();
const signature=(data:MajorUpdateBootstrap,id:string)=>{
  const gift=data.gifts.find(row=>row.id===id);
  return JSON.stringify([data.partner?.display_name,gift?[gift.id,gift.item_id,gift.sender_id,gift.created_at]:null,
    shopGiftItem(data,gift?.item_id??'')]);
};
/** Removing a locally claimed gift must not invalidate the already decoded
 * remainder. Newly arriving/changed gifts still wait for their own hydration. */
export const shopGiftsPrepared=(data:MajorUpdateBootstrap)=>preparedScope===notificationScope(data)
  &&pendingShopGifts(data).every(gift=>prepared.get(gift.id)===signature(data,gift.id));
export const preparedShopGiftIds=(data:MajorUpdateBootstrap)=>preparedScope===notificationScope(data)
  ?pendingShopGifts(data).filter(gift=>prepared.get(gift.id)===signature(data,gift.id)).map(gift=>gift.id):[];

export async function prepareShopGifts(data:MajorUpdateBootstrap,valid:()=>boolean) {
  const gifts=pendingShopGifts(data),items=gifts.map(gift=>shopGiftItem(data,gift.item_id));
  if(items.some(item=>!item))throw Error('gift_catalog_not_ready');
  const assets=items.map(item=>burrowArtForItem(item!));
  const sources=assets.flatMap(asset=>[asset?.source,...(asset?.thumbnail?[asset.thumbnail]:[])]);
  if(sources.some(source=>!source))throw Error('gift_art_not_ready');
  if(items.some(item=>item?.category==='windows'))sources.push(...Object.values(HOME_WINDOW_LANDSCAPES).flatMap(value=>Object.values(value)));
  if(!valid())return;
  // Independent retention: journey prefetches must not evict pending Shop art.
  retainGiftImages(sources);
  await prepareBurrowImages(sources,600);
  if(!valid())return;
  const scope=notificationScope(data);if(preparedScope!==scope){prepared.clear();preparedScope=scope;}
  const ids=new Set(gifts.map(gift=>gift.id));
  for(const id of prepared.keys())if(!ids.has(id))prepared.delete(id);
  for(const gift of gifts)prepared.set(gift.id,signature(data,gift.id));
}
