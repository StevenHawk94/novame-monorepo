import { Pressable, StyleSheet, Text, View } from 'react-native';
import { hideSplashOnce } from '@/lib/splash';

/**
 * Full-screen fallback shown when the P0 asset gate (app/index.tsx)
 * times out for a returning (session) user on cold start — the
 * bucket-root assets the Home screen needs couldn't be downloaded in
 * time (poor / no network). Single Retry re-runs ensureP0Ready().
 *
 * Background is the splash beige (#F8E2C1) so there's no jarring
 * color jump from the launch/splash screen to this error state. The
 * root onLayout calls hideSplashOnce() so the native splash steps
 * aside and this screen becomes visible (same pattern as the real
 * destination screens).
 */
export function AssetGateError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.root} onLayout={hideSplashOnce}>
      <View style={styles.body}>
        <Text style={styles.title}>Couldn{'\u2019'}t load Burrow</Text>
        <Text style={styles.message}>
          We couldn{'\u2019'}t download the content Burrow needs to start.
          Please check your internet connection and try again.
        </Text>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8E2C1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  body: { width: '100%', maxWidth: 360, alignItems: 'center' },
  title: {
    color: '#2B2B2B',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    marginBottom: 14,
    textAlign: 'center',
  },
  message: {
    color: '#6B5B44',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    backgroundColor: '#4A3423',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },
});
