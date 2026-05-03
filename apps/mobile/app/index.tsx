import { Text, View } from 'react-native';

/**
 * Root index route placeholder.
 *
 * Stage 2.2: Renders a placeholder screen so the skeleton boots.
 * Stage 3+: Replace with redirect logic to (auth)/sign-in or
 * (onboarding) based on auth state.
 */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>NovaMe (stage 2.2 skeleton)</Text>
    </View>
  );
}
