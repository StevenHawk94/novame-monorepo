import { Image } from 'expo-image';
import { Image as NativeImage } from 'react-native';
import { COIN_UI_ASSET } from './coin-ui-asset';

let initialization: Promise<void> | undefined;
/**
 * Expo Image's iOS imperative loader lazily creates its shared image manager.
 * Serialize only that first initialization across feature warmers, not all
 * decodes. This is background work: navigation must never await this gate.
 */
export async function decodeNativeImage(...args: Parameters<typeof Image.loadAsync>) {
  if (!initialization) {
    initialization = Promise.resolve().then(async () => {
      const source = NativeImage.resolveAssetSource(COIN_UI_ASSET);
      await Image.loadAsync({ uri: source.uri }, { maxWidth: 8, maxHeight: 8 });
    }).catch(error => {
      initialization = undefined;
      throw error;
    });
  }
  await initialization;
  return Image.loadAsync(...args);
}
