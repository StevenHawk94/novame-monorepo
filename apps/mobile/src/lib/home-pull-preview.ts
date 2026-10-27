import {HOME_BACKGROUND_HEIGHT} from './burrow-home-layout';

export const HOME_PULL_DISTANCE = 160;
export const HOME_PULL_RETURN_MS = 150;
export const HOME_PULL_PRESS_GUARD_MS = 200;
export const HOME_PULL_ACTIVATION = 8;
export const HOME_PULL_HORIZONTAL_SLOP = 12;

/** Screen points, not physical pixels. Preserve the existing scale/geometry. */
export function homePullMaximum(scale:number,visibleHeight:number){
  'worklet';
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(visibleHeight)||visibleHeight<=0)return 0;
  return Math.max(0,HOME_BACKGROUND_HEIGHT*scale-visibleHeight);
}
/** Every screen reaches ITS own top after the same 160pt finger movement. */
export function homePullProgress(start:number,translationY:number){
  'worklet';
  return Math.max(0,Math.min(1,start+(Number.isFinite(translationY)?translationY:0)/HOME_PULL_DISTANCE));
}
