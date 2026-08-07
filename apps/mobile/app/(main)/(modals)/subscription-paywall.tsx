import { useEffect, useRef, useState } from 'react';
import { Platform, ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { router } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import {
  fetchSubscriptionProducts,
  initIAP,
  purchaseSubscription,
  restoreSubscriptions,
  onPurchaseComplete,
  onPurchaseError,
} from '@/lib/iap';
import { getCachedSubscription } from '@/lib/subscription';
import { emitHomeRefresh } from '@/lib/home-refresh-signal';
import {
  shouldPromptNotifAfterPurchase,
  markNotifPromptedAfterPurchase,
} from '@/lib/notification-settings';
import { ICONS } from '@/lib/icons';

/**
 * Subscription paywall (2026-07-26 redesign — same look as onboarding):
 * the Burrow Plus benefits page on the beige grid, then Choose your plan
 * with store-localized prices. Solo monthly/yearly only (the onboarding
 * offer); duo lives in the Friend Pack flow.
 *
 * Behaviors preserved from the previous paywall: global purchase listeners
 * (complete → home refresh + one-time notification prompt + dismiss;
 * error → alert), restore purchases (App Store requirement), dismiss →
 * home refresh, already-subscribed → Apple's manage-subscriptions page,
 * 'scheduled' outcomes explained (the one alert that must stay).
 */
const INK = '#4A2F17';
const CARD = '#FDF3E3';
const BTN = '#4A3220';

type Phase = 'benefits' | 'plans';

export default function SubscriptionPaywallModal() {
  const insets = useSafeAreaInsets();
  const isPaid = (getCachedSubscription()?.tier ?? 'free') !== 'free';

  const [phase, setPhase] = useState<Phase>('benefits');
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const [busy, setBusy] = useState<'idle' | 'purchasing' | 'restoring'>('idle');
  const [priceYearly, setPriceYearly] = useState<string | null>(null);
  const [priceMonthly, setPriceMonthly] = useState<string | null>(null);
  const [perMonth, setPerMonth] = useState<string | null>(null);
  const [compareAt, setCompareAt] = useState<string | null>(null);
  const fetched = useRef(false);

  // Store-localized prices (StoreKit displayPrice is the per-storefront truth).
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void (async () => {
      try {
        await initIAP();
        const products = await fetchSubscriptionProducts();
        const byId = new Map(products.map((p) => [p.id, p]));
        const yearly = byId.get('novame.plus.yearly');
        const monthly = byId.get('novame.plus.monthly');
        if (yearly?.displayPrice) setPriceYearly(yearly.displayPrice);
        if (monthly?.displayPrice) setPriceMonthly(monthly.displayPrice);
        const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')));
        const symbol = (dp?: string) => dp?.replace(/[\d.,\s]/g, '') || '$';
        const yNum = num(yearly?.price);
        const mNum = num(monthly?.price);
        if (Number.isFinite(yNum) && yNum > 0 && yearly?.displayPrice) {
          setPerMonth(`${symbol(yearly.displayPrice)}${(yNum / 12).toFixed(2)}`);
        }
        if (Number.isFinite(mNum) && mNum > 0 && monthly?.displayPrice) {
          setCompareAt(`${symbol(monthly.displayPrice)}${(mNum * 12).toFixed(2)}`);
        }
      } catch {
        // stub strings remain; StoreKit still rules the actual charge
      }
    })();
  }, []);

  // Global IAP listeners: close on success (no redundant alert — StoreKit
  // already confirmed), one-time notification prompt, friendly retry on error.
  useEffect(() => {
    const offComplete = onPurchaseComplete(() => {
      setBusy('idle');
      emitHomeRefresh();
      const promptNotif = shouldPromptNotifAfterPurchase();
      if (promptNotif) markNotifPromptedAfterPurchase();
      if (router.canGoBack()) router.back();
      if (promptNotif) {
        setTimeout(() => {
          router.push('/(main)/(modals)/notification-settings');
        }, 450);
      }
    });
    const offError = onPurchaseError((err) => {
      setBusy('idle');
      appAlert(
        'Purchase Failed',
        err.message || 'Something went wrong with the purchase. Please try again.',
      );
    });
    return () => {
      offComplete();
      offError();
    };
  }, []);

  const handleClose = () => {
    void haptics.light();
    emitHomeRefresh();
    router.back();
  };

  const handleRestore = async () => {
    if (busy !== 'idle') return;
    void haptics.light();
    setBusy('restoring');
    try {
      const result = await restoreSubscriptions();
      setBusy('idle');
      if (result.restored && result.tier) {
        appAlert('Restored', 'Your Plus subscription is now active.', [
          {
            text: 'OK',
            onPress: () => {
              emitHomeRefresh();
              if (router.canGoBack()) router.back();
            },
          },
        ]);
      } else {
        appAlert('Nothing to Restore', 'We did not find any prior subscription on this Apple ID.');
      }
    } catch (e) {
      setBusy('idle');
      appAlert('Restore Failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleSubscribe = async () => {
    if (busy !== 'idle') return;
    if (isPaid) {
      // Already subscribed: Apple rules forbid in-app cancel/manage.
      void Linking.openURL(
        Platform.OS === 'android'
          ? 'https://play.google.com/store/account/subscriptions'
          : 'https://apps.apple.com/account/subscriptions',
      );
      return;
    }
    void haptics.medium();
    setBusy('purchasing');
    try {
      const outcome = await purchaseSubscription(
        plan === 'yearly' ? 'novame.plus.yearly' : 'novame.plus.monthly',
      );
      if (outcome.kind === 'cancelled') {
        setBusy('idle');
        return;
      }
      if (outcome.kind === 'scheduled') {
        // Downgrade/crossgrade: no new transaction; lands at period end.
        setBusy('idle');
        appAlert(
          'Change Scheduled',
          'Your plan change takes effect at the end of the current billing period.',
          [{ text: 'OK', onPress: () => { if (router.canGoBack()) router.back(); } }],
        );
      }
      // 'completed' resolves through the global listener above.
    } catch (e) {
      setBusy('idle');
      appAlert('Purchase Failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F8E2C1' }}>
      <ExpoImage source={ICONS.obGridBg} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[styles.root, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={handleClose} style={[styles.closeCircle, { top: insets.top + 6 }]} hitSlop={10}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        {phase === 'benefits' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ flex: 1, minHeight: '100%' }}>
              <Text style={[styles.h1, { marginTop: 62 }]}>One Subscription for Two People.</Text>
              <Text style={[styles.body, { marginTop: 14 }]}>
                Store your memories, and theirs.{'\n'}Then connection happens naturally.
              </Text>
              <View style={styles.plusCard}>
                <ExpoImage source={ICONS.obPaywallUnlock} style={styles.lockImg} contentFit="contain" />
                <Text style={styles.plusTitle}>Burrow Plus</Text>
                {[
                  ['Save the Hustle', 'Let AI organize your memories with beautiful detail.'],
                  ['Connection Up', 'Real-time insights to help you understand each other better.'],
                  ['Vibe Up', 'Unlock new outfits and scenes for your bunny.'],
                  ['Unlock access to Master Visit', 'Get deeper insight of your day from Master.'],
                ].map(([t, b]) => (
                  <View key={t} style={styles.benefitRow}>
                    <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.benefitTitle}>{t}</Text>
                      <Text style={styles.benefitBody}>{b}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Pressable
                onPress={() => { void haptics.medium(); setPhase('plans'); }}
                style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.ctaText}>Try for Free</Text>
              </Pressable>
              <Pressable onPress={() => void handleRestore()} style={styles.restoreBtn} hitSlop={8}>
                {busy === 'restoring' ? (
                  <ActivityIndicator color={INK} size="small" />
                ) : (
                  <Text style={[styles.legalText, { marginBottom: insets.bottom + 8 }]}>Restore purchases</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { marginTop: 62, marginBottom: 26 }]}>Choose your plan</Text>
            <Pressable
              onPress={() => { void haptics.light(); setPlan('yearly'); }}
              style={[styles.planCard, plan === 'yearly' && styles.planCardOn]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>12 Months</Text>
                <Text style={styles.planPrice}>
                  <Text style={styles.planStrike}>{compareAt ?? '$119.98'}</Text>
                  {'  '}
                  {priceYearly ?? '$69.99'} ({perMonth ?? '$5.83'}/month)
                </Text>
              </View>
              <View style={styles.trialBadge}>
                <Text style={styles.trialBadgeText}>3 Days Free Trial</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => { void haptics.light(); setPlan('monthly'); }}
              style={[styles.planCard, plan === 'monthly' && styles.planCardOn]}
            >
              <View>
                <Text style={styles.planTitle}>Monthly</Text>
                <Text style={styles.planPrice}>{priceMonthly ?? '$6.99'} every month</Text>
              </View>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => void handleSubscribe()}
              disabled={busy !== 'idle'}
              style={({ pressed }) => [styles.cta, { opacity: busy !== 'idle' ? 0.6 : pressed ? 0.85 : 1 }]}
            >
              {busy === 'purchasing' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ctaText}>{isPaid ? 'Manage Subscription' : 'Start My Plan'}</Text>
              )}
            </Pressable>
            {/* Apple 3.1.2: price-per-period, auto-renew and trial terms on the
                purchase screen, plus working Privacy/Terms links. */}
            <Text style={styles.disclosure}>
              {plan === 'yearly'
                ? 'Burrow Plus Yearly: $69.99 per 12 months after a 3-day free trial. '
                : 'Burrow Plus Monthly: $6.99 per month. '}
              Subscription auto-renews unless cancelled at least 24 hours before the end
              of the current period. Manage or cancel anytime in your App Store settings.
            </Text>
            <View style={[styles.legalRow, { marginBottom: insets.bottom + 10, marginTop: 10 }]}>
              <Pressable onPress={() => void Linking.openURL('https://novameapp.com/privacy')} hitSlop={8}>
                <Text style={styles.legalLink}>Privacy</Text>
              </Pressable>
              <Pressable onPress={() => void handleRestore()} hitSlop={8}>
                <Text style={styles.legalText}>
                  {busy === 'restoring' ? 'Restoring…' : 'Restore purchases'}
                </Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL('https://novameapp.com/terms')} hitSlop={8}>
                <Text style={styles.legalLink}>Terms</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  closeCircle: {
    position: 'absolute', left: 0, zIndex: 3,
    width: 44, height: 44, borderRadius: 22, backgroundColor: BTN,
    alignItems: 'center', justifyContent: 'center',
  },

  disclosure: {
    fontSize: 11.5, lineHeight: 16, fontFamily: 'Inter_500Medium', color: '#7A6A52',
    textAlign: 'center', marginTop: 12, paddingHorizontal: 6,
  },
  legalLink: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6B5B44', textDecorationLine: 'underline' },
  h1: { fontSize: 27, lineHeight: 36, fontFamily: 'Inter_800ExtraBold', color: INK, textAlign: 'center' },
  body: { fontSize: 16.5, lineHeight: 24, fontFamily: 'Inter_500Medium', color: '#3A2E1A', textAlign: 'center' },

  plusCard: { backgroundColor: 'rgba(90,64,40,0.85)', borderRadius: 26, padding: 20, marginTop: 44 },
  lockImg: { width: 62, height: 62, alignSelf: 'center', marginTop: -52, marginBottom: 4 },
  plusTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  benefitRow: { flexDirection: 'row', gap: 12, marginBottom: 14, alignItems: 'flex-start' },
  benefitTitle: { fontSize: 16.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  benefitBody: { fontSize: 14.5, lineHeight: 20, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.92)', marginTop: 2 },

  planCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 22, padding: 20, marginBottom: 16,
    borderWidth: 2.5, borderColor: 'transparent',
  },
  planCardOn: { borderColor: BTN },
  planTitle: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#161311' },
  planPrice: { fontSize: 15.5, fontFamily: 'Inter_600SemiBold', color: '#2A2118', marginTop: 6 },
  planStrike: { textDecorationLine: 'line-through', color: '#8A7A63' },
  trialBadge: { backgroundColor: BTN, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  trialBadgeText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  legalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  legalText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: INK, textAlign: 'center' },
  restoreBtn: { alignItems: 'center', paddingVertical: 12 },

  cta: { backgroundColor: BTN, borderRadius: 18, paddingVertical: 18, alignItems: 'center' },
  ctaText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
});
