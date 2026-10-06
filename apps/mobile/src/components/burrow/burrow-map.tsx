import { Image } from './burrow-image';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { BURROW_ROOM_ICONS } from '@/lib/burrow-ui-assets';
import { BURROW_MAP_ART } from '@/lib/burrow-map-assets';
import {
  BURROW_BANNER_HEIGHT, BURROW_BANNER_PATH_END, BURROW_MAP_ROOMS, BURROW_MAP_WIDTH, BURROW_SOIL_COLOR,
  BURROW_TUNNEL_COLOR, burrowMapEnvironment, burrowMapLayout, type BurrowMapRoom,
} from '@/lib/burrow-map-model';
import { useBurrowStorefront } from '@/lib/use-burrow-storefront';

export type { BurrowMapRoom } from '@/lib/burrow-map-model';

// The supplied folder has no individual-den icons. These two code-native
// silhouettes match the reference without changing the supplied room artwork.
function DenIcon({ partner, size }: { partner: boolean; size: number }) {
  return <Svg width={size} height={size} viewBox="0 0 128 140">
    <Path fill={partner ? '#b86d3b' : '#fffdf7'} d="M39 71C27 56 13 28 21 23C31 17 49 41 54 61C47 36 44 5 56 5C70 4 77 39 71 67C96 69 113 90 115 108C116 122 96 126 75 126L38 124C22 121 26 96 39 71Z" />
    <Circle cx="90" cy="95" r="6" fill="#442213" />
  </Svg>;
}

export function BurrowMap({ onRoom, visiting, now = Date.now(), timeZone, roomIds }: {
  onRoom: (room: BurrowMapRoom) => void;
  visiting?: boolean;
  now?: number;
  timeZone?: string | null;
  roomIds?: readonly BurrowMapRoom[];
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const country = useBurrowStorefront();
  const environment = burrowMapEnvironment(now, timeZone ?? undefined, country);
  const rooms = roomIds ? roomIds.flatMap(id => BURROW_MAP_ROOMS.filter(room => room.id === id)) : BURROW_MAP_ROOMS;
  const layout = burrowMapLayout(rooms.length);
  const mapWidth = Math.min(width, BURROW_MAP_WIDTH);
  const scale = mapWidth / BURROW_MAP_WIDTH;
  const box = (rect: { left: number; top: number; width: number; height: number }) => ({
    position: 'absolute' as const, left: rect.left * scale, top: rect.top * scale,
    width: rect.width * scale, height: rect.height * scale,
  });
  return <View style={{ width: mapWidth, height: layout.height * scale, alignSelf: 'center', backgroundColor: BURROW_SOIL_COLOR }}>
    <View pointerEvents="none" style={[box(layout.trunk), styles.tunnel]} />
    {layout.branches.map((branch, index) => <View key={`branch-${index}`} pointerEvents="none" style={[box(branch), styles.tunnel]} />)}
    <View pointerEvents="none" style={[box({ left: 0, top: 0, width: BURROW_MAP_WIDTH, height: BURROW_BANNER_PATH_END }), { overflow: 'hidden' }]}>
      <Image source={BURROW_MAP_ART.banners[environment.banner]} contentFit="fill"
        accessibilityLabel={`${environment.season} ${environment.period} landscape`}
        style={{ width: mapWidth, height: BURROW_BANNER_HEIGHT * scale }} />
    </View>
    <Text accessibilityRole="header" style={[styles.heading, {
      top: Math.max(insets.top + 16, 124 * scale), fontSize: 36 * scale, lineHeight: 44 * scale,
      color: environment.period === 'night' ? '#fff4de' : BURROW_SOIL_COLOR,
    }]}>A Little World For Two</Text>
    {rooms.map((room, index) => <Pressable key={room.id} accessibilityRole="button"
      accessibilityLabel={`Open ${room.title}`} onPress={() => onRoom(room.id)}
      style={({ pressed }) => [box(layout.rooms[index]), { opacity: pressed ? .75 : 1, transform: [{ scale: pressed ? .97 : 1 }] }]}>
      <Image source={BURROW_MAP_ART.room} contentFit="fill" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <View pointerEvents="none" style={[box({ left: 85, top: 62, width: 144, height: 132 }), styles.center]}>
        {room.id === 'my_room' || room.id === 'partner_room'
          ? <DenIcon partner={room.id === 'partner_room'} size={126 * scale} />
          : <Image source={BURROW_ROOM_ICONS[room.id]} contentFit="contain" style={{ width: 144 * scale, height: 132 * scale }} />}
      </View>
      <View pointerEvents="none" style={[box({ left: 10, top: 201, width: 293, height: 49 }), styles.center]}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} maxFontSizeMultiplier={1.15}
          style={[styles.title, { fontSize: 24 * scale, lineHeight: 31 * scale }]}>{room.title}</Text>
      </View>
      {room.id === 'friends_room' && visiting && <View pointerEvents="none" style={[styles.dot,
        { right: 52 * scale, top: 54 * scale, width: 18 * scale, height: 18 * scale, borderRadius: 9 * scale }]} />}
    </Pressable>)}
    {layout.lights.map((light, index) => <Image key={`light-${index}`} source={BURROW_MAP_ART.light}
      contentFit="contain" pointerEvents="none" style={box(light)} />)}
  </View>;
}

const styles = StyleSheet.create({
  heading: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontWeight: '500' },
  tunnel: { backgroundColor: BURROW_TUNNEL_COLOR },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { color: '#402216', fontWeight: '800', textAlign: 'center' },
  dot: { position: 'absolute', backgroundColor: '#E7483D', borderWidth: 2, borderColor: '#fff4de' },
});
