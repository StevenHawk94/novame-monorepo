import { Pressable, StyleSheet, Text, View } from 'react-native';
import { hideSplashOnce } from '@/lib/splash';

/**
 * Full-screen fallback shown when the P0 asset gate (app/index.tsx)
 * times out for a returning (session) user on cold start — the
 * bucket-root assets the Home screen needs couldn't be downloaded in
 * time (poor / no network). Single Retry re-runs ensureP0Ready().
 *
 * Background is the splash purple (#7C3AED) so there's no jarring
 * color jump from the launch/splash screen to this error state. The
 * root onLayout calls hideSplashOnce() so the native splash steps
 * aside and this screen becomes visible (same pattern as the real
 * destination screens).
 */
export function AssetGateError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.root} onLayout={hideSplashOnce}>
      <View style={styles.body}>
        <Text style={styles.title}>Couldn{'\u2019'}t load NovaMe</Text>
        <Text style={styles.message}>
          We couldn{'\u2019'}t download the content NovaMe needs to start.
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
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  body: { width: '100%', maxWidth: 360, alignItems: 'center' },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    marginBottom: 14,
    textAlign: 'center',
  },
  message: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    backgroundColor: '#EC4899',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },
});
