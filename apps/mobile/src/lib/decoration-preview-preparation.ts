import type {MajorUpdateCatalogItem} from './app-major-update-api';
import {burrowArtForItem} from './burrow-art-assets';
import {outfitKey} from './burrow-outfit-assets';
import {BUNNY_THUMBNAILS,type BunnyVariant} from './bunny-variant-assets';
import {createShopArtWarmer,type ArtWarmup} from './burrow-shop-thumbnails';

/** Only current, public, static slot art. Never initialize Skia, fetch private
 * photos, refresh the environment, or replace the real Home retention set.
 * Missing still-selected art stays eligible; already decoded refs are reused
 * by the shared cache. This does not gate or publish any selection state. */
export function decorationPreviewArt(slots:Record<string,MajorUpdateCatalogItem>,variant:BunnyVariant):ArtWarmup[]{
  return Object.entries(slots).flatMap(([slot,item]):ArtWarmup[]=>{
    if(slot==='outfit')return [{source:BUNNY_THUMBNAILS[outfitKey(item)][variant],size:512}];
    const art=burrowArtForItem(item);
    return art?[{source:art.source,size:Math.max(art.width,art.height)}]:[];
  });
}
/** Same two workers as the visible product rail: rapid selections replace only
 * obsolete queued work. In-flight native decodes can finish into PUBLIC cache;
 * they have no callback capable of restoring A after the user selected B. */
export function createDecorationPreviewWarmer(){return createShopArtWarmer();}
