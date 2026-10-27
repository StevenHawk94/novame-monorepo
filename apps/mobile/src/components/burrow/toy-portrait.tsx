import { StyleSheet, View } from 'react-native';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { burrowArtForItem } from '@/lib/burrow-art-assets';
import { dollFaceRect } from '@/lib/burrow-doll-face';
import { Image } from './burrow-image';
import {PlushieFaceMask} from './plushie-face-mask';

/** Fit the original canvas uniformly; preserve relative sizes across toys. */
export function ToyPortrait({ item, photo, width, height }: {
  item: MajorUpdateCatalogItem;
  photo?: MajorUpdateBootstrap['roomPhotos'][number];
  width: number;
  height: number;
}) {
  const art = burrowArtForItem(item, 'couple_dolls');
  if (!art) return null;
  const scale = Math.min(width / art.width, height / art.height);
  return <View pointerEvents="none" style={{ width, height }}>
    <View style={{ position: 'absolute', left: (width - art.width * scale) / 2,
      top: height - art.height * scale, width: art.width * scale, height: art.height * scale }}>
      <View style={[styles.face, dollFaceRect(art)]}><PlushieFaceMask asset={art} photo={photo} backgroundColor="#FFF6E8"/></View>
      <Image source={art.source} contentFit="fill" style={StyleSheet.absoluteFillObject}/>
      {photo&&<View style={[styles.face,dollFaceRect(art)]}><PlushieFaceMask asset={art} photo={photo} edgeOnly/></View>}
    </View>
  </View>;
}
const styles = StyleSheet.create({ face: { position: 'absolute', overflow: 'hidden' } });
