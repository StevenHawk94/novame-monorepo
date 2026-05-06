/**
 * Order History modal placeholder. Stage 3.9.B.6 will replace the
 * body with the real order list driven by /api/orders.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

export default function OrderHistoryModal() {
  const insets = useSafeAreaInsets();

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
        <Text style={styles.headerTitle}>Order History</Text>
      </View>
      <View style={styles.body}>
        <MaterialIcons name="receipt-long" size={48} color="rgba(255,255,255,0.18)" />
        <Text style={styles.sub}>Your order list appears here.</Text>
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
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sub: { color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 12 },
});
