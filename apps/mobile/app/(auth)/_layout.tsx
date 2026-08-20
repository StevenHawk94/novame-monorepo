import { Stack } from 'expo-router';

/**
 * Passwordless authentication and session-bootstrap routes.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Auth screens sit on the splash beige -- override the root Stack's brown
        // so there's no dark-purple flash on the auth path.
        contentStyle: { backgroundColor: '#F8E2C1' },
      }}
    />
  );
}
