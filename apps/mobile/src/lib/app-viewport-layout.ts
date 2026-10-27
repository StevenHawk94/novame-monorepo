/** Phone composition, not a second tablet layout. Units are logical points. */
export const APP_CANVAS_BACKGROUND = '#3f150b';
export const LARGE_SCREEN_BREAKPOINT = 600;
export const APP_FRAME_MIN_WIDTH = 390;
export const APP_FRAME_MAX_WIDTH = 520;
export const APP_FRAME_WIDEST_RATIO = 9 / 16;
export const APP_FRAME_DESIGN_RATIO = 9 / 20;

export function appViewportLayout(windowWidth:number,windowHeight:number) {
  const w=Math.max(0,windowWidth),h=Math.max(0,windowHeight);
  const constrained=w>=LARGE_SCREEN_BREAKPOINT||(h>0&&w/h>=1.1);
  if(!constrained||!w||!h)return {constrained:false,width:w,height:h,left:0,top:0};
  // Prefer the full 9:20 composition. Keep readable width on shorter windows,
  // but never make the composition wider than 9:16 or stretch either axis.
  const width=Math.min(w,APP_FRAME_MAX_WIDTH,Math.max(APP_FRAME_MIN_WIDTH,h*APP_FRAME_DESIGN_RATIO),h*APP_FRAME_WIDEST_RATIO);
  const height=Math.min(h,width/APP_FRAME_DESIGN_RATIO);
  return {constrained:true,width,height,left:(w-width)/2,top:(h-height)/2};
}

/** Android adjustResize is input space, not an unfold/landscape transition. */
export function keyboardViewportLayout(windowWidth:number,windowHeight:number,
  previous:{windowWidth:number;frame:ReturnType<typeof appViewportLayout>}|null,visible:boolean) {
  if(!visible||!previous||previous.windowWidth!==windowWidth)return appViewportLayout(windowWidth,windowHeight);
  const frame=previous.frame,height=Math.min(frame.height,Math.max(0,windowHeight));
  return {...frame,height,top:Math.max(0,Math.min(frame.top,windowHeight-height))};
}
