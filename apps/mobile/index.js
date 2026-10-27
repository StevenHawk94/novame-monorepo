// Register headless notification tasks before Expo Router initializes. Native
// platforms may launch this entry point without mounting any React views.
try {
  require('./src/lib/background-widget-refresh');
  require('expo-router/entry');
} catch (error) {
  if (error?.message !== 'secure_storage_startup_failed') throw error;
  const { registerRootComponent } = require('expo');
  registerRootComponent(require('./src/components/secure-storage-recovery').SecureStorageRecovery);
}
