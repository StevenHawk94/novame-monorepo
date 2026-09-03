// Register headless notification tasks before Expo Router initializes. Native
// platforms may launch this entry point without mounting any React views.
import './src/lib/background-widget-refresh';
import 'expo-router/entry';
