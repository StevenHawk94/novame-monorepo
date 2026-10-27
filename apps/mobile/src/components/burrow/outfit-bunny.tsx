import type { ComponentType } from 'react';
import { Platform, TurboModuleRegistry, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { OUTFIT_LAYERS, outfitKey } from '@/lib/burrow-outfit-assets';
import { BUNNY_RIG, bunnyViewport } from '@/lib/bunny-idle-motion';
import { Image } from './burrow-image';
import {BUNNY_THUMBNAILS,bunnyLayers,type BunnyVariant} from '@/lib/bunny-variant-assets';
import {useBunnyVariant} from '@/lib/bunny-identity';

export type OutfitBunnyProps = { outfit?: MajorUpdateCatalogItem; width: number; height: number;
  style?: StyleProp<ViewStyle>; animated?: boolean; active?: boolean;variant?:BunnyVariant;ownerId?:string;staticComposite?:boolean };
let NativeBunny: ComponentType<OutfitBunnyProps> | null = null;
let nativeChecked = false;
// Old dev clients may lack Skia. Keep the room usable until their next native
// build, with the real five-layer pose rather than the retired SVG placeholder.
function animatedRenderer() {
  if (!nativeChecked) {
    nativeChecked = true;
    if (Platform.OS !== 'web' && (globalThis.SkiaApi || TurboModuleRegistry.get('RNSkiaModule'))) {
      try { NativeBunny = require('./outfit-bunny-native').NativeOutfitBunny; }
      catch (error) { if (__DEV__) console.warn('[Bunny renderer unavailable]', error); }
    }
  }
  return NativeBunny;
}
export function StaticOutfitBunny({ outfit, width, height, style,variant='biscuit',staticComposite=false }: OutfitBunnyProps) {
  const key = outfitKey(outfit), layers = bunnyLayers(key,variant), fit = bunnyViewport(width, height);
  return <View pointerEvents="none" style={[{ width, height }, style]}>
    {staticComposite ? <Image source={BUNNY_THUMBNAILS[key][variant]} testID="bunny-static-composite"
      contentFit="contain" allowDownscaling enforceEarlyResizing cachePolicy="memory-disk"
      style={{position:'absolute',left:fit.x,top:fit.y,width:BUNNY_RIG.sourceCanvas.width*fit.scale,height:BUNNY_RIG.sourceCanvas.height*fit.scale}}/>
      : BUNNY_RIG.drawOrderBottomToTop.map(layer => <Image key={`${key}/${layer}`} source={layers[layer as keyof typeof layers] as number}
      // The image view has exactly the source aspect ratio. Contain preserves
      // full-canvas alignment AND allows thumbnail-sized native decoding;
      // fill disables downscaling in expo-image. Cache the displayed-size
      // images for quick A → B → A selection without retaining full textures.
      contentFit="contain" allowDownscaling enforceEarlyResizing cachePolicy="memory-disk"
      // Source identity owns the view. expo-image iOS recyclingKey can clear a
      // SharedRef bitmap AFTER rendering it; no URI remains to reload it. A new
      // keyed view avoids that prop-order race and reuses the same image cache.
      style={{ position: 'absolute', left: fit.x, top: fit.y,
        width: BUNNY_RIG.sourceCanvas.width * fit.scale, height: BUNNY_RIG.sourceCanvas.height * fit.scale }} />)}
  </View>;
}
export function OutfitBunny(props: OutfitBunnyProps) {
  const chosen=useBunnyVariant(props.ownerId);
  const resolved={...props,variant:props.variant??chosen};
  // Shop/Collection previews must bypass native decoding, meshes, clocks and
  // accessibility/listener setup entirely, not just pause their animation.
  if (props.animated === false) return <StaticOutfitBunny {...resolved} />;
  const Renderer = animatedRenderer();
  return Renderer ? <Renderer {...resolved} /> : <StaticOutfitBunny {...resolved} />;
}
