import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CarrotShop } from '@/components/burrow/carrot-shop';
import { useBurrowSnapshot } from '@/lib/burrow-store';

export default function CoinShopModal() {
  const insets = useSafeAreaInsets();
  const { data } = useBurrowSnapshot();
  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/(main)/(tabs)'); };
  return <View style={[s.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
    <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss coin shop" onPress={close} />
    <CarrotShop balance={data?.wallet.balance ?? 0} onClose={close}
      onTryPlus={() => router.replace('/(main)/(modals)/subscription-paywall')} />
  </View>;
}
const s = StyleSheet.create({ overlay: { flex: 1, backgroundColor: 'rgba(27,13,6,0.64)', alignItems: 'center', justifyContent: 'center' } });
