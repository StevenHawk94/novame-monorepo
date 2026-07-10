import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

/**
 * Skins -- Phase A placeholder.
 *
 * Six outfits on one character, unlocked by level. Phase C: three companions,
 * six forms each (none + five costumes), unlocked by XP.
 */
export default function SkinSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.close}>
        <Text style={styles.closeText}>Close</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.title}>Skins</Text>
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
