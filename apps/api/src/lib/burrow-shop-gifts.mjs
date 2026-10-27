/** Only supplement IDs already authorized by the pair-scoped bootstrap. Keep
 * retired gift metadata separate, never re-list retired products for purchase. */
export async function readShopGiftCatalog(db,snapshot,signal) {
  const listed=new Set((snapshot.catalog??[]).map(item=>item.stable_id));
  const ids=[...new Set((snapshot.gifts??[]).filter(gift=>gift.sender_id===snapshot.partner?.id)
    .map(gift=>gift.item_id).filter(id=>!listed.has(id)))];
  const items=[];
  for(let cursor=0;cursor<ids.length;cursor+=100){
    let query=db.from('catalog_items').select('*').in('stable_id',ids.slice(cursor,cursor+100));
    if(typeof query.abortSignal==='function')query=query.abortSignal(signal);
    const value=await query;if(value.error)throw value.error;items.push(...(value.data??[]));
  }
  return items;
}
