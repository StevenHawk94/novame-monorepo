import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BurrowShop } from '@/components/burrow/burrow-shop';
import { adventureIsAway } from '@/lib/burrow-presentation';
import { useBurrow } from '@/lib/burrow-store';

export default function ShopDetailRoute() {
  const { itemId, giftTo, giftFrom } = useLocalSearchParams<{ itemId?: string;giftTo?:string;giftFrom?:string }>();
  const { data } = useBurrow();
  if (!data || !data.catalogComplete) return <View style={{ flex: 1, backgroundColor: '#FFF9EF', justifyContent: 'center' }}>
    <ActivityIndicator color="#C9552C" />
  </View>;
  return <BurrowShop data={data} section="shop" initialCategory="wallpapers"
    initialDetail={{ itemId }}
    giftRecipientId={giftTo} giftActorId={giftFrom}
    away={adventureIsAway(giftTo?data.partnerAdventure:data.activeAdventure, Date.now())} />;
}
