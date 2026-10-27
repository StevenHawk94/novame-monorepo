/** Match the unchanged tile/rail geometry. Art warmup covers the viewport;
 * native list creation stays separately bounded to preserve entry latency. */
export function gameRoomTileWidth(width:number){return Math.min(150,Math.max(1,(width-18-3*9)/3.5));}
export function gameRoomInitialRows(width:number,bodyHeight:number,categoryCount:number){
  return Math.min(categoryCount,Math.max(1,Math.ceil(Math.max(0,bodyHeight)/(Math.max(118,gameRoomTileWidth(width)*1.24)+65))));
}
