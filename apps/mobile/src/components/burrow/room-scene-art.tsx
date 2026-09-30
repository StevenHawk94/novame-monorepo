import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { MajorUpdateCatalogItem, MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS, burrowArtForItem, type BurrowArtAsset } from '@/lib/burrow-art-assets';
import { BunnyActor } from './bunny-actor';
import { RoomPhoto } from './room-photo';
import { InteractiveDoll } from './interactive-doll';

type Placement = { category: string; slot: string; x: number; y: number; width: number; anchor: 'top' | 'bottom' };
const ROOM_WIDTH = 360;
const furniture: Placement[] = [
  { category: 'light_strings', slot: 'light_string', x: 45, y: 65, width: 270, anchor: 'top' },
  { category: 'windows', slot: 'window', x: 60, y: 125, width: 90, anchor: 'top' },
  { category: 'shelves', slot: 'shelf', x: 228, y: 185, width: 110, anchor: 'top' },
  { category: 'shelf_decor', slot: 'shelf_decor', x: 235, y: 185, width: 35, anchor: 'bottom' },
  { category: 'music_players', slot: 'music_player', x: 295, y: 185, width: 43, anchor: 'bottom' },
  { category: 'posters', slot: 'poster', x: 82, y: 240, width: 44, anchor: 'top' },
  { category: 'cabinets', slot: 'cabinet', x: 148, y: 300, width: 115, anchor: 'top' },
  { category: 'dresser_plants', slot: 'dresser_plant', x: 145, y: 300, width: 30, anchor: 'bottom' },
  { category: 'lamps', slot: 'lamp', x: 35, y: 355, width: 60, anchor: 'bottom' },
  { category: 'rugs', slot: 'rug', x: 200, y: 430, width: 145, anchor: 'bottom' },
  { category: 'cushions', slot: 'cushion', x: 40, y: 420, width: 125, anchor: 'bottom' },
  { category: 'tables', slot: 'table', x: 225, y: 365, width: 90, anchor: 'top' },
  { category: 'vases', slot: 'vase', x: 260, y: 365, width: 60, anchor: 'bottom' },
  { category: 'ladders', slot: 'ladder', x: 327, y: 365, width: 50, anchor: 'bottom' },
];

function artStyle(asset: BurrowArtAsset, placement: Placement, scale: number) {
  const [left, top, right, bottom] = asset.bounds;
  const ratio = placement.width / (right - left);
  return {
    position: 'absolute' as const,
    left: (placement.x - left * ratio) * scale,
    top: (placement.y - (placement.anchor === 'top' ? top : bottom) * ratio) * scale,
    width: asset.width * ratio * scale,
    height: asset.height * ratio * scale,
  };
}

export function RoomSceneArt({ slots, away, shared = false, sleeping, photos = [], onSlot, partnerOutfit, busy = false, canFeed = true }: {
  slots: Record<string, MajorUpdateCatalogItem>;
  away?: boolean;
  shared?: boolean;
  sleeping?: { mine: boolean; partner: boolean };
  photos?: MajorUpdateBootstrap['roomPhotos'];
  onSlot?: (slot: string) => void;
  partnerOutfit?: MajorUpdateCatalogItem;
  busy?: boolean;
  canFeed?: boolean;
}) {
  const [width, setWidth] = useState(ROOM_WIDTH);
  const scale = width / ROOM_WIDTH;
  const photo = photos.find(item => item.kind === 'frame');
  const doll = photos.find(item => item.kind === 'doll');
  const frameArt = burrowArtForItem(slots.frame, 'frames');
  const dollArt = burrowArtForItem(slots.couple_doll, 'couple_dolls');
  const framePlacement: Placement = { category: 'frames', slot: 'frame', x: 261, y: 221, width: 47, anchor: 'top' };
  const dollPlacement: Placement = { category: 'couple_dolls', slot: 'couple_doll', x: 176, y: 300, width: 39, anchor: 'bottom' };
  const target = (slot: string, x: number, y: number, w: number, h: number) =>
    <Pressable key={slot} accessibilityRole="button" accessibilityLabel={slots[slot]?.title ?? slot} disabled={busy || !onSlot} onPress={() => onSlot?.(slot)}
      style={{ position: 'absolute', left: x * scale, top: y * scale, width: w * scale, height: h * scale }} />;

  return <View style={styles.scene} onLayout={event => setWidth(event.nativeEvent.layout.width)} accessibilityLabel={shared ? 'Our shared burrow' : 'Your bunny’s room'}>
    <Image source={BURROW_BACKGROUNDS.common} contentFit="cover" contentPosition="bottom" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
    {furniture.map(placement => {
      const asset = burrowArtForItem(slots[placement.slot], placement.category);
      return asset && <Image key={placement.slot} source={asset.source} contentFit="fill" style={artStyle(asset, placement, scale)} pointerEvents="none" />;
    })}
    {shared && <View pointerEvents="none" style={[styles.sharedBed, { left: 65 * scale, top: 340 * scale, width: 200 * scale, height: 70 * scale }]} />}
    {frameArt && <View pointerEvents="none" style={artStyle(frameArt, framePlacement, scale)}>
      <View style={styles.framePhoto}><RoomPhoto photo={photo} /></View>
      <Image source={frameArt.source} contentFit="fill" style={styles.fill} />
    </View>}
    {dollArt && (onSlot?<InteractiveDoll asset={dollArt} photo={doll} disabled={busy}
      onInteract={()=>onSlot('couple_doll')} onEditPhoto={()=>onSlot('doll_photo')}
      style={{ position:'absolute', left:170*scale, top:240*scale, width:58*scale, height:62*scale }}
      artStyle={{...artStyle(dollArt, dollPlacement, scale),
        left:artStyle(dollArt, dollPlacement, scale).left-170*scale,
        top:artStyle(dollArt, dollPlacement, scale).top-240*scale}} />
      :<View pointerEvents="none" style={artStyle(dollArt, dollPlacement, scale)}>
        <View style={styles.dollPhoto}><RoomPhoto photo={doll} circle /></View>
        <Image source={dollArt.source} contentFit="fill" style={styles.fill} />
      </View>)}
    <BunnyActor outfit={slots.outfit} pose={shared && sleeping?.mine ? 'sleeping' : away ? 'away' : 'idle'} />
    {shared && <BunnyActor partner outfit={partnerOutfit} pose={sleeping?.partner ? 'sleeping' : 'idle'} />}
    {shared && (sleeping?.mine || sleeping?.partner) && <Text pointerEvents="none" style={styles.sleepLabel}>z Z</Text>}
    {onSlot && (shared || !away) && <Pressable accessibilityRole="button" accessibilityLabel={shared ? sleeping?.mine ? 'Wake my bunny' : 'Put my bunny to sleep' : 'Feed bunny'}
      disabled={busy || (!shared && !canFeed)} onPress={() => onSlot(shared ? 'bed' : 'bunny')}
      style={{ position: 'absolute', left: 48 * scale, top: 260 * scale, width: 110 * scale, height: 145 * scale }} />}
    {onSlot && ['vase', 'music_player', 'frame'].map(slot => {
      const location = { vase: [255, 262, 74, 110], music_player: [280, 130, 66, 65], frame: [258, 218, 55, 80] }[slot]!;
      return target(slot, location[0], location[1], location[2], location[3]);
    })}
    <View style={styles.label}><Text style={styles.labelText}>{away ? 'Out collecting today’s stories' : shared ? 'A little closer, together' : 'A little place to call home'}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  scene: { width: '100%', aspectRatio: 360 / 470, borderRadius: 32, overflow: 'hidden', backgroundColor: '#8D5136' },
  fill: { width: '100%', height: '100%' },
  framePhoto: { position: 'absolute', left: '30%', top: '29%', width: '40%', height: '54%', overflow: 'hidden' },
  dollPhoto: { position: 'absolute', left: '29%', top: '25%', width: '42%', height: '30%', borderRadius: 100, overflow: 'hidden' },
  sharedBed: { position: 'absolute', borderRadius: 100, borderWidth: 7, borderColor: '#A96D42', backgroundColor: '#EFCA93' },
  sleepLabel: { position: 'absolute', left: '48%', top: '57%', color: '#FFF3CF', fontSize: 23, fontWeight: '700' },
  label: { position: 'absolute', top: 14, alignSelf: 'center' },
  labelText: { color: '#FFE7C3', fontSize: 12, fontWeight: '600' },
});
