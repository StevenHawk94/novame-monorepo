/** Bounds measured on the ORIGINAL 841x1870 artwork. The background stretches
 * to the root, so content must use the same independent X/Y transform rather
 * than unrelated screen padding. This rectangle stays inside the paper at
 * both its narrow top edge and curved bottom edge. */
export const MEMORIES_ART={width:841,height:1870,
  content:{left:140,top:375,right:700,bottom:1530},
  arrowMask:{left:214,top:130,width:34,height:43},
} as const;
export function memoriesRoomLayout(width:number,height:number,fontScale=1){
  const x=width/MEMORIES_ART.width,y=height/MEMORIES_ART.height,r=MEMORIES_ART.content;
  const page={left:r.left*x,top:r.top*y,width:(r.right-r.left)*x,height:(r.bottom-r.top)*y};
  // 2 question lines, tag, padding and gap at the actual UI font sizes. Large
  // type/small screens may fit fewer entries; never let a fifth row spill onto
  // the desk just because the overall screen is tall enough for five.
  const scale=Math.max(1,fontScale),historyHeading=24*scale+24;
  const historyRow=28+Math.max(24,16*scale+8)+8+40*scale+14;
  const historyPageSize=Math.max(1,Math.min(5,Math.floor((page.height-historyHeading-16)/historyRow)));
  return{page,historyPageSize,arrowMask:{left:MEMORIES_ART.arrowMask.left*x,top:MEMORIES_ART.arrowMask.top*y,
    width:MEMORIES_ART.arrowMask.width*x,height:MEMORIES_ART.arrowMask.height*y}};
}
