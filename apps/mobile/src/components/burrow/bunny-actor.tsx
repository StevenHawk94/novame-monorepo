import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { OutfitBunny } from './outfit-bunny';

export type BunnyPose = 'idle' | 'sleeping' | 'digging' | 'away';
/** Shared real-art boundary. Only the supplied idle animation is implemented;
 * do not fabricate walking/sleeping sprites from retired SVG outfits. */
export function BunnyActor({ outfit, pose = 'idle', partner = false, standalone = false, standaloneSize,ownerId }: {
  outfit?: MajorUpdateCatalogItem; pose?: BunnyPose; partner?: boolean; standalone?: boolean;
  standaloneSize?: { width: number; height: number };
  ownerId?:string;
}) {
  const [size, setSize] = useState(standaloneSize ?? { width: 155, height: 195 });
  if (pose === 'away') return null;
  return <View pointerEvents="none" accessible accessibilityRole="image"
    accessibilityLabel={`${partner ? 'Your person’s bunny' : 'Your bunny'}, ${outfit?.title ?? 'Default'}, ${pose}`}
    onLayout={event => { const { width, height } = event.nativeEvent.layout;
      setSize(old => old.width === width && old.height === height ? old : { width, height }); }}
    style={[standalone ? styles.standalone : styles.actor, !standalone && partner && styles.partner, standalone && standaloneSize]}>
    <OutfitBunny outfit={outfit} ownerId={ownerId} width={size.width} height={size.height} animated={pose === 'idle'} />
  </View>;
}
const styles = StyleSheet.create({
  actor: { position: 'absolute', left: '14%', top: '55%', width: '32%', height: '28%' },
  partner: { left: '39%' },
  standalone: { width: 155, height: 195, alignSelf: 'center' },
});
