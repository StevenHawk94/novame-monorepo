import { Image } from './burrow-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_ROOM_ICONS } from '@/lib/burrow-ui-assets';
import { BURROW_MAP_ART } from '@/lib/burrow-map-assets';
import { BUNNY_ICONS } from '@/lib/bunny-variant-assets';
import { useBunnyIdentity, useBunnyVariant } from '@/lib/bunny-identity';
import {
  BURROW_BANNER_HEIGHT, BURROW_BANNER_PATH_END, BURROW_MAP_ROOMS, BURROW_MAP_WIDTH, BURROW_SOIL_COLOR,
  BURROW_TUNNEL_COLOR, burrowMapLayout, type BurrowMapRoom,
  BURROW_ROOM_ART, BURROW_ROOM_ICON, BURROW_ROOM_LABEL, burrowRoomIconShadow,
} from '@/lib/burrow-map-model';
import { useBurrowEnvironment } from '@/lib/use-burrow-environment';
import { UpdateBadge } from './update-badge';
import {PlushieTouchBadge} from './plushie-touch-badge';

export type { BurrowMapRoom } from '@/lib/burrow-map-model';

export function BurrowMap({ onRoom, visiting, badges, now, timeZone, roomIds,partnerId=null,pairVersion=null }: {
  onRoom: (room: BurrowMapRoom) => void;
  visiting?: boolean;
  badges?: Partial<Record<BurrowMapRoom, number>>;
  now?: number;
  timeZone?: string | null;
  roomIds?: readonly BurrowMapRoom[];
  partnerId?: string|null;
  pairVersion?: string|null;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const environment = useBurrowEnvironment(timeZone, now);
  const mine=useBunnyVariant(),identity=useBunnyIdentity();
  // Preserve fixed-colour re-pairing (including two same-colour accounts).
  // Unknown/unpaired preview uses the other icon, never changes identity data.
  const partner=partnerId&&identity?.partnerId===partnerId&&identity.pairVersion===pairVersion&&identity.partnerVariant
    ?identity.partnerVariant:mine==='pinky'?'biscuit':'pinky';
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
      <Image source={BURROW_MAP_ART.room} contentFit="contain" style={box(BURROW_ROOM_ART)} pointerEvents="none" />
      <View pointerEvents="none" style={[box(BURROW_ROOM_ICON), styles.center,burrowRoomIconShadow(scale)]}>
        <Image source={room.id==='my_room'?BUNNY_ICONS[mine]:room.id==='partner_room'?BUNNY_ICONS[partner]:BURROW_ROOM_ICONS[room.id]} contentFit="contain"
          style={{ width:'100%',height:'100%' }} />
      </View>
      <View pointerEvents="none" style={[box(BURROW_ROOM_LABEL), styles.center,{backgroundColor:'#FFF2DF',borderRadius:14*scale}]}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} maxFontSizeMultiplier={1.15}
          style={[styles.title, { fontSize: 24 * scale, lineHeight: 31 * scale }]}>{room.title}</Text>
      </View>
      {room.id==='partner_room'&&partnerId?<PlushieTouchBadge base={badges?.[room.id]??0} size={Math.max(22,48*scale)} style={{right:20*scale,top:24*scale}}/>:
       <UpdateBadge count={badges?.[room.id] ?? (room.id === 'friends_room' && visiting ? 1 : 0)} size={Math.max(22, 48 * scale)} style={{right:20*scale,top:24*scale}} />}
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
