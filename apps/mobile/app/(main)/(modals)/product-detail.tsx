/**
 * Product detail modal placeholder. Stage 3.9.B.4 will replace
 * the body with the full hero image, description, and Order CTA.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

export default function ProductDetailModal() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ product?: string }>();
  const product = params.product === 'wisdom_cards' ? 'Wisdom Cards' : 'Wisdom Book';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        style={styles.backBtn}
      >
        <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.title}>{product}</Text>
        <Text style={styles.sub}>
          Full product details and ordering arrive next.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E', paddingHorizontal: 16 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginBottom: 8 },
  sub: { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
