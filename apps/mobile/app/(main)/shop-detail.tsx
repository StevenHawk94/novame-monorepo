import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BurrowShop } from '@/components/burrow/burrow-shop';
import { adventureIsAway } from '@/lib/burrow-presentation';
import { useBurrow } from '@/lib/burrow-store';

export default function ShopDetailRoute() {
  const { itemId, roomIndex } = useLocalSearchParams<{ itemId?: string; roomIndex?: string }>();
  const { data } = useBurrow();
  if (!data) return <View style={{ flex: 1, backgroundColor: '#FFF9EF', justifyContent: 'center' }}>
    <ActivityIndicator color="#C9552C" />
  </View>;
  const index = roomIndex == null ? undefined : Number(roomIndex);
  return <BurrowShop data={data} section="shop" initialCategory="rooms"
    initialDetail={{ itemId, roomIndex: Number.isInteger(index) ? index : undefined }}
    away={adventureIsAway(data.activeAdventure, Date.now())} />;
}
