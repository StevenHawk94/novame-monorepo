import { Image, StyleSheet, View } from 'react-native';
import { BURROW_LAUNCH_BACKGROUND, BURROW_LAUNCH_LOGO } from '@/lib/burrow-onboarding-design';

/** Shared by routing, authentication, Home's paint gate and background resume. */
export function BurrowLaunchScreen() {
  // Match expo-splash-screen's native imageWidth so the logo never jumps
  // when native launch hands off to the JavaScript/Home readiness cover.
  const size = 140;
  return <View style={styles.root} accessibilityLabel="Preparing your burrow">
    <Image source={BURROW_LAUNCH_LOGO} resizeMode="contain" style={{ width: size, height: size }}/>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: BURROW_LAUNCH_BACKGROUND, alignItems: 'center', justifyContent: 'center' } });
