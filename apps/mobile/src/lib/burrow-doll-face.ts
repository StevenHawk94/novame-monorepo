import { BURROW_ART, type BurrowArtAsset } from './burrow-art-assets';
import { FRAME_PHOTO_BOUNDS } from './room-photo-crop';

// These per-costume boxes position/crop the photo, not its visible silhouette.
// Some boxes also overlap exterior gaps beside the hair/neck. Every photo or
// placeholder underlay must use plushie-face-mask as well as the costume alpha.
const windows = [
  [208, 141, 405, 347],
  [205, 135, 402, 350],
  [210, 166, 405, 344],
  [195, 165, 403, 350],
  [202, 134, 407, 345],
  [204, 141, 405, 349],
] as const;

export function dollFaceRect(asset: BurrowArtAsset) {
  const [left, top, right, bottom] = dollFaceBounds(asset);
  return { left: `${left / asset.width * 100}%`, top: `${top / asset.height * 100}%`,
    width: `${(right-left) / asset.width * 100}%`, height: `${(bottom-top) / asset.height * 100}%` } as const;
}

export function dollFaceBounds(asset: BurrowArtAsset): readonly [number,number,number,number] {
  if (asset.photoBounds) return asset.photoBounds;
  const index = BURROW_ART.couple_dolls.indexOf(asset);
  return windows[Math.max(0,index)] ?? windows[0];
}

/** Every frame has the same 201×290 opening on its original 500px canvas. */
export function framePhotoRect(asset: BurrowArtAsset) {
  const [left, top, right, bottom] = FRAME_PHOTO_BOUNDS;
  return { left: `${left / asset.width * 100}%`, top: `${top / asset.height * 100}%`,
    width: `${(right - left) / asset.width * 100}%`, height: `${(bottom - top) / asset.height * 100}%` } as const;
}
