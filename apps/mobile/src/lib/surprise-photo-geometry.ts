/** The supplied default face is a round cutout with transparent outer margins.
 * Cover each opening with its inner 85%, including heart-shaped corners, while
 * keeping the photo square and centered. The frame's exact path clips it. */
export function surpriseDefaultFacePlacement(bounds:readonly number[],path:string){
  const [x,y,width,height]=bounds;
  const cx=x+width/2,cy=y+height/2;
  const points=Array.from(path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g));
  const radius=points.length?Math.max(...points.map(point=>Math.hypot(Number(point[1])-cx,Number(point[2])-cy)))
    :Math.max(width,height)/2;
  const size=2*radius/.85;
  return {x:cx-size/2,y:cy-size/2,width:size,height:size};
}

/** Maps the actual frame cutout to source pixels; no universal circle assumption. */
export function surpriseFaceCrop(width:number,height:number,viewport:number,zoom=1,offset={x:0,y:0},bounds=[.29,.37,.42,.42],stageHeight=viewport,frameTop=0,frameLeft=0,frameWidth=viewport){
  if(![width,height,viewport,zoom,offset.x,offset.y].every(Number.isFinite)||Math.min(width,height,viewport)<=0||zoom<1||zoom>4)throw Error('invalid_photo');
  if(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=0||bounds[3]<=0||!Number.isFinite(stageHeight)||stageHeight<=0||![frameTop,frameLeft,frameWidth].every(Number.isFinite)||frameWidth<=0)throw Error('invalid_photo');
  const scale=Math.max(viewport/width,stageHeight/height)*zoom;
  const cropWidth=frameWidth*bounds[2]/scale, cropHeight=frameWidth*bounds[3]/scale;
  const originX=(width-viewport/scale)/2+(frameLeft+frameWidth*bounds[0]-offset.x)/scale;
  const originY=(height-stageHeight/scale)/2+(frameTop+frameWidth*bounds[1]-offset.y)/scale;
  if(originX<0||originY<0||originX+cropWidth>width||originY+cropHeight>height)throw Error('photo_outside_frame');
  return {originX,originY,width:cropWidth,height:cropHeight};
}
