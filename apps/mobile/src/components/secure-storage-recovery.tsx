import { useState } from 'react';
import { DevSettings, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { reloadAppAsync } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

/** No storage imports here: the vault may be unavailable before first unlock.
 * This screen never erases or recreates keys, sessions, drafts or payment work. */
export function SecureStorageRecovery() {
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (__DEV__) DevSettings.reload();
      else await reloadAppAsync();
    } catch { setRetrying(false); }
  };
  return <SafeAreaView style={s.page} onLayout={()=>{void SplashScreen.hideAsync().catch(()=>{});}}><View style={s.card}>
    <Text style={s.title}>Let’s keep your data safe</Text>
    <Text style={s.body}>We couldn’t open your saved data. Unlock your phone, check that it has free storage space, and try reopening Burrow. Nothing has been reset.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Try opening Burrow again" disabled={retrying} onPress={retry}
      style={({ pressed }) => [s.button, pressed && { opacity: .8 }]}><Text style={s.buttonText}>{retrying ? 'Reopening…' : 'Try again'}</Text></Pressable>
    <Text style={s.body}>If this keeps happening, close and reopen the app. Please don’t reinstall it: your saved data is still on this device.</Text>
  </View></SafeAreaView>;
}
const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#FFF8EE', justifyContent: 'center', padding: 24 },
  card: { padding: 24, gap: 24, maxWidth: 520, alignSelf: 'center' }, title: { fontSize: 24, fontWeight: '700', color: '#4C2B22' },
  body: { fontSize: 17, lineHeight: 26, color: '#604C40' }, button: { minHeight: 52, padding: 14, borderRadius: 24, alignItems: 'center', backgroundColor: '#662F19' },
  buttonText: { fontSize: 18, fontWeight: '700', color: '#FFF8EE' } });
