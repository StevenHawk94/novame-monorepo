import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { RoomPhoto } from './room-photo';

// Coordinates are taken from the 900 × 1950 positioning reference. The art
// canvas is aligned with the bottom of the whole display, including the tab
// bar, so shorter displays crop its top instead of pushing furniture down.
const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 1950;
const TAB_BAR_HEIGHT = 188;

type Art = { key: string; source: ImageSource; alternate?: ImageSource; slot?: string; x: number; y: number; width: number; height: number };
const art: Art[] = [
  { key: 'light-string', source: require('../../../assets/burrow/home-v1/light-string-01.webp'), x: 142, y: 436, width: 568, height: 105 },
  { key: 'window', slot: 'window', source: require('../../../assets/burrow/home-v1/placed-window.webp'), alternate: require('../../../assets/burrow/home-v1/window-02.webp'), x: 176, y: 570, width: 214, height: 245 },
  { key: 'shelf-radio', source: require('../../../assets/burrow/home-v1/placed-shelf-radio.webp'), x: 550, y: 580, width: 263, height: 210 },
  { key: 'shelf', source: require('../../../assets/burrow/home-v1/shelf-01.webp'), x: 565, y: 711, width: 245, height: 66 },
  { key: 'poster', slot: 'poster', source: require('../../../assets/burrow/home-v1/poster-01.webp'), alternate: require('../../../assets/burrow/home-v1/poster-02.webp'), x: 220, y: 829, width: 114, height: 158 },
  { key: 'dresser', slot: 'cabinet', source: require('../../../assets/burrow/home-v1/dresser-01.webp'), alternate: require('../../../assets/burrow/home-v1/dresser-02.webp'), x: 341, y: 1038, width: 292, height: 183 },
  { key: 'statue', source: require('../../../assets/burrow/home-v1/placed-statue.webp'), x: 480, y: 870, width: 130, height: 185 },
  { key: 'lamp', slot: 'lamp', source: require('../../../assets/burrow/home-v1/placed-lamp.webp'), alternate: require('../../../assets/burrow/home-v1/lamp-02.webp'), x: 85, y: 1010, width: 150, height: 180 },
  { key: 'cushion', slot: 'cushion', source: require('../../../assets/burrow/home-v1/placed-cushion.webp'), alternate: require('../../../assets/burrow/home-v1/cushion-02.webp'), x: 98, y: 1220, width: 360, height: 230 },
  { key: 'rug', slot: 'rug', source: require('../../../assets/burrow/home-v1/rug-01.webp'), alternate: require('../../../assets/burrow/home-v1/rug-02.webp'), x: 445, y: 1354, width: 430, height: 108 },
  { key: 'stump-table', slot: 'table', source: require('../../../assets/burrow/home-v1/table-01.webp'), alternate: require('../../../assets/burrow/home-v1/table-02.webp'), x: 543, y: 1207, width: 231, height: 216 },
  { key: 'envelope', source: require('../../../assets/burrow/home-v1/envelope.webp'), x: 578, y: 1228, width: 66, height: 51 },
  { key: 'flowers', slot: 'vase', source: require('../../../assets/burrow/home-v1/placed-flowers.webp'), alternate: require('../../../assets/burrow/home-v1/flower-02.webp'), x: 625, y: 1096, width: 165, height: 244 },
  { key: 'bunny', source: require('../../../assets/burrow/home-v1/bunny.webp'), x: 170, y: 1103, width: 220, height: 249 },
  { key: 'ladder', source: require('../../../assets/burrow/home-v1/ladder-01.webp'), x: 803, y: 817, width: 310, height: 480 },
];

type Props = {
  balance: number;
  slots: Record<string, MajorUpdateCatalogItem>;
  photos?: MajorUpdateBootstrap['roomPhotos'];
  ownerId: string;
  away?: boolean;
  busy?: boolean;
  onMenu: () => void;
  onCarrots: () => void;
  onQuests: () => void;
  onAdventure: () => void;
  onInbox: () => void;
  onBurrows: () => void;
  onDecorate: () => void;
  onSlot: (slot: string) => void;
};

export function HomeArtScene({ balance, slots, photos = [], ownerId, away, busy, onMenu, onCarrots, onQuests, onAdventure, onInbox, onBurrows, onDecorate, onSlot }: Props) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(window.width);
  const [height, setHeight] = useState(Math.max(0, window.height - Math.max(TAB_BAR_HEIGHT * window.width / DESIGN_WIDTH, insets.bottom + 58)));
  const scale = width / DESIGN_WIDTH;
  const tabBarHeight = Math.max(TAB_BAR_HEIGHT * scale, insets.bottom + 58);
  const frame = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'frame');
  const doll = photos.find(photo => photo.ownerId === ownerId && photo.kind === 'doll');
  const isAlternate = (slot?: string) => !!slot && !!slots[slot] && slots[slot].metadata.starter !== true;
  const box = (x: number, y: number, w: number, h: number) => ({ position: 'absolute' as const, left: x * scale, top: y * scale, width: w * scale, height: h * scale });
  const hotspot = (label: string, slot: string, x: number, y: number, w: number, h: number) =>
    <Pressable key={slot} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={() => onSlot(slot)} style={box(x, y, w, h)} />;

  return <View style={styles.root} onLayout={event => { setWidth(event.nativeEvent.layout.width); setHeight(event.nativeEvent.layout.height); }}>
    <StatusBar style="light" />
    <Image source={require('../../../assets/burrow/home-v1/home-background.webp')} contentFit="fill" pointerEvents="none"
      style={[styles.background, { height: Math.max(DESIGN_HEIGHT * scale, height + tabBarHeight), bottom: -tabBarHeight }]} />
    <View pointerEvents="box-none" style={[styles.canvas, { width, height: DESIGN_HEIGHT * scale, bottom: -tabBarHeight }]}>
      {art.map(item => <Image key={item.key} source={isAlternate(item.slot) ? item.alternate ?? item.source : item.source} contentFit="fill" style={box(item.x, item.y, item.width, item.height)} pointerEvents="none" />)}
      {isAlternate('music_player') && <Image source={require('../../../assets/burrow/home-v1/radio-02.webp')} contentFit="fill" style={box(684, 625, 107, 91)} pointerEvents="none" />}

      {/* User photos are private and never embedded in the bundled reference art. */}
      <View pointerEvents="none" style={box(638, 765, 118, 195)}>
        <Image source={isAlternate('frame') ? require('../../../assets/burrow/home-v1/photo-frame-02.webp') : require('../../../assets/burrow/home-v1/photo-frame-01.webp')} contentFit="fill" style={styles.fill} />
        <View style={styles.framePhoto}><RoomPhoto photo={frame} /></View>
      </View>
      <View pointerEvents="none" style={box(380, 885, 107, 165)}>
        <Image source={isAlternate('couple_doll') ? require('../../../assets/burrow/home-v1/interactive-toy-06.webp') : require('../../../assets/burrow/home-v1/interactive-toy-05.webp')} contentFit="fill" style={styles.fill} />
        <View style={styles.dollPhoto}><RoomPhoto photo={doll} circle /></View>
      </View>

      {hotspot(away ? 'Open adventure' : 'Feed bunny', 'bunny', 165, 1080, 250, 300)}
      {hotspot('Water flowers', 'vase', 630, 1090, 160, 240)}
      {hotspot('Open room photo', 'frame', 635, 760, 125, 205)}
      {hotspot('Edit doll face', 'couple_doll', 370, 880, 120, 175)}
      {hotspot('Choose music', 'music_player', 670, 600, 125, 135)}
      <Pressable accessibilityRole="button" accessibilityLabel="Open inbox" onPress={onInbox} style={box(570, 1210, 90, 80)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Explore our burrows" onPress={onBurrows} style={box(800, 910, 100, 385)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Decorate my burrow" onPress={onDecorate} style={box(340, 1040, 290, 180)} />
    </View>

    <View style={[styles.header, { top: Math.max(insets.top, 16 * scale), paddingHorizontal: 38 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onMenu} style={styles.menu}><Text style={styles.menuText}>☰</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Carrot Shop. Balance ${balance}`} onPress={onCarrots} style={styles.wallet}>
        <Text style={styles.carrot}>🥕</Text><Text style={styles.balance}>{balance.toLocaleString()}</Text><Text style={styles.plus}>＋</Text>
      </Pressable>
    </View>

    <View style={[styles.actions, { bottom: 105 * scale, paddingHorizontal: 100 * scale, gap: 92 * scale }]}>
      <Pressable accessibilityRole="button" onPress={onQuests} style={[styles.action, styles.quests, { height: 115 * scale, borderRadius: 30 * scale }]}><Text style={styles.actionText}>Quests</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onAdventure} style={[styles.action, styles.adventure, { height: 115 * scale, borderRadius: 30 * scale }]}><Text style={styles.actionText}>Adventure</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#B75833' },
  background: { position: 'absolute', left: 0, right: 0, width: '100%' },
  canvas: { position: 'absolute', left: 0 },
  fill: { width: '100%', height: '100%' },
  header: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menu: { width: 47, height: 46, alignItems: 'center', justifyContent: 'center' },
  menuText: { color: '#322017', fontSize: 43, fontWeight: '900', lineHeight: 45, textShadowColor: '#FFF8E9', textShadowRadius: 4, textShadowOffset: { width: 2, height: 2 } },
  wallet: { minHeight: 42, borderRadius: 30, backgroundColor: '#FFF9ED', flexDirection: 'row', alignItems: 'center', paddingLeft: 7, paddingRight: 5, gap: 7 },
  carrot: { fontSize: 23, textAlign: 'center', backgroundColor: '#F6A53D', borderRadius: 30, overflow: 'hidden', width: 34, height: 34 },
  balance: { fontSize: 20, fontWeight: '800', color: '#1C1B19' },
  plus: { fontSize: 27, fontWeight: '800', color: 'white', textAlign: 'center', lineHeight: 34, backgroundColor: '#188B69', borderRadius: 30, overflow: 'hidden', width: 34, height: 34 },
  actions: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  action: { flex: 1, justifyContent: 'center', alignItems: 'center', shadowColor: '#5E3925', shadowOpacity: 0.65, shadowRadius: 0, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  quests: { backgroundColor: '#56A184' }, adventure: { backgroundColor: '#CA8548' },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  framePhoto: { position: 'absolute', top: '34%', left: '19%', width: '62%', height: '52%', overflow: 'hidden' },
  dollPhoto: { position: 'absolute', top: '13%', left: '29%', width: '48%', height: '36%', borderRadius: 100, overflow: 'hidden' },
});
