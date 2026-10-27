import { Image as ExpoImage, type ImageProps } from 'expo-image';
import { Image as NativeImage } from 'react-native';
import { useEffect } from 'react';
import { useR2AssetRevision } from '@/lib/use-r2-asset-revision';
import { getAndroidR2CachedUri } from '@/lib/android-r2-file-cache';
import { enqueueR2Image } from '@/lib/download-queue';
import { normalizeMetroAssetUri } from '@/lib/metro-asset-uri';
import { preparedBurrowImage } from '@/lib/prepared-burrow-images';

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
  const raw = props.source;
  const url = raw && typeof raw === 'object' && !Array.isArray(raw) && 'uri' in raw && typeof raw.uri === 'string'
    && raw.uri.startsWith('https://media.novameapp.com/burrow/adventure-gifts/') ? raw.uri : null;
  useR2AssetRevision(url);
  useEffect(() => { if (url) enqueueR2Image(url, -1); }, [url]);
  const cached = url ? getAndroidR2CachedUri(url) : null;
  return <ExpoImage cachePolicy="memory-disk" transition={0} {...props} source={preparedBurrowImage(props.source) ?? (cached ? { uri: cached } : resolveBurrowImageSource(props.source))} useAppleWebpCodec={false}
    onError={event => {
      if (__DEV__ && typeof props.source === 'number') console.warn('[Burrow bundled art]', event.error);
      props.onError?.(event);
    }} />;
}
