import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { RoomPhoto } from './room-photo';
import { BunnyActor } from './bunny-actor';
import { InteractiveDoll } from './interactive-doll';
import { BURROW_BACKGROUNDS, BURROW_FIXED_ART, burrowArtForItem, type BurrowArtAsset } from '@/lib/burrow-art-assets';
import { HOME_ART_HEIGHT, HOME_ART_WIDTH, homeArtLayout } from '@/lib/burrow-home-layout';

// Coordinates are taken from the 900 × 1950 positioning reference. The art
// canvas is aligned with the bottom of the whole display, including the tab
// bar, so shorter displays crop its top instead of pushing furniture down.
export const DESIGN_WIDTH = HOME_ART_WIDTH;
export const DESIGN_HEIGHT = HOME_ART_HEIGHT;
const TAB_BAR_HEIGHT = 160;

type Placement = { key: string; category: string; slot: string; x: number; anchorY: number; visibleWidth: number; anchor: 'top' | 'bottom' };
// The anchor is measured on the visible pixels, not the transparent image
// canvas. Supporting furniture starts at its top; objects resting on furniture
// or the floor meet their support at their bottom.
const art: Placement[] = [
  { key: 'light-string', category: 'light_strings', slot: 'light_string', x: 146, anchorY: 416, visibleWidth: 563, anchor: 'top' },
  { key: 'window', category: 'windows', slot: 'window', x: 178, anchorY: 594, visibleWidth: 200, anchor: 'top' },
  { key: 'shelf', category: 'shelves', slot: 'shelf', x: 564, anchorY: 713, visibleWidth: 248, anchor: 'top' },
  { key: 'shelf-decor', category: 'shelf_decor', slot: 'shelf_decor', x: 582, anchorY: 715, visibleWidth: 73, anchor: 'bottom' },
  { key: 'radio', category: 'music_players', slot: 'music_player', x: 683, anchorY: 715, visibleWidth: 108, anchor: 'bottom' },
  { key: 'poster', category: 'posters', slot: 'poster', x: 220, anchorY: 829, visibleWidth: 114, anchor: 'top' },
  { key: 'dresser', category: 'cabinets', slot: 'cabinet', x: 341, anchorY: 1038, visibleWidth: 292, anchor: 'top' },
  { key: 'dresser-plant', category: 'dresser_plants', slot: 'dresser_plant', x: 505, anchorY: 1033, visibleWidth: 72, anchor: 'bottom' },
  { key: 'lamp', category: 'lamps', slot: 'lamp', x: 103, anchorY: 1162, visibleWidth: 103, anchor: 'bottom' },
  { key: 'rug', category: 'rugs', slot: 'rug', x: 445, anchorY: 1462, visibleWidth: 434, anchor: 'bottom' },
  { key: 'cushion', category: 'cushions', slot: 'cushion', x: 110, anchorY: 1421, visibleWidth: 335, anchor: 'bottom' },
  { key: 'table', category: 'tables', slot: 'table', x: 543, anchorY: 1233, visibleWidth: 234, anchor: 'top' },
  { key: 'flowers', category: 'vases', slot: 'vase', x: 637, anchorY: 1285, visibleWidth: 140, anchor: 'bottom' },
  { key: 'ladder', category: 'ladders', slot: 'ladder', x: 785, anchorY: 1275, visibleWidth: 180, anchor: 'bottom' },
];

function anchoredBox(asset: BurrowArtAsset, placement: Placement, scale: number) {
  const [left, top, right, bottom] = asset.bounds;
  const ratio = placement.visibleWidth / (right - left);
  return {
    position: 'absolute' as const,
    left: (placement.x - left * ratio) * scale,
    top: (placement.anchorY - (placement.anchor === 'top' ? top : bottom) * ratio) * scale,
    width: asset.width * ratio * scale,
    height: asset.height * ratio * scale,
  };
}

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
  unreadAffection?: number;
  previewOnly?: boolean;
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

export function HomeArtScene({ balance, slots, photos = [], ownerId, away, busy, onMenu, onCarrots, onAffection, unreadAffection = 0, previewOnly = false, initialSize, onToyInteract, onToyPhoto, toyPulse = 0, onAdventure, onLetter, onBurrows, onDecorate, onSlot }: Props) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [layout, setLayout] = useState(() => initialSize ?? {
    width: window.width,
    height: window.height - Math.max(TAB_BAR_HEIGHT * window.width / DESIGN_WIDTH, insets.bottom + 58),
  });
  const widthScale = layout.width / DESIGN_WIDTH;
  const tabBarHeight = Math.max(TAB_BAR_HEIGHT * widthScale, insets.bottom + 58);
  const { scale, artWidth, left: artLeft } = homeArtLayout(layout.width, layout.height, tabBarHeight, previewOnly);
  const frame = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'frame');
  const doll = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'doll');
  const dollArt = burrowArtForItem(slots.couple_doll, 'couple_dolls');
  const dollPlacement: Placement = { key: 'doll', category: 'couple_dolls', slot: 'couple_doll', x: 386, anchorY: 1056, visibleWidth: 95, anchor: 'bottom' };
  const box = (x: number, y: number, w: number, h: number) => ({ position: 'absolute' as const, left: x * scale, top: y * scale, width: w * scale, height: h * scale });
  const hotspot = (label: string, slot: string, x: number, y: number, w: number, h: number) =>
    <Pressable key={slot} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={() => onSlot(slot)} style={box(x, y, w, h)} />;

  return <View style={styles.root} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setLayout(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    {!previewOnly&&<StatusBar hidden />}
    {!previewOnly&&<><Image source={BURROW_BACKGROUNDS.home} contentFit="cover" contentPosition="bottom"
      pointerEvents="none" style={styles.backgroundFill} /><View pointerEvents="none" style={styles.backgroundMask} /></>}
    <Image source={BURROW_BACKGROUNDS.home} contentFit="fill" pointerEvents="none"
      style={[styles.background, { left: artLeft, width: artWidth, height: DESIGN_HEIGHT * scale, bottom: previewOnly ? 0 : -tabBarHeight }]} />
    <View pointerEvents="box-none" style={[styles.canvas, { left: artLeft, width: artWidth, height: DESIGN_HEIGHT * scale, bottom: previewOnly ? 0 : -tabBarHeight }]}>
      {art.map(item => {
        const asset = burrowArtForItem(slots[item.slot], item.category);
        return asset && <Image key={item.key} source={asset.source} contentFit="fill" style={anchoredBox(asset, item, scale)} pointerEvents="none" />;
      })}
      {!away && <View pointerEvents="none" style={box(180, 1109, 205, 240)}><BunnyActor standalone standaloneSize={{width:205*scale,height:240*scale}} pose="sleeping" /></View>}

      {/* User photos are private and never embedded in the bundled reference art. */}
      {(() => { const asset = burrowArtForItem(slots.frame, 'frames'); const placement: Placement = {key:'frame',category:'frames',slot:'frame',x:639,anchorY:763,visibleWidth:115,anchor:'top'};
        return asset && <View pointerEvents="none" style={anchoredBox(asset, placement, scale)}>
          <View style={styles.framePhoto}><RoomPhoto photo={frame} /></View><Image source={asset.source} contentFit="fill" style={styles.fill} />
        </View>; })()}
      {dollArt&&(previewOnly?<View pointerEvents="none" style={anchoredBox(dollArt, dollPlacement, scale)}>
        <View style={styles.dollPhoto}><RoomPhoto photo={doll} circle /></View><Image source={dollArt.source} contentFit="fill" style={styles.fill} />
      </View>:<InteractiveDoll asset={dollArt} photo={doll} pulse={toyPulse} disabled={busy} onInteract={onToyInteract} onEditPhoto={onToyPhoto}
        style={box(370, 880, 120, 175)} artStyle={{...anchoredBox(dollArt, dollPlacement, scale),
          left: anchoredBox(dollArt, dollPlacement, scale).left - 370 * scale,
          top: anchoredBox(dollArt, dollPlacement, scale).top - 880 * scale}} />)}
      <Image source={BURROW_FIXED_ART.loveLetter} contentFit="contain" pointerEvents="none" style={box(578, 1228, 66, 51)} />

      {!previewOnly&&<>{hotspot(away ? 'Open adventure' : 'Feed bunny', 'bunny', 165, 1080, 250, 300)}
      {hotspot('Water flowers', 'vase', 630, 1090, 160, 240)}
      {hotspot('Open room photo', 'frame', 635, 760, 125, 205)}
      {hotspot('Choose music', 'music_player', 670, 600, 125, 135)}
      <Pressable accessibilityRole="button" accessibilityLabel="Write a love letter" onPress={onLetter} style={box(570, 1210, 90, 80)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Explore our burrows" onPress={onBurrows} style={box(800, 910, 100, 385)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Decorate my burrow" onPress={onDecorate} style={box(340, 1060, 290, 160)} /></>}
    </View>

    {!previewOnly&&<><View style={[styles.header, { top: 44 * scale, paddingHorizontal: 38 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onMenu} style={styles.menu}>
        <View style={styles.menuBars}><View style={styles.menuBar}/><View style={styles.menuBar}/><View style={styles.menuBar}/></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Carrot Shop. Balance ${balance}`} onPress={onCarrots} style={styles.wallet}>
        <Text style={styles.carrot}>🥕</Text><Text style={styles.balance}>{balance.toLocaleString()}</Text><Text style={styles.plus}>＋</Text>
      </Pressable>
    </View>

    <View style={[styles.actions, { bottom: 133 * scale, paddingHorizontal: 100 * scale, gap: 92 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={unreadAffection ? `Affection, ${unreadAffection} unread` : 'Affection'} onPress={onAffection} style={[styles.action, styles.quests, { height: 115 * scale, borderRadius: 30 * scale }]}><Text style={styles.actionText}>Affection</Text>{unreadAffection > 0 && <View style={styles.unreadDot} />}</Pressable>
      <Pressable accessibilityRole="button" onPress={onAdventure} style={[styles.action, styles.adventure, { height: 115 * scale, borderRadius: 30 * scale }]}><Text style={styles.actionText}>Adventure</Text></Pressable>
    </View></>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#B75833' },
  background: { position: 'absolute' },
  backgroundFill: { ...StyleSheet.absoluteFillObject },
  backgroundMask: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(37, 20, 13, 0.35)' },
  canvas: { position: 'absolute' },
  fill: { width: '100%', height: '100%' },
  header: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menu: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  menuBars: { gap: 3 },
  menuBar: { width: 37, height: 9, borderRadius: 8, borderWidth: 2, borderColor: '#FFF9F2', backgroundColor: '#281B16' },
  wallet: { minHeight: 42, borderRadius: 30, backgroundColor: '#FFF9ED', flexDirection: 'row', alignItems: 'center', paddingLeft: 7, paddingRight: 5, gap: 7 },
  carrot: { fontSize: 23, textAlign: 'center', backgroundColor: '#F6A53D', borderRadius: 30, overflow: 'hidden', width: 34, height: 34 },
  balance: { fontSize: 20, fontWeight: '800', color: '#1C1B19' },
  plus: { fontSize: 27, fontWeight: '800', color: 'white', textAlign: 'center', lineHeight: 34, backgroundColor: '#188B69', borderRadius: 30, overflow: 'hidden', width: 34, height: 34 },
  actions: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  action: { flex: 1, justifyContent: 'center', alignItems: 'center', shadowColor: '#5E3925', shadowOpacity: 0.65, shadowRadius: 0, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  quests: { backgroundColor: '#56A184' }, adventure: { backgroundColor: '#CA8548' },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  framePhoto: { position: 'absolute', top: '29%', left: '30%', width: '40%', height: '54%', overflow: 'hidden' },
  dollPhoto: { position: 'absolute', top: '25%', left: '29%', width: '42%', height: '30%', borderRadius: 100, overflow: 'hidden' },
  unreadDot: { position: 'absolute', right: 10, top: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: '#E84B45', borderWidth: 2, borderColor: '#FFF8ED' },
});
