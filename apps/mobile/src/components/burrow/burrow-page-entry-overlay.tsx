import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { cancelBurrowPageEntry, getBurrowPageEntry, retryBurrowPageEntry, subscribeBurrowPageEntry } from '@/lib/burrow-page-entry';

/** Lives above the current page, not inside the destination being prepared. */
export function BurrowPageEntryOverlay() {
  const state = useSyncExternalStore(subscribeBurrowPageEntry, getBurrowPageEntry, getBurrowPageEntry);
  const path = usePathname();
  const route = path + JSON.stringify(useGlobalSearchParams());
  useEffect(() => () => cancelBurrowPageEntry(), [route]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => { if (value === 'background') cancelBurrowPageEntry(); });
    return () => sub.remove();
  }, []);
  if (!state.pending && !state.error) return null;
  return <ScreenOverlay onRequestClose={cancelBurrowPageEntry} statusBarTranslucent navigationBarTranslucent>
    <View style={s.scrim}>
      {state.pending ? <ActivityIndicator accessibilityLabel="Preparing page" size="large" color="#FFF8EE"/>
        : <View style={s.error} accessibilityRole="alert"><Text style={s.copy}>Couldn’t load this page. Please try again.</Text>
          <Pressable accessibilityRole="button" onPress={retryBurrowPageEntry} style={s.button}><Text style={s.buttonText}>Retry</Text></Pressable>
        </View>}
      <Pressable accessibilityRole="button" onPress={cancelBurrowPageEntry} style={s.cancel}><Text style={s.cancelText}>Cancel</Text></Pressable>
    </View>
  </ScreenOverlay>;
}
const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 },
  error: { width: '100%', maxWidth: 320, backgroundColor: '#FFF8EE', borderRadius: 24, padding: 24, gap: 20 },
  copy: { color: '#50321E', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  button: { minHeight: 48, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 18, backgroundColor: '#673019', alignItems: 'center' },
  buttonText: { color: '#FFF8EE', fontSize: 16, fontWeight: '700' },
  cancel: { paddingHorizontal: 24, paddingVertical: 12 },
  cancelText: { color: '#FFF8EE', fontSize: 16 },
});
