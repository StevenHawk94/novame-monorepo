import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

/**
 * Product -- Phase A placeholder.
 *
 * The unlock gate read uniqueKeywords >= 48. v2.0 sells an object codex and a
 * printed skill deck, gated on objects collected. Rebuilt in Phase C.
 */
export default function ProductDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.close}>
        <Text style={styles.closeText}>Close</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.title}>Product</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E', paddingHorizontal: 20 },
  close: { alignSelf: 'flex-start', padding: 8 },
  closeText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
