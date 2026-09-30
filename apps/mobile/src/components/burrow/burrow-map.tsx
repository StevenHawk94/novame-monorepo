import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { BURROW_ROOM_ICONS } from '@/lib/burrow-ui-assets';

// Coordinates follow the six empty alcoves in the supplied 841 × 1870 art.
// Scaling the entire scene by width keeps each hit target and image aligned.
const ART_WIDTH = 841;
const ART_HEIGHT = 1870;
const ROOMS = [
  { id: 'our_room', title: 'Our Room', x: 267, y: 527 },
  { id: 'friends_room', title: 'Friends’ Room', x: 599, y: 681 },
  { id: 'game_room', title: 'Game Room', x: 267, y: 893 },
  { id: 'rage_room', title: 'Rage Room', x: 600, y: 1051 },
  { id: 'memories_room', title: 'Memories Room', x: 267, y: 1265 },
  { id: 'collection_room', title: 'Collection Room', x: 598, y: 1457 },
] as const;

export type BurrowMapRoom = typeof ROOMS[number]['id'];

export function BurrowMap({ onRoom, visiting, night }: { onRoom: (room: BurrowMapRoom) => void; visiting?: boolean; night?: boolean }) {
  const { width } = useWindowDimensions();
  const mapWidth = Math.min(width, 560);
  const scale = mapWidth / ART_WIDTH;
  return <View style={{ width: mapWidth, height: ART_HEIGHT * scale, alignSelf: 'center' }}>
    <Image source={night ? BURROW_BACKGROUNDS.burrowNight : BURROW_BACKGROUNDS.burrowDay} contentFit="fill" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
    <View style={[styles.plaque, { left: 270 * scale, top: 102 * scale, width: 300 * scale, height: 84 * scale, borderRadius: 20 * scale }]}>
      <Text style={[styles.plaqueText, { fontSize: 44 * scale }]}>Our Burrows</Text>
    </View>
    {ROOMS.map((room) => <Pressable
      key={room.id}
      accessibilityRole="button"
      accessibilityLabel={`Open ${room.title}`}
      onPress={() => onRoom(room.id)}
      style={({ pressed }) => [styles.room, {
        left: (room.x - 112) * scale,
        top: (room.y - 95) * scale,
        width: 224 * scale,
        height: 180 * scale,
        opacity: pressed ? .75 : 1,
      }]}
    >
      <Image source={BURROW_ROOM_ICONS[room.id]} contentFit="contain" style={{ width: 128 * scale, height: 110 * scale }} />
      <Text numberOfLines={1} style={[styles.title, { fontSize: 26 * scale }]}>{room.title}</Text>
      {room.id === 'friends_room' && visiting && <View style={[styles.dot, { right: 30 * scale, top: 10 * scale }]} />}
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  plaque: { position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: '#885441' },
  plaqueText: { color: '#FFFFFF', fontWeight: '900' },
  room: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#543015', fontWeight: '900' },
  dot: { position: 'absolute', width: 13, height: 13, borderRadius: 7, backgroundColor: '#E7483D' },
});
