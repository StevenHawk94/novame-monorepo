import type { MajorUpdateBootstrap } from './app-major-update-api';
import { roomSlots } from './burrow-presentation';
import type { RoomEditScope } from './room-edit-queue';
import { BURROW_SHOP_CATEGORIES } from './burrow-shop-categories';

export const isCurrentRoomItem=(item:MajorUpdateBootstrap['catalog'][number])=>
  (item.status==null||item.status==='active')&&['decor','outfit'].includes(item.item_type)
  &&!!item.metadata.slot&&(BURROW_SHOP_CATEGORIES as readonly string[]).includes(item.category);

export function roomEditScope(data:MajorUpdateBootstrap):RoomEditScope {
  return {owner:data.profile.id,partner:null,pairVersion:null};
}
export function roomDesignIds(data:MajorUpdateBootstrap) {
  return Object.fromEntries(Object.entries(roomSlots(data,data.profile.id))
    .filter(([,item])=>isCurrentRoomItem(item))
    .map(([slot,item])=>[slot,item.stable_id]));
}
/** Presentation only. Pending inventory is not a purchase entitlement; every
 * command still validates ownership, price and wallet in the DB transaction. */
export function withRoomDesign(data:MajorUpdateBootstrap,slots:Record<string,string>,acquired:readonly string[]=[]) {
  const owner=data.profile.id;
  const loadouts=[...data.loadouts.filter(row=>!(row.room_type==='home'&&row.owner_id===owner)),
    ...Object.entries(slots).map(([slot,item_id])=>({slot,item_id,room_type:'home' as const,owner_id:owner}))];
  const inventory=data.inventory.filter(row=>row.owner_id!==owner||row.source!=='room-preview');
  const missing=acquired.filter(id=>!inventory.some(row=>row.owner_id===owner&&row.item_id===id));
  return {...data,loadouts,inventory:missing.length?[...inventory,...missing.map(item_id=>({id:`room-preview:${item_id}`,
    owner_id:owner,item_id,source:'room-preview'}))]:inventory.length===data.inventory.length?data.inventory:inventory};
}
