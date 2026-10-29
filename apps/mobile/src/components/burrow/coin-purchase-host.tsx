import { useEffect, useSyncExternalStore } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { FullWindowOverlay } from 'react-native-screens';
import {AppWindowLayer} from '@/components/layout/app-window-layer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { cancelCoinPurchase, clearCoinPurchaseToast, coinPurchaseSnapshot, settleCoinPurchase, subscribeCoinPurchase } from '@/lib/coin-purchase-prompt';

/** One confirmation design and one non-blocking toast across all coin shops. */
export function CoinPurchaseHost() {
  const state = useSyncExternalStore(subscribeCoinPurchase, coinPurchaseSnapshot, coinPurchaseSnapshot);
  const insets = useSafeAreaInsets();
  useEffect(() => () => { cancelCoinPurchase(); clearCoinPurchaseToast(coinPurchaseSnapshot().toastId); }, []);
  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => clearCoinPurchaseToast(state.toastId), 2500);
    return () => clearTimeout(timer);
  }, [state.toast, state.toastId]);
  const offer = state.prompt;
  const toast = state.toast && <View pointerEvents="none" style={[s.toastArea, { bottom: insets.bottom + 18 }]}>
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.toast}>
      <Text style={s.toastText}>{state.toast}</Text>
    </View>
  </View>;
  return <>
    {offer && <ScreenOverlay visible transparent statusBarTranslucent navigationBarTranslucent onRequestClose={() => settleCoinPurchase(offer.id, false)}>
      <View style={[s.scrim, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel purchase" style={StyleSheet.absoluteFill}
          onPress={() => settleCoinPurchase(offer.id, false)} />
        <View accessibilityViewIsModal style={s.card}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close purchase confirmation" hitSlop={10}
            onPress={() => settleCoinPurchase(offer.id, false)} style={s.close}><Text style={s.closeText}>×</Text></Pressable>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
            <Text accessibilityRole="header" style={s.title}>{`Purchase ${offer.name} for ${offer.price.toLocaleString()} coins?`}</Text>
            <View pointerEvents="none" style={s.artwork}>{offer.artwork}</View>
            {!!offer.description && <Text style={s.description}>{offer.description}</Text>}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Purchase" onPress={() => settleCoinPurchase(offer.id, true)}
            style={({ pressed }) => [s.purchase, pressed && { opacity: .85 }]}><Text style={s.purchaseText}>Purchase</Text></Pressable>
        </View>
      </View>
    </ScreenOverlay>}
    {toast && (Platform.OS === 'ios' ? <FullWindowOverlay><AppWindowLayer><View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{toast}</View></AppWindowLayer></FullWindowOverlay> : toast)}
  </>;
}
const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 420, maxHeight: '90%', flexShrink: 1, backgroundColor: '#FFF8EE', borderRadius: 24,
    padding: 22, paddingTop: 40, shadowColor: '#673019', shadowOpacity: .4, shadowRadius: 0, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  close: { position: 'absolute', top: 6, right: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  closeText: { color: '#673019', fontSize: 28, lineHeight: 30 },
  body: { alignItems: 'center', paddingBottom: 20, gap: 16 },
  title: { color: '#17110D', fontSize: 21, lineHeight: 29, fontWeight: '800', textAlign: 'center' },
  artwork: { minHeight: 155, width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  description: { color: '#80604F', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  purchase: { minHeight: 54, borderRadius: 12, backgroundColor: '#673019', alignItems: 'center', justifyContent: 'center', padding: 12 },
  purchaseText: { color: '#FFFFFF', fontSize: 21, fontWeight: '800' },
  toastArea: { position: 'absolute', left: 18, right: 18, alignItems: 'center', zIndex: 10000 },
  toast: { width: '100%', maxWidth: 560, backgroundColor: 'rgba(30,24,27,0.9)', borderRadius: 40, minHeight: 50,
    paddingHorizontal: 20, paddingVertical: 14, justifyContent: 'center' },
  toastText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, textAlign: 'center', fontWeight: '500' },
});
