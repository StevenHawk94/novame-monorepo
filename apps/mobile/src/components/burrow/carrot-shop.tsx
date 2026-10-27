import { useEffect, useRef, useState } from 'react';
import { userErrorMessage } from '@/lib/user-error-message';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CARROT_PRODUCTS, prewarmCarrotPurchase, purchaseCarrots, useCarrotPurchase } from '@/lib/carrot-iap';
import { cachedCoinPrices, loadCoinPrices } from '@/lib/coin-store-prices';
import { initIAP, reconcileAvailablePurchases, isSubscriptionPurchaseBusy } from '@/lib/iap';
import { haptics } from '@/lib/haptics';
import { CoinPackArt } from './coin-pack-art';

export function CarrotShop({ balance, onClose, onTryPlus }: {
  balance: number; onClose: () => void; onTryPlus: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const compact = height < 700;
  const purchase = useCarrotPurchase();
  const mounted = useRef(false);
  const checkout = useRef(false);
  const priceRequest = useRef(0);
  const [prices, setPrices] = useState<Record<string, string>>(cachedCoinPrices);
  const [loading, setLoading] = useState(() => !Object.keys(cachedCoinPrices()).length);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    const request = ++priceRequest.current;
    const current = () => mounted.current && request === priceRequest.current;
    if (!Object.keys(cachedCoinPrices()).length) setLoading(true);
    setError(null);
    prewarmCarrotPurchase(force);
    try {
      await initIAP();
      if (!current()) return;
      const next = await loadCoinPrices(force);
      if (!current()) return;
      setPrices(next);
      if (Object.keys(next).length < CARROT_PRODUCTS.length) setError('Some coin packs are unavailable in this store.');
    } catch (e) {
      if (current()) {
        setPrices(cachedCoinPrices());
        setError(userErrorMessage(e,'The store is unavailable. Please try again.'));
      }
    } finally {
      if (current()) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; priceRequest.current++; };
  }, []);

  const paymentBusy = starting || purchase.busy;
  const busy = loading || paymentBusy;
  async function buy(id: typeof CARROT_PRODUCTS[number]) {
    if (checkout.current || busy || !prices[id]) return;
    if (isSubscriptionPurchaseBusy()) { setError('Please finish your subscription purchase first.'); return; }
    checkout.current = true;
    setStarting(true);
    setError(null);
    void haptics.selection();
    try { await purchaseCarrots(id); }
    catch (e) { if (mounted.current) setError(userErrorMessage(e,'Couldn’t start this purchase. Please try again.')); }
    finally { checkout.current = false; if (mounted.current) setStarting(false); }
  }
  async function checkPending() {
    if (busy || checkout.current) return;
    checkout.current = true;
    setStarting(true);
    setError(null);
    try {
      await initIAP();
      await reconcileAvailablePurchases({ coinsOnly: true });
    } catch (e) { if (mounted.current) setError(userErrorMessage(e,'Couldn’t check purchases. Please try again.')); }
    finally { checkout.current = false; if (mounted.current) setStarting(false); }
  }

  // Store connection / handoff is a spinner-only transition. Terminal errors,
  // pending payments and verified outcomes remain visible and recoverable.
  const message = error || (!paymentBusy ? purchase.message : null);
  const pendingRecovery = purchase.status === 'pending' || purchase.status === 'unconfirmed';
  const storeRecovery = !!error || purchase.status === 'failed';
  return <View style={[s.card, { width: Math.min(width - 32, 520), maxHeight: '100%' }]} accessibilityViewIsModal>
    <Pressable accessibilityRole="button" accessibilityLabel="Close coin shop" hitSlop={8}
      onPress={onClose} style={s.close}><Feather name="x" size={28} color="#432A1B" /></Pressable>
    <ScrollView style={s.scroll} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, compact && s.compactContent]}>
      <View style={[s.hero, compact && { width: 68, height: 68 }]}><CoinPackArt amount={1000} /></View>
      <Text style={[s.title, compact && { fontSize: 26 }]}>Burrow Coins</Text>
      <Text style={s.subtitle}>Complete quests to earn coins and unlock new items, gift and games!</Text>
      <View style={s.packs}>
        {CARROT_PRODUCTS.map(id => {
          const amount = Number(id.split('.').pop()) as 200 | 400 | 1000;
          const disabled = busy || !prices[id];
          return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Buy ${amount.toLocaleString()} coins${prices[id] ? ` for ${prices[id]}` : '. Store price unavailable'}`}
            accessibilityState={{ disabled, busy: starting || purchase.busy }} disabled={disabled}
            onPress={() => void buy(id)} style={({ pressed }) => [s.pack, pressed && s.pressed, disabled && s.disabled]}>
            <View style={[s.packArt, compact && { width: 44, height: 44 }]}><CoinPackArt amount={amount} /></View>
            <Text style={s.amount} adjustsFontSizeToFit numberOfLines={1}>{amount.toLocaleString()}</Text>
            <Text style={s.price} adjustsFontSizeToFit numberOfLines={1}>{prices[id] || (loading ? 'Loading…' : 'Unavailable')}</Text>
          </Pressable>;
        })}
      </View>
      {balance < 0 && <Text style={s.notice}>New coins first cover the remaining refunded balance of {Math.abs(balance).toLocaleString()}.</Text>}
      {message && <View style={s.feedback}>
        <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>
        {!busy && (storeRecovery || pendingRecovery) && <View style={s.recovery}>
          {storeRecovery && <Pressable accessibilityRole="button" onPress={() => void load(true)} hitSlop={8}><Text style={s.link}>Retry store</Text></Pressable>}
          {pendingRecovery && <Pressable accessibilityRole="button" onPress={() => void checkPending()} hitSlop={8}><Text style={s.link}>Check pending purchases</Text></Pressable>}
        </View>}
      </View>}
      <Text style={s.plusCopy}>Get daily bonus coins with Plus.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try Plus" disabled={paymentBusy} onPress={() => {
        if (checkout.current || paymentBusy) return;
        if (isSubscriptionPurchaseBusy()) { setError('Please finish your subscription purchase first.'); return; }
        void haptics.light(); onTryPlus();
      }} style={({ pressed }) => [s.plus, pressed && s.pressed, paymentBusy && s.disabled]}>
        <LinearGradient colors={['#64341D', '#3D2619']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.plusInner}>
          <MaterialCommunityIcons name="crown" size={26} color="#FFF8ED" /><Text style={s.plusText}>Try Plus</Text>
        </LinearGradient>
      </Pressable>
    </ScrollView>
    {paymentBusy&&<View pointerEvents="none" style={s.paymentLoading} accessibilityRole="progressbar" accessibilityLabel="Processing purchase">
      <View style={s.spinner}><ActivityIndicator color="#70452C" size="large"/></View>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: '#FFF7EC', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFCF6',
    shadowColor: '#1B0D06', shadowOpacity: .24, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { padding: 20, paddingTop: 28, alignItems: 'center', gap: 12 }, compactContent: { padding: 16, paddingTop: 24, gap: 10 },
  close: { position: 'absolute', top: 10, left: 10, zIndex: 2, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  // All supplied pack files are square. ImageRef's eager native source setter
  // can render before contentFit is applied; a square viewport also makes the
  // warm/ref and cold/URI paths geometrically identical without global changes.
  hero: { width: 84, height: 84 },
  title: { color: '#432A1B', fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#4E3626', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 8 },
  packs: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  pack: { flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: '#D9C5AE', borderRadius: 15, paddingHorizontal: 5,
    paddingVertical: 10, gap: 4, alignItems: 'center', backgroundColor: '#FFF9F0' },
  packArt: { width: 48, height: 48 }, amount: { color: '#432A1B', fontSize: 25, lineHeight: 30, fontWeight: '700' },
  price: { color: '#4E3626', fontSize: 16, lineHeight: 20 }, pressed: { opacity: .8, transform: [{ scale: .98 }] }, disabled: { opacity: .55 },
  plusCopy: { color: '#4E3626', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 4 },
  plus: { alignSelf: 'stretch', overflow: 'hidden', borderRadius: 14 },
  plusInner: { minHeight: 54, padding: 12, gap: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  plusText: { color: '#FFF8ED', fontSize: 22, fontWeight: '700' },
  feedback: { alignSelf: 'stretch', gap: 10, alignItems: 'center' },
  paymentLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  spinner: { width: 76, height: 76, borderRadius: 20, backgroundColor: '#FFF7ECF2', alignItems: 'center', justifyContent: 'center' },
  notice: { color: '#70452C', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  recovery: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 },
  link: { color: '#70452C', fontSize: 12, textDecorationLine: 'underline', paddingVertical: 5 },
});
