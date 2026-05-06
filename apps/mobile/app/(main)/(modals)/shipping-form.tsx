/**
 * Shipping form modal placeholder. Stage 3.9.B.5 will replace with
 * full address form (country / state / address fields + persist to
 * MMKV) and route to a payment-stub view that shows a 'Coming soon'
 * message until stage 5 wires real Airwallex.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

export default function ShippingFormModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ product?: string }>();
  const product = params.product === 'wisdom_cards' ? 'Wisdom Cards' : 'Wisdom Book';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Shipping</Text>
      </View>
      <View style={styles.body}>
        <MaterialIcons name="local-shipping" size={48} color="rgba(255,255,255,0.18)" />
        <Text style={styles.title}>Ship your {product}</Text>
        <Text style={styles.sub}>Address form arrives next.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginLeft: 12 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginTop: 16, marginBottom: 6 },
  sub: { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
