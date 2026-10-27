import masks from './generated/plushie-face-masks.json';
import type {BurrowArtAsset} from './burrow-art-assets';

/** Precomputed once from each costume's enclosed face opening. No per-frame
 * image inspection and no colour-based deletion of white clothes/highlights. */
export function plushieFaceMask(asset:BurrowArtAsset){
 const mask=masks[asset.name as keyof typeof masks];
 if(!mask||asset.width!==mask.canvas[0]||asset.height!==mask.canvas[1]
  ||!asset.photoBounds?.every((value,index)=>value===mask.bounds[index]))return null;
 return mask;
}
