import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from './burrow-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { RoomPhoto } from './room-photo';
import { InteractiveDoll } from './interactive-doll';
import { dollFaceRect, framePhotoRect } from '@/lib/burrow-doll-face';
import { BURROW_FIXED_ART, burrowArtFor, burrowArtForItem } from '@/lib/burrow-art-assets';
import { HOME_ART_HEIGHT, HOME_ART_WIDTH, HOME_ART_PLACEMENTS as art, HOME_DOLL_PLACEMENT as dollPlacement, HOME_FRAME_PLACEMENT, HOME_BUNNY_PLACEMENT, HOME_LETTER_PLACEMENT, homeAnchoredBox as anchoredBox, homeArtLayout, homeTabBarHeight } from '@/lib/burrow-home-layout';

// Coordinates are taken from the 900 × 1950 positioning reference. The art
// canvas is aligned with the bottom of the whole display, including the tab
// bar, so shorter displays crop its top instead of pushing furniture down.
export const DESIGN_WIDTH = HOME_ART_WIDTH;
export const DESIGN_HEIGHT = HOME_ART_HEIGHT;

type Props = {
  balance: number;
  slots: Record<string, MajorUpdateCatalogItem>;
  photos?: MajorUpdateBootstrap['roomPhotos'];
  ownerId: string;
  away?: boolean;
  busy?: boolean;
  onMenu: () => void;
  onCarrots: () => void;
  onAffection: () => void;
  previewBottomCrop?: number;
  previewOnly?: boolean;
  previewInteractive?: boolean;
  initialSize?: { width: number; height: number };
  onToyInteract?: () => void;
  onToyPhoto?: () => void;
  toyPulse?: number;
  onAdventure: () => void;
  onLetter: () => void;
  onBurrows: () => void;
  onDecorate: () => void;
  onSlot: (slot: string) => void;
};

export function HomeArtScene({ balance, slots, photos = [], ownerId, away, busy, onMenu, onCarrots, onAffection, previewOnly = false, previewInteractive = false, previewBottomCrop = 0, initialSize, onToyInteract, onToyPhoto, toyPulse = 0, onAdventure, onLetter, onBurrows, onDecorate, onSlot }: Props) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [layout, setLayout] = useState(() => initialSize ?? {
    width: window.width,
    height: window.height - homeTabBarHeight(window.width, insets.bottom),
  });
  const tabBarHeight = homeTabBarHeight(layout.width, insets.bottom);
  const { scale, artWidth, left: artLeft } = homeArtLayout(layout.width, layout.height, tabBarHeight, previewOnly);
  const frame = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'frame');
  const doll = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'doll');
  const dollArt = burrowArtForItem(slots.couple_doll, 'couple_dolls');
  const wallpaper = burrowArtForItem(slots.wallpaper, 'wallpapers') ?? burrowArtFor('wallpapers')!;
  const season = burrowArtForItem(slots.background, 'backgrounds') ?? burrowArtFor('backgrounds')!;
  const box = (x: number, y: number, w: number, h: number) => ({ position: 'absolute' as const, left: x * scale, top: y * scale, width: w * scale, height: h * scale });
  const hotspot = (label: string, slot: string, x: number, y: number, w: number, h: number) =>
    <Pressable key={slot} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={() => onSlot(slot)} style={box(x, y, w, h)} />;

  return <View style={styles.root} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setLayout(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    {!previewOnly&&<StatusBar hidden />}
    {!previewOnly&&<><Image source={wallpaper.source} contentFit="cover" contentPosition="top"
      pointerEvents="none" style={styles.backgroundFill} /><View pointerEvents="none" style={styles.backgroundMask} /></>}
    <View pointerEvents="box-none" style={[styles.canvas, { left: artLeft, width: artWidth, height: DESIGN_HEIGHT * scale, bottom: previewOnly ? -previewBottomCrop * scale : -tabBarHeight }]}>
      <Image source={wallpaper.source} contentFit="fill" pointerEvents="none" style={box(0, DESIGN_HEIGHT - 700 - 1200, 900, 1200)} />
      {/* Seasonal art includes the cave rim and floor, with a transparent wall.
          Bottom alignment crops the supplied 2000px sheet by 50px, as in the reference. */}
      <Image source={season.source} contentFit="fill" pointerEvents="none" style={box(0, -50, 900, 2000)} />
      {art.map(item => {
        const asset = burrowArtForItem(slots[item.slot], item.category);
        return asset && <Image key={item.key} source={asset.source} contentFit="fill" style={anchoredBox(asset, item, scale)} pointerEvents="none" />;
      })}
      {!away && <Image source={BURROW_FIXED_ART.bunny.source} contentFit="fill" pointerEvents="none" style={anchoredBox(BURROW_FIXED_ART.bunny, HOME_BUNNY_PLACEMENT, scale)} />}

      {/* User photos are private and never embedded in the bundled reference art. */}
      {(() => { const asset = burrowArtForItem(slots.frame, 'frames');
        return asset && <View pointerEvents="none" style={anchoredBox(asset, HOME_FRAME_PLACEMENT, scale)}>
          <Image source={asset.source} contentFit="fill" style={styles.fill} />
          {frame && <View style={[styles.framePhoto, framePhotoRect(asset)]}><RoomPhoto photo={frame} /></View>}
        </View>; })()}
      {dollArt&&(previewOnly?<View pointerEvents="none" style={anchoredBox(dollArt, dollPlacement, scale)}>
        {doll && <View style={[styles.dollPhoto,dollFaceRect(dollArt)]}><RoomPhoto photo={doll} /></View>}<Image source={dollArt.source} contentFit="fill" style={styles.fill} />
      </View>:<InteractiveDoll asset={dollArt} photo={doll} pulse={toyPulse} disabled={busy} onInteract={onToyInteract} onEditPhoto={onToyPhoto}
        style={box(330, 880, 110, 180)} artStyle={{...anchoredBox(dollArt, dollPlacement, scale),
          left: anchoredBox(dollArt, dollPlacement, scale).left - 330 * scale,
          top: anchoredBox(dollArt, dollPlacement, scale).top - 880 * scale}} />)}
      <Image source={BURROW_FIXED_ART.letter.source} contentFit="fill" pointerEvents="none" style={anchoredBox(BURROW_FIXED_ART.letter, HOME_LETTER_PLACEMENT, scale)} />

      {previewInteractive&&art.map(item=>{
        const asset=burrowArtForItem(slots[item.slot],item.category);
        if(!asset)return null;
        const [left,top,right,bottom]=asset.bounds;
        const placed=anchoredBox(asset,item,scale);
        return <Pressable key={`select-${item.slot}`} accessibilityRole="button" accessibilityLabel={`Select ${item.category.replaceAll('_',' ')}`}
          onPress={()=>onSlot(item.slot)} style={{position:'absolute',left:placed.left+left*placed.width/asset.width,
            top:placed.top+top*placed.height/asset.height,width:(right-left)*placed.width/asset.width,
            height:(bottom-top)*placed.height/asset.height}}/>;
      })}
      {previewInteractive&&<>
        {hotspot('Select photo frames', 'frame', 635, 755, 125, 190)}
        {hotspot('Select couple dolls', 'couple_doll', 330, 880, 110, 180)}
        {hotspot('Select outfits', 'outfit', 125, 1158, 205, 255)}
      </>}

      {!previewOnly&&<>{hotspot(away ? 'Open adventure' : 'Feed bunny', 'bunny', 125, 1158, 205, 255)}
      {hotspot('Water flowers', 'vase', 610, 1118, 140, 190)}
      {hotspot('Open room photo', 'frame', 635, 760, 125, 205)}
      {hotspot('Choose music', 'music_player', 670, 600, 125, 135)}
      <Pressable accessibilityRole="button" accessibilityLabel="Write a love letter" onPress={onLetter} style={box(550, 1245, 85, 65)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Explore our burrows" onPress={onBurrows} style={box(755, 915, 145, 365)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Decorate my burrow" onPress={onDecorate} style={box(278, 1060, 325, 190)} /></>}
    </View>

    {!previewOnly&&<><View style={[styles.header, { top: 44 * scale, paddingHorizontal: 38 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onMenu} style={[styles.menu, { width: 82 * scale, height: 74 * scale }]}>
        <View style={{ gap: 3 * scale }}>{[0, 1, 2].map(index => <View key={index} style={[styles.menuBar, { width: 77 * scale, height: 16 * scale, borderWidth: 4 * scale }]} />)}</View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Carrot Shop. Balance ${balance}`} onPress={onCarrots} style={[styles.wallet, { minHeight: 74 * scale, gap: 8 * scale, paddingLeft: 10 * scale, paddingRight: 9 * scale }]}>
        <Text style={[styles.carrot, { width: 60 * scale, height: 60 * scale, fontSize: 42 * scale }]}>🥕</Text><Text style={[styles.balance, { fontSize: 36 * scale }]}>{balance.toLocaleString()}</Text><Text style={[styles.plus, { width: 60 * scale, height: 60 * scale, lineHeight: 60 * scale, fontSize: 52 * scale }]}>＋</Text>
      </Pressable>
    </View>

    <View style={[styles.actions, { bottom: 101 * scale, paddingHorizontal: 90 * scale, gap: 105 * scale }]}>
      <Pressable accessibilityRole="button" onPress={onAffection} style={[styles.action, { height: 115 * scale, borderRadius: 30 * scale }]}><Text style={[styles.actionText, { fontSize: 24 * scale }]}>Affection</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onAdventure} style={[styles.action, { height: 115 * scale, borderRadius: 30 * scale }]}><Text style={[styles.actionText, { fontSize: 24 * scale, color: '#704038' }]}>Adventure</Text></Pressable>
    </View></>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#B75833' },
  backgroundFill: { ...StyleSheet.absoluteFillObject },
  backgroundMask: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(37, 20, 13, 0.35)' },
  canvas: { position: 'absolute' },
  fill: { width: '100%', height: '100%' },
  header: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menu: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  menuBar: { width: 37, height: 9, borderRadius: 8, borderWidth: 2, borderColor: '#FFF9F2', backgroundColor: '#281B16' },
  wallet: { minHeight: 42, borderRadius: 30, backgroundColor: '#FFF9ED', flexDirection: 'row', alignItems: 'center', paddingLeft: 7, paddingRight: 5, gap: 7 },
  carrot: { fontSize: 23, textAlign: 'center', backgroundColor: '#F6A53D', borderRadius: 30, overflow: 'hidden', width: 34, height: 34 },
  balance: { fontSize: 20, fontWeight: '800', color: '#1C1B19' },
  plus: { fontSize: 27, fontWeight: '800', color: 'white', textAlign: 'center', lineHeight: 34, backgroundColor: '#188B69', borderRadius: 30, overflow: 'hidden', width: 34, height: 34 },
  actions: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  action: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF2DC', shadowColor: '#D8872C', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  actionText: { color: '#583418', fontSize: 13, fontWeight: '700' },
  framePhoto: { position: 'absolute', overflow: 'hidden' },
  dollPhoto: { position: 'absolute', overflow: 'hidden' },
});
