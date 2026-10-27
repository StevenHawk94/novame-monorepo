import type {MajorUpdateCatalogItem} from '@/lib/app-major-update-api';
import {outfitKey} from '@/lib/burrow-outfit-assets';
import {BUNNY_THUMBNAILS} from '@/lib/bunny-variant-assets';
import {useBunnyVariant} from '@/lib/bunny-identity';
import {Image} from './burrow-image';
/** One baked bitmap per card, no Skia suites, mesh or animation listeners. */
export function OutfitThumbnail({outfit,size,tintColor}:{outfit:MajorUpdateCatalogItem;size:number;tintColor?:string}){
 const variant=useBunnyVariant();
 return <Image source={BUNNY_THUMBNAILS[outfitKey(outfit)][variant]} contentFit="contain" allowDownscaling enforceEarlyResizing
  tintColor={tintColor} accessibilityLabel={outfit.title} style={{width:size,height:size}}/>;
}
