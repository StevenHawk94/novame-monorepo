import type {MajorUpdateBootstrap} from './app-major-update-api';
type Metadata=NonNullable<NonNullable<MajorUpdateBootstrap['adventureResult']>['metadata']>;
/** Display only: inventory and wallet are never awarded by this projection. */
export function adventureTreasureReward(meta:Metadata|undefined,inventory:MajorUpdateBootstrap['inventory']=[],owner?:string){
 const snapshot=meta?.treasureSnapshot;
 const duplicate=meta?.treasureVersion===4&&!!snapshot?.stable_id&&!meta.treasureClaimed
  &&inventory.some(row=>row.owner_id===owner&&row.item_id===snapshot.stable_id);
 const amount=meta?.treasureClaimed?meta.treasureAwardCoins:duplicate?100:meta?.treasureCoins;
 const coins=amount===50||amount===100?amount:0;
 return{coins,item:coins?null:snapshot??null};
}
