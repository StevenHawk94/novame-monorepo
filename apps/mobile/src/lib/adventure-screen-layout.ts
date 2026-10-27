/** Layout is independent of animation phase: opening never resizes/reflows the chest. */
export function adventureTreasureLayout(width: number, height: number) {
  const w = Math.max(240, width), h = Math.max(320, height);
  const chestWidth = Math.min(w * .78, h * .43);
  // Union of both supplied WebP alpha bounds. Identical image rect and baseline.
  const scale = chestWidth / (544 - 52), chestBottom = h * .81;
  // Reserve the full 130% pop, including on an SE-sized viewport.
  const rewardSize = Math.min(w * .40, h * .21);
  // Reserve the two-line style caption above the chest on compact screens.
  // The product keeps its existing size/aspect; only its vertical anchor moves.
  const rewardTop = Math.min(h * .24,chestBottom-375*scale-rewardSize-70);
  return { width:w, height:h, chestWidth, chestBottom, rewardSize, rewardTop,
    chestTarget:{left:(w-chestWidth)/2,top:chestBottom-375*scale,width:chestWidth,height:375*scale},
    chestImage:{left:-52*scale,top:(375-589)*scale,width:600*scale,height:600*scale},
    // Split the existing open artwork at its front lip. Reward travels in front
    // of the raised lid but behind the box body, rather than appearing above it.
    chestFrontClip:{left:-52*scale,top:(375-589+418)*scale,width:600*scale,height:(600-418)*scale},
    chestFrontImage:{left:0,top:-418*scale,width:600*scale,height:600*scale},
    chest: { left:(w-chestWidth)/2-52*scale, top:chestBottom-589*scale, width:600*scale, height:600*scale },
    rewardRise:Math.max(0, chestBottom-chestWidth*.31-(rewardTop+rewardSize/2)),
    // Copy appears after the big pop; keep its 58/46pt text areas separate.
    tagTop:h*.065, titleTop:h*.13, subtitleTop:h*.22,
    foundTop:Math.max(8,rewardTop-70),
    nameTop:rewardTop+rewardSize+12,
    footerBottom:8, buttonHeight:Math.max(50,Math.min(58,w*.14)),
  };
}
export function adventureRewardArtLayout(art:{width:number;height:number;bounds:readonly number[]},size:number) {
  // Fit the supplied canvas, not each gift's silhouette. Its transparent
  // margins and relative artwork sizes are part of the original design.
  const scale=size/Math.max(1,art.width,art.height);
  return {left:(size-art.width*scale)/2,top:(size-art.height*scale)/2,
    width:art.width*scale,height:art.height*scale};
}
export function adventureProgressLayout(width:number,height:number,top:number,bottom:number,syncReserve=0) {
  const scale=Math.min(width/486,1.15);
  const buttonHeight=Math.max(50,78*scale),footerBottom=Math.max(24,bottom+12,52*scale);
  const footerTop=height-footerBottom-buttonHeight;
  const headerTop=Math.max(top+8,56*scale),headerHeight=Math.max(68,88*scale);
  const routeTop=headerTop+118*scale;
  const diggingHeight=Math.max(30,40*scale),timeHeight=Math.max(52,78*scale),captionHeight=Math.max(24,32*scale);
  const statusHeight=diggingHeight+20*scale+timeHeight+10*scale+captionHeight;
  const statusTop=footerTop-20*scale-syncReserve-statusHeight;
  // Compact phones shrink only the route uniformly, never stretch its arcs.
  const routeScale=Math.max(.1,Math.min(scale,(statusTop-routeTop-20*scale)/440));
  return {scale,buttonHeight,footerBottom,footerTop,headerTop,headerHeight,routeTop,routeScale,
    routeLeft:(width-486*routeScale)/2,routeHeight:440*routeScale,
    statusTop,statusHeight,diggingHeight,timeHeight,captionHeight,
  };
}
export function adventureOrdinal(count:number|null) {
  if(count===null||!Number.isFinite(count)||count<1)return '';
  const n=Math.floor(count), suffix=n%100>=11&&n%100<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th';
  return `${n}${suffix} `;
}
export function adventureCountdown(milliseconds:number) {
  const seconds=Math.max(0,Math.ceil(milliseconds/1000));
  return `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
