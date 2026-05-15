import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import {
  PRICING_TIERS,
  type PricingTierKey,
} from '@novame/core';

import { haptics } from '@/lib/haptics';
import {
  IOS_SUBSCRIPTION_PRODUCT_IDS,
  type IOSSubscriptionProductId,
  purchaseSubscription,
  restoreSubscriptions,
  onPurchaseComplete,
  onPurchaseError,
  classifySubscriptionChange,
  type SubscriptionChange,
} from '@/lib/iap';
import { getCachedSubscription } from '@/lib/subscription';
import { emitHomeRefresh } from '@/lib/home-refresh-signal';

/**
 * Subscription Paywall overlay -- Stage 3.10.4.
 *
 * Entry: Plan & Billing 'Upgrade Plan' button. Will also be triggered
 * from quota-exceeded paths in record.tsx once Stage 5 IAP lands; for
 * now the only entry is manual.
 *
 * Layout (1:1 with the design spec):
 *   - Header: close X (left) / Restore (right -- stub Alert).
 *   - Title: "NOVAME [PLUS]" + "Unlock Your Full Potential" (2-line,
 *     second line is purple).
 *   - Description copy.
 *   - Monthly / Yearly billing-cycle toggle (yearly displays a green
 *     'Save' chip).
 *   - 3 tier cards (Basic / Pro / Ultra), Pro pre-selected.
 *     Each card shows: icon, tier name, insights/month, price for the
 *     selected cycle, /-savings chip on yearly cards.
 *   - Apple ID auto-renew disclaimer.
 *   - Sticky 'Subscribe' button at the bottom (stub Alert).
 *   - Footer: Terms of Use link / 'Cancel anytime' text / Privacy
 *     Policy link.
 *
 * Yearly insights == monthly insights -- the yearly cycle is just a
 * cheaper way to buy the same monthly quota for 12 months. The PRICING
 * source is packages/core PRICING_TIERS, which the server uses too,
 * so quota / pricing stays single-source-of-truth.
 *
 * Stub behaviour:
 *   - Subscribe -> Alert "IAP launching in Stage 5".
 *   - Restore   -> Alert "IAP launching in Stage 5".
 *
 * Stage 5 (B58) wires real expo-iap or react-native-iap calls in here.
 */

const TERMS_URL = 'https://novameapp.com/terms';
const PRIVACY_URL = 'https://novameapp.com/privacy';

type Cycle = 'monthly' | 'yearly';

type TierDisplay = {
  key: Exclude<PricingTierKey, 'free'>;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const PAID_TIERS: TierDisplay[] = [
  { key: 'basic', icon: 'auto-awesome' },
  { key: 'pro', icon: 'diamond' },
  { key: 'ultra', icon: 'workspace-premium' },
];

function calcSaving(monthly: number, yearly: number): number {
  if (monthly <= 0) return 0;
  return Math.round((1 - yearly / (monthly * 12)) * 100);
}

export default function SubscriptionPaywallModal() {
  const insets = useSafeAreaInsets();
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [selected, setSelected] = useState<TierDisplay['key']>('pro');

  // Stage 5.IAP.5: read current subscription so the paywall can
  // distinguish new / upgrade / downgrade / crossgrade and show the
  // right CTA + hint banner. The cache is updated by lib/iap.ts after
  // a successful purchase; before the user has any subscription it's
  // null (which we treat as { tier: 'free' }).
  const cachedSub = getCachedSubscription();
  const currentTier: PricingTierKey = cachedSub?.tier ?? 'free';
  // Note: cachedSub does not store cycle today (subscription.ts only
  // stores tier + lastFetchedAtMs). When tier !== 'free' but cycle
  // is unknown, we err on the side of treating cycle as 'monthly' --
  // this means a basic-yearly user selecting basic-monthly will be
  // classified as 'crossgrade' which is the safe (deferred) handling.
  const currentCycle: Cycle =
    (cachedSub as { cycle?: Cycle } | null)?.cycle === 'yearly'
      ? 'yearly'
      : 'monthly';

  // Pending change classification (recomputed on every cycle/selected
  // change). Drives the CTA label, hint banner, and disabled state.
  const pendingChange: SubscriptionChange = classifySubscriptionChange(
    { tier: currentTier, cycle: currentCycle },
    { tier: selected, cycle },
  );
  // Stage 5.IAP.5: in-flight indicator (disable repeat taps).
  const [busy, setBusy] = useState<'idle' | 'purchasing' | 'restoring'>(
    'idle',
  );

  // Stage 5.IAP.5: listen for the global IAP listener's outcome events.
  // Industry standard (RevenueCat / Adapty / Apphud): on completed
  // purchase, just close the paywall -- do NOT pop a redundant alert.
  // Apple's own StoreKit dialog already showed "You're All Set" before
  // returning control to us. Any extra alert is double-confirmation
  // friction that hurts conversion. The next screen (Me page) will
  // reflect the new tier on its next focus.
  useEffect(() => {
    const offComplete = onPurchaseComplete(() => {
      setBusy('idle');
      // Stage 5.WR.2 (Bug 2 fix, third pass): notify home tab of
      // subscription tier change (free → paid). Paywall doesn't
      // refresh home itself; the signal lets home subscribers refetch.
      emitHomeRefresh();
      if (router.canGoBack()) router.back();
    });
    const offError = onPurchaseError((err) => {
      setBusy('idle');
      // user-cancelled is filtered inside lib/iap.ts -- we never see
      // it here. Other errors deserve a friendly retry message.
      Alert.alert(
        'Purchase Failed',
        err.message ||
          'Something went wrong with the purchase. Please try again.',
      );
    });
    return () => {
      offComplete();
      offError();
    };
  }, []);

  const handleClose = () => {
    void haptics.light();
    // Stage 5.WR.2 (Bug 2 fix, third pass): user dismissing paywall
    // (without purchase) still warrants a home refresh — they may
    // have changed mode or other state via deep links / context
    // switches we don't track here.
    emitHomeRefresh();
    router.back();
  };

  const handleRestore = async () => {
    if (busy !== 'idle') return;
    void haptics.light();
    setBusy('restoring');
    try {
      const result = await restoreSubscriptions();
      // setBusy is reset inside the onPurchaseComplete listener when a
      // restore actually triggers a tier write -- BUT restore can also
      // succeed-but-find-nothing, which never fires the listener. So
      // we explicitly clear busy here too.
      setBusy('idle');
      if (result.restored && result.tier) {
        Alert.alert(
          'Restored',
          `Your ${PRICING_TIERS[result.tier].name} subscription is now active.`,
          [
            {
              text: 'OK',
              onPress: () => {
                emitHomeRefresh(); if (router.canGoBack()) router.back();
              },
            },
          ],
        );
      } else {
        Alert.alert(
          'Nothing to Restore',
          'We did not find any prior subscription on this Apple ID.',
        );
      }
    } catch (e) {
      setBusy('idle');
      Alert.alert(
        'Restore Failed',
        e instanceof Error ? e.message : 'Please try again.',
      );
    }
  };

  const handleSubscribe = async () => {
    if (busy !== 'idle') return;
    if (pendingChange === 'same') {
      // Stage 5.IAP.x.bugfix: take user to iOS subscription
      // management page (App Store rules forbid in-app cancel).
      void Linking.openURL('https://apps.apple.com/account/subscriptions');
      return;
    }
    void haptics.medium();
    const productId = `novame.${selected}.${cycle}` as IOSSubscriptionProductId;
    if (!IOS_SUBSCRIPTION_PRODUCT_IDS.includes(productId)) {
      Alert.alert('Invalid Product', `Product ${productId} is not configured.`);
      return;
    }
    setBusy('purchasing');
    try {
      const outcome = await purchaseSubscription(productId);

      if (outcome.kind === 'cancelled') {
        // User dismissed the StoreKit dialog -- silent.
        setBusy('idle');
        return;
      }

      if (outcome.kind === 'scheduled') {
        // Apple StoreKit 2: downgrade or crossgrade. NO new transaction
        // fires; the change lands at the end of the current period.
        // Tell the user explicitly because there's no other UI signal
        // (no charge, no immediate tier change). This is the one alert
        // we MUST keep -- the timing info has no other surface.
        setBusy('idle');
        const tierName = PRICING_TIERS[selected].name;
        const cycleLabel = cycle === 'yearly' ? 'Annual' : 'Monthly';
        Alert.alert(
          'Change Scheduled',
          `Your plan will switch to ${tierName} (${cycleLabel}) at the end of your current billing period. Until then, your current plan stays active.`,
          [
            {
              text: 'OK',
              onPress: () => {
                emitHomeRefresh(); if (router.canGoBack()) router.back();
              },
            },
          ],
        );
        return;
      }

      // outcome.kind === 'completed' -- immediate purchase. Listener
      // will fire shortly with server-confirmed tier; the useEffect
      // above closes the paywall on that event. Leave busy=purchasing
      // so the button stays disabled while the listener catches up.
      //
      // Safety net (Stage 6 fix): if the listener somehow doesn't
      // fire within 5s, we previously only reset busy -- leaving
      // the user staring at a paywall they thought completed (and
      // had been charged for, in sandbox sometimes). Now we also
      // refresh the subscription cache and close the paywall, on
      // the assumption that the purchase DID complete server-side
      // (StoreKit returned a Purchase, that's the contract) and the
      // problem is somewhere in our listener pipeline. The user
      // gets out of the paywall; the Me page will reflect the new
      // tier on next focus.
      //
      // Common reason for listener to not fire: iap.ts's
      // processedTransactionIds set has the txnId from initIAP
      // recovery, so the listener short-circuits. The Stage 6 fix
      // to recovery (release transient-failure ids) addresses this
      // at the source. This safety net is the belt to that
      // suspenders -- so a future regression of the same class
      // doesn't trap users on the paywall again.
      setTimeout(() => {
        setBusy((b) => {
          if (b !== 'purchasing') return b; // already settled
          // Refresh tier cache and close. emitHomeRefresh so home
          // tab picks up any character/quota changes.
          emitHomeRefresh();
          if (router.canGoBack()) router.back();
          return 'idle';
        });
      }, 5000);
    } catch (e) {
      setBusy('idle');
      Alert.alert(
        'Purchase Failed',
        e instanceof Error ? e.message : 'Please try again.',
      );
    }
  };

  // Industry-standard CTA labels. Apple HIG + Adapty / RevenueCat
  // recommendations: the button text should reflect what the action
  // will actually do, not a generic "Subscribe" word. This reduces
  // post-tap confusion ("did I just buy something?").
  const ctaLabel = (): string => {
    if (busy === 'purchasing') return 'Processing...';
    if (busy === 'restoring') return 'Restoring...';
    if (pendingChange === 'same') return 'Manage Subscription';
    if (pendingChange === 'new') return 'Subscribe';
    if (pendingChange === 'upgrade') {
      return `Upgrade to ${PRICING_TIERS[selected].name}`;
    }
    if (pendingChange === 'downgrade') return 'Schedule Downgrade';
    if (pendingChange === 'crossgrade') {
      return cycle === 'yearly'
        ? 'Switch to Annual'
        : 'Switch to Monthly';
    }
    return 'Subscribe';
  };

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 12, paddingBottom: 200 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: close + Restore */}
        <View style={styles.header}>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={handleRestore} hitSlop={8}>
            <Text style={styles.restoreText}>Restore</Text>
          </Pressable>
        </View>

        {/* Title block */}
        <View style={styles.brandRow}>
          <Text style={styles.brandText}>NOVAME</Text>
          <View style={styles.plusBadge}>
            <Text style={styles.plusBadgeText}>PLUS</Text>
          </View>
        </View>
        <Text style={styles.heroLine1}>Unlock Your</Text>
        <Text style={styles.heroLine2}>Full Potential</Text>
        <Text style={styles.heroDesc}>
          Stop Overlooking Your Brilliance. Turn Your Life Into a
          Masterpiece of Wisdom. Unlock Your Path to a Better Self.
        </Text>

        {/* Monthly / Yearly toggle */}
        <View style={styles.toggleWrap}>
          <Pressable
            onPress={() => {
              void haptics.selection();
              setCycle('monthly');
            }}
            style={[
              styles.toggleBtn,
              cycle === 'monthly' && styles.toggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                cycle === 'monthly' && styles.toggleTextActive,
              ]}
            >
              Monthly
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void haptics.selection();
              setCycle('yearly');
            }}
            style={[
              styles.toggleBtn,
              cycle === 'yearly' && styles.toggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                cycle === 'yearly' && styles.toggleTextActive,
              ]}
            >
              Yearly
            </Text>
            <View style={styles.saveChip}>
              <Text style={styles.saveChipText}>Save</Text>
            </View>
          </Pressable>
        </View>

        {/* Tier cards */}
        <View style={styles.tierList}>
          {PAID_TIERS.map(({ key, icon }) => {
            const t = PRICING_TIERS[key];
            const isSelected = selected === key;
            const price = cycle === 'monthly' ? t.monthlyPrice : t.yearlyPrice;
            const saving = calcSaving(t.monthlyPrice, t.yearlyPrice);
            // Stage 5.IAP.5: this card == user's CURRENT active sub if
            // both tier AND cycle match. A basic-monthly user looking
            // at the basic-yearly card is NOT current -- they're
            // considering a crossgrade (which is deferred per Apple).
            const isCurrent =
              currentTier === key && currentCycle === cycle;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  // Stage 5.IAP.x.bugfix: current plan IS selectable
                  // now. Selecting it -> CTA becomes "Manage
                  // Subscription" which opens iOS subscription page.
                  void haptics.selection();
                  setSelected(key);
                }}
                style={({ pressed }) => [
                  styles.tierCard,
                  isSelected && styles.tierCardSelected,
                  { opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <View
                  style={[
                    styles.tierIconWrap,
                    isSelected && styles.tierIconWrapSelected,
                  ]}
                >
                  <MaterialIcons
                    name={icon}
                    size={22}
                    color={isSelected ? '#C084FC' : 'rgba(255,255,255,0.5)'}
                  />
                </View>
                <View style={styles.tierMid}>
                  <View style={styles.tierNameRow}>
                    <Text style={styles.tierName}>{t.name}</Text>
                    {isCurrent ? (
                      <View style={styles.currentBadge}>
                        <Text style={styles.currentBadgeText}>CURRENT</Text>
                      </View>
                    ) : null}
                    {cycle === 'yearly' && saving > 0 ? (
                      <View style={styles.savingChip}>
                        <Text style={styles.savingChipText}>-{saving}%</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.tierInsights}>
                    {t.monthlyAnalyses} insights/month
                  </Text>
                </View>
                <View style={styles.tierPriceWrap}>
                  <Text style={styles.tierPrice}>${price.toFixed(2)}</Text>
                  <Text style={styles.tierPriceUnit}>
                    /{cycle === 'monthly' ? 'month' : 'year'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Auto-renew disclaimer */}
        <Text style={styles.disclaimer}>
          Subscription auto-renews. Cancel anytime in iPhone Settings →
          Apple ID → Subscriptions. Payment charged to your Apple ID at
          confirmation.
        </Text>
      </ScrollView>

      {/* Sticky bottom: Subscribe + footer links */}
      <View
        style={[
          styles.stickyBottom,
          { paddingBottom: insets.bottom + 12 },
        ]}
      >
        {pendingChange === 'upgrade' ? (
          <View style={styles.hintBannerUpgrade}>
            <Text style={styles.hintBannerText}>
              Starts immediately. Unused time on your current plan is credited toward the new one.
            </Text>
          </View>
        ) : null}
        {pendingChange === 'downgrade' || pendingChange === 'crossgrade' ? (
          <View style={styles.hintBannerScheduled}>
            <Text style={styles.hintBannerText}>
              Your current plan stays active until the end of the billing period. The new plan takes effect then.
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleSubscribe}
          disabled={busy !== 'idle'}
          style={({ pressed }) => [
            styles.subscribeBtn,
            busy !== 'idle' && { opacity: 0.5 },
            { opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.subscribeBtnText}>{ctaLabel()}</Text>
        </Pressable>
        <View style={styles.footerLinks}>
          <Pressable onPress={() => { void haptics.light(); openLink(TERMS_URL); }} hitSlop={6}>
            <Text style={styles.footerLink}>Terms of Use</Text>
          </Pressable>
          <Text style={styles.footerSep}>Cancel anytime</Text>
          <Pressable onPress={() => { void haptics.light(); openLink(PRIVACY_URL); }} hitSlop={6}>
            <Text style={styles.footerLink}>Privacy Policy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  scroll: {
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
  // Title
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  brandText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  plusBadge: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  plusBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  heroLine1: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 42,
  },
  heroLine2: {
    color: '#C084FC',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 42,
    marginBottom: 16,
  },
  heroDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 28,
  },
  // Toggle
  toggleWrap: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    padding: 4,
    marginBottom: 24,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toggleBtnActive: {
    backgroundColor: '#7C3AED',
  },
  toggleText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '700',
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },
  saveChip: {
    backgroundColor: 'rgba(52,211,153,0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  saveChipText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '700',
  },
  // Tier cards
  tierList: {
    gap: 12,
    marginBottom: 24,
  },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tierCardSelected: {
    backgroundColor: 'rgba(168,85,247,0.1)',
    borderColor: 'rgba(168,85,247,0.5)',
  },
  tierIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierIconWrapSelected: {
    backgroundColor: 'rgba(168,85,247,0.2)',
  },
  tierMid: {
    flex: 1,
  },
  tierNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  tierName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  savingChip: {
    backgroundColor: 'rgba(52,211,153,0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  savingChipText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '700',
  },
  tierInsights: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
  tierPriceWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  tierPrice: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  tierPriceUnit: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginLeft: 2,
  },
  // Disclaimer
  disclaimer: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  // Sticky bottom
  stickyBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: '#0F0B2E',
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(168,85,247,0.3)',
    marginRight: 6,
  },
  currentBadgeText: {
    color: '#C084FC',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  hintBannerUpgrade: {
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderColor: 'rgba(52,211,153,0.2)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  hintBannerScheduled: {
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderColor: 'rgba(251,191,36,0.2)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  hintBannerText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    lineHeight: 17,
  },
  subscribeBtn: {
    paddingVertical: 18,
    backgroundColor: '#A855F7',
    borderRadius: 999,
    alignItems: 'center',
    marginBottom: 12,
  },
  subscribeBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  footerLink: {
    color: '#C084FC',
    fontSize: 12,
    fontWeight: '500',
  },
  footerSep: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
});
