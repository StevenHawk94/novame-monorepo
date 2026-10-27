import type { BurrowArtAsset } from './burrow-art-assets';

/** Use visible alpha bounds, not transparent costume padding. The floor seam
 * crosses one third of the way up the displayed toy, independently of its art
 * dimensions, the action footer height, or the phone's safe area. */
export function plushieFloorY(asset:BurrowArtAsset,scale:number,artTop:number,size:number,stageY:number,innerHeight:number){
  const visibleTop=stageY+(innerHeight-size)/2+artTop+asset.bounds[1]*scale;
  return visibleTop+(asset.bounds[3]-asset.bounds[1])*scale*2/3;
}

/** Cover the entire floor using its opaque bounds. Transparent source margins
 * stay outside the seam/sides; no stretched boards or bottom white strips. */
export function plushieFloorBox(width:number,height:number,seam:number,asset:BurrowArtAsset){
  const top=Math.max(0,Math.min(height,seam));
  const [leftBound,topBound,rightBound,bottomBound]=asset.bounds;
  const scale=Math.max(width/Math.max(1,rightBound-leftBound),(height-top)/Math.max(1,bottomBound-topBound));
  return {seam:top,left:(width-(rightBound-leftBound)*scale)/2-leftBound*scale,
    top:top-topBound*scale,width:asset.width*scale,height:asset.height*scale};
}
