import { BURROW_ART, type BurrowArtAsset } from './burrow-art-assets';

// The photo sits behind the transparent opening in each 600×600 costume.
// These per-costume boxes only bound the photo; the artwork's own alpha is the
// actual mask, including the hairline, ears and irregular chin.
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
  const index = BURROW_ART.couple_dolls.indexOf(asset);
  return windows[Math.max(0,index)] ?? windows[0];
}
