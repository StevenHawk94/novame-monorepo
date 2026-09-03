import { useEffect, useRef, useState } from 'react';
import { Platform, ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { router, useLocalSearchParams } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import {
  fetchSubscriptionProducts,
  getSubscriptionPlanPricing,
  initIAP,
  purchaseSubscription,
  restoreSubscriptions,
  onPurchaseComplete,
  onPurchaseError,
} from '@/lib/iap';
import { getCachedSubscription } from '@/lib/subscription';
import { supabase } from '@/lib/supabase';
import { emitHomeRefresh } from '@/lib/home-refresh-signal';
import {
  shouldPromptNotifAfterPurchase,
  markNotifPromptedAfterPurchase,
} from '@/lib/notification-settings';
import { ICONS } from '@/lib/icons';
import { DEFAULT_PLUS_BENEFITS } from '@/lib/plus-benefits';
import { GridBackground } from '@/components/ui/grid-background';

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
  const params = useLocalSearchParams<{ phase?: string }>();
  const isPaid = (getCachedSubscription()?.tier ?? 'free') !== 'free';

  const [phase, setPhase] = useState<Phase>(params.phase === 'plans' ? 'plans' : 'benefits');
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
        const yearly = getSubscriptionPlanPricing(products, 'yearly');
        const monthly = getSubscriptionPlanPricing(products, 'monthly');
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
  // already confirmed), then serialize account safety before notifications.
  useEffect(() => {
    const offComplete = onPurchaseComplete(() => {
      setBusy('idle');
      emitHomeRefresh();
      // Returning closes only the paywall; an underlying Reflect settlement
      // stays mounted and reacts to the refreshed tier. Keep the established
      // account-safety -> notification prompt sequence unchanged.
      const promptNotif = shouldPromptNotifAfterPurchase();
      if (promptNotif) markNotifPromptedAfterPurchase();
      if (router.canGoBack()) router.back();

      const openNotificationSetup = () => {
        if (promptNotif) router.push('/(main)/(modals)/notification-settings');
      };
      const continueToNotificationSetup = () => {
        // AppDialog clears its overlay before this navigation starts, so the
        // next native modal can never appear underneath the closing alert.
        setTimeout(openNotificationSetup, 200);
      };
      const openAccountConnection = () => {
        void haptics.pageOpen();
        router.push({
          pathname: '/(main)/(modals)/connect-account',
          params: {
            source: 'post-purchase',
            ...(promptNotif ? { after: 'notification-settings' } : {}),
          },
        } as never);
      };
      const confirmSkipAccountConnection = () => {
        // Let the first AppDialog fully release its overlay before presenting
        // the second confirmation. This avoids a one-frame invisible touch
        // blocker on Android while keeping the warning effectively immediate.
        setTimeout(() => {
          appAlert(
            'Keep your account safe',
            'We strongly recommend connecting an account. This helps keep your data and memories safe and recoverable if you change phones, reinstall the app, or clear app data.',
            [
              { text: 'Close Anyway', style: 'cancel', onPress: continueToNotificationSetup },
              { text: 'Connect Account', onPress: openAccountConnection },
            ],
          );
        }, 150);
      };

      // Resolve account state after dismissing the paywall, then present only
      // one surface at a time. The notification setup is continued from the
      // selected safety action instead of racing this alert on a timer.
      void (async () => {
        let needsAccountSafety = false;
        try {
          const { data } = await supabase.auth.getUser();
          const user = data.user;
          const anonymous = (user as { is_anonymous?: boolean } | null)?.is_anonymous ?? false;
          needsAccountSafety = !user || anonymous || !user.email;
        } catch (error) {
          console.warn('[paywall] account safety check failed:', error);
        }

        setTimeout(() => {
          if (!needsAccountSafety) {
            openNotificationSetup();
            return;
          }

          appAlert(
            'Keep your Plus safe',
            'Connect an account so your subscription and memories are never lost — even if you change phones.',
            [
              { text: 'Later', style: 'cancel', onPress: confirmSkipAccountConnection },
              {
                text: 'Connect Now',
                onPress: openAccountConnection,
              },
            ],
          );
        }, 450);
      })();
    });
    const offError = onPurchaseError((err) => {
      setBusy('idle');
      appAlert(
        err.code === 'pending' ? 'Payment Pending' : 'Purchase Failed',
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
      } else if (result.ownershipConflict) {
        appAlert('Purchase Linked to Another Account', result.ownershipConflict.message);
      } else if (result.pending) {
        appAlert(
          'Payment Pending',
          'Google Play is still processing your payment. Plus will activate automatically after Google confirms it.',
        );
      } else if (result.error) {
        appAlert('Restore Not Finished', result.error);
      } else {
        appAlert(
          'Nothing to Restore',
          Platform.OS === 'android'
            ? 'We did not find any prior subscription on this Google Play account.'
            : 'We did not find any prior subscription on this Apple ID.',
        );
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
      void haptics.pageOpen();
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
      <GridBackground />
      <View style={[styles.root, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={handleClose} style={[styles.closeCircle, { top: insets.top + 6 }]} hitSlop={10}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        {phase === 'benefits' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ flex: 1, minHeight: '100%' }}>
              <Text style={[styles.h1, { marginTop: 62 }]}>Feel closer through the little things.</Text>
              <View style={styles.plusCard}>
                <ExpoImage source={ICONS.obPaywallUnlock} style={styles.lockImg} contentFit="contain" />
                <Text style={styles.plusTitle}>Burrow Plus</Text>
                {DEFAULT_PLUS_BENEFITS.map((t, index) => (
                  <View key={t}>
                    <View style={styles.benefitRow}>
                      <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.benefitTitle}>{t}</Text>
                      </View>
                    </View>
                    {index < DEFAULT_PLUS_BENEFITS.length - 1 && <View style={styles.benefitDivider} />}
                  </View>
                ))}
              </View>
              <Text style={[styles.body, styles.subscriptionNote]}>
                One Plus subscription unlocks the full experience for both of you.
              </Text>
              <View style={{ flex: 1, minHeight: 20 }} />
              <Pressable
                onPress={() => { void haptics.pageOpen(); setPhase('plans'); }}
                style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.ctaText}>Start Free Trial</Text>
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
            <Text style={[styles.h1, { marginTop: 62 }]}>Choose your plan</Text>
            <Text style={styles.planSubtitle}>
              Link their account to yours in the app, and they’ll{`\n`}
              get access to all Plus features too.
            </Text>
            <Pressable
              onPress={() => { void haptics.light(); setPlan('yearly'); }}
              style={[styles.planCard, plan === 'yearly' && styles.planCardOn]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>12 Months</Text>
                <Text style={styles.planPrice}>
                  <Text style={styles.planStrike}>{compareAt ?? '$83.88'}</Text>
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
                <Text style={styles.ctaText}>
                  {isPaid
                    ? 'Manage Subscription'
                    : plan === 'yearly' ? 'Start Free Trial' : 'Start My Plan'}
                </Text>
              )}
            </Pressable>
            {/* Apple 3.1.2: price-per-period, auto-renew and trial terms on the
                purchase screen, plus working Privacy/Terms links. */}
            <Text style={styles.disclosure}>
              {plan === 'yearly'
                ? 'Burrow Plus Yearly: $69.99 per 12 months after a 3-day free trial. '
                : 'Burrow Plus Monthly: $6.99 per month. '}
              Subscription auto-renews unless cancelled at least 24 hours before the end
              of the current period. Manage or cancel anytime in your{' '}
              {Platform.OS === 'android' ? 'Google Play' : 'App Store'} settings.
            </Text>
            <View style={[styles.legalRow, { marginBottom: insets.bottom + 10, marginTop: 10 }]}>
              <Pressable onPress={() => { void haptics.pageOpen(); void Linking.openURL('https://www.burrow-app.com/privacy'); }} hitSlop={8}>
                <Text style={styles.legalLink}>Privacy</Text>
              </Pressable>
              <Pressable onPress={() => void handleRestore()} hitSlop={8}>
                <Text style={styles.legalText}>
                  {busy === 'restoring' ? 'Restoring…' : 'Restore purchases'}
                </Text>
              </Pressable>
              <Pressable onPress={() => { void haptics.pageOpen(); void Linking.openURL('https://www.burrow-app.com/terms'); }} hitSlop={8}>
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
    position: 'absolute', left: 10, zIndex: 3,
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
  subscriptionNote: { marginTop: 18, fontSize: 13.5, lineHeight: 20, paddingHorizontal: 12 },
  planSubtitle: {
    marginTop: 8, marginBottom: 26, paddingHorizontal: 10,
    fontSize: 13.5, lineHeight: 19, fontFamily: 'Inter_500Medium',
    color: '#3A2E1A', textAlign: 'center',
  },

  plusCard: { backgroundColor: 'rgba(90,64,40,0.85)', borderRadius: 26, padding: 20, marginTop: 44 },
  lockImg: { width: 62, height: 62, alignSelf: 'center', marginTop: -52, marginBottom: 4 },
  plusTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  benefitRow: { flexDirection: 'row', gap: 12, paddingVertical: 14, alignItems: 'center' },
  benefitDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  benefitTitle: { fontSize: 16.5, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

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
