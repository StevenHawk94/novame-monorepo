import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

/**
 * Reflect -- Phase A placeholder.
 *
 * Replaces (main)/record.tsx, whose 3,028 lines were half audio capture
 * (removed by decision D2) and half a publish pipeline against tables that
 * no longer exist. Phase C: prompt selection, typed input capped at 5,000
 * characters, object matching, and the skill roll.
 *
 * fullScreenModal is inherited from (main)/_layout.tsx and is deliberate: it
 * is the only presentation on iOS that disables the downward dismiss gesture,
 * which would otherwise discard an unpublished entry.
 */
export default function ReflectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.close}>
        <Text style={styles.closeText}>Close</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.title}>Reflect</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E', paddingHorizontal: 20 },
  close: { alignSelf: 'flex-start', padding: 8 },
  closeText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: 'rgba(255,255,255,0.35)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
