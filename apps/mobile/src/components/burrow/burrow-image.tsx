import { Image as ExpoImage, type ImageProps } from 'expo-image';
import { Image as NativeImage } from 'react-native';
import { normalizeMetroAssetUri } from '@/lib/metro-asset-uri';

export function resolveBurrowImageSource(source: ImageProps['source']): ImageProps['source'] {
  if (Array.isArray(source)) return source.map(item => resolveBurrowImageSource(item)) as ImageProps['source'];
  const resolved = typeof source === 'number' ? NativeImage.resolveAssetSource(source) : source;
  if (resolved && typeof resolved === 'object' && 'uri' in resolved && typeof resolved.uri === 'string') {
    const uri = normalizeMetroAssetUri(resolved.uri);
    if (uri !== resolved.uri) return { ...resolved, uri };
  }
  return source;
}

/** Decode supplied transparent artwork consistently with libwebp on iOS,
 * avoiding platform-codec differences. Keep the originals as WebP, not PNG
 * duplicates. Shared by Home, previews, item cards and other Burrow pages. */
export function Image(props: ImageProps) {
  return <ExpoImage cachePolicy="memory-disk" transition={0} {...props} source={resolveBurrowImageSource(props.source)} useAppleWebpCodec={false}
    onError={event => {
      if (__DEV__ && typeof props.source === 'number') console.warn('[Burrow bundled art]', event.error);
      props.onError?.(event);
    }} />;
}
