import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Bags tab -- Phase A placeholder.
 *
 * Phase A deleted v1 and left the route tree standing. Nothing here is a
 * design decision: the screen exists so expo-router has a file to resolve
 * and so the five-tab bar is walkable.
 *
 * The object grid, object detail, and memory feed land in Phase C, once the
 * item dictionary and the matcher engine exist.
 */
export default function BagsScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.center}>
        <Text style={styles.title}>Bags</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
