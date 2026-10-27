import { Image } from './burrow-image';

const PACK_ART = {
  200: require('../../../assets/burrow-webp/Coin-purchase-page/200.webp'),
  400: require('../../../assets/burrow-webp/Coin-purchase-page/400.webp'),
  1000: require('../../../assets/burrow-webp/Coin-purchase-page/1000.webp'),
} as const;

/** Supplied purchase artwork, displayed without cropping or reconstruction. */
export function CoinPackArt({ amount }: { amount: 200 | 400 | 1000 }) {
  return <Image source={PACK_ART[amount]} contentFit="contain" cachePolicy="memory-disk" transition={0}
    accessible={false} pointerEvents="none" style={{ width: '100%', height: '100%' }}/>;
}
