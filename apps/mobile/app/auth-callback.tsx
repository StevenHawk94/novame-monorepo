import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

/**
 * Defensive landing page for OAuth callbacks created by older app builds.
 *
 * Google account connection now uses a native ID token and does not route
 * through this page. Keeping a real route prevents an old/in-flight callback
 * (or an auth-provider configuration mistake) from exposing Expo Router's
 * technical "Unmatched Route" screen to a user.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    error?: string;
    error_code?: string;
    error_description?: string;
  }>();

  useEffect(() => {
    const alreadyConnected = params.error_code === 'identity_already_exists';
    const message = alreadyConnected
      ? 'This Google account is already connected to an existing Burrow account. Try Google again to restore that account.'
      : params.error_description || params.error || 'The account connection did not finish. Please try again.';

    router.replace({
      pathname: '/(main)/(modals)/connect-account',
      params: { authError: message },
    } as never);
  }, [params.error, params.error_code, params.error_description, router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color="#5C3A24" />
      <Text style={styles.text}>Returning to Burrow…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F8E2C1',
  },
  text: {
    color: '#5C3A24',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
