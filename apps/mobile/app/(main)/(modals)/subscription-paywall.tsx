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
} from '@/lib/iap';

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

const TERMS_URL = 'https://api.soulsayit.com/terms';
const PRIVACY_URL = 'https://api.soulsayit.com/privacy';

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
  // Stage 5.IAP.3: buy / restore in-flight indicator. Used to disable
  // the Subscribe and Restore buttons while StoreKit is busy so the
  // user can't double-tap or fire a restore mid-purchase.
  const [busy, setBusy] = useState<'idle' | 'purchasing' | 'restoring'>(
    'idle',
  );

  // Stage 5.IAP.3: listen for the global IAP listener's outcome events.
  // The listener lives in app/_layout.tsx, registers once, and fires
  // here when our own purchaseSubscription() resolves on the StoreKit
  // side AND the server upload completes. The paywall is responsible
  // only for closing itself + showing the right alert.
  useEffect(() => {
    const offComplete = onPurchaseComplete(({ tier, cycle: cyc }) => {
      setBusy('idle');
      Alert.alert(
        'Subscription Active',
        `Welcome to ${PRICING_TIERS[tier].name} (${cyc}). Your subscription is now active.`,
        [
          {
            text: 'OK',
            onPress: () => {
              if (router.canGoBack()) router.back();
            },
          },
        ],
      );
    });
    const offError = onPurchaseError((err) => {
      setBusy('idle');
      // user-cancelled is filtered inside lib/iap.ts so we never see
      // it here. All remaining errors merit a friendly message.
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
                if (router.canGoBack()) router.back();
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
    void haptics.medium();
    // Compose product ID from the current selection. Must match the 6
    // App Store Connect product IDs in IOS_SUBSCRIPTION_PRODUCT_IDS.
    const productId = `novame.${selected}.${cycle}` as IOSSubscriptionProductId;
    if (!IOS_SUBSCRIPTION_PRODUCT_IDS.includes(productId)) {
      Alert.alert('Invalid Product', `Product ${productId} is not configured.`);
      return;
    }
    setBusy('purchasing');
    try {
      // Triggers the StoreKit dialog. The result arrives via the
      // global purchaseUpdatedListener in lib/iap.ts, which fires the
      // onPurchaseComplete callback we registered in the useEffect
      // above. So we don't await a result here -- we just await the
      // dialog dismiss, then either the listener fires (success) or
      // the user cancelled (silent, busy reset by error listener
      // filter -- but to be safe, we also reset on the next mount /
      // user retry).
      await purchaseSubscription(productId);
      // If we got here without the listener firing yet, leave busy set
      // -- onPurchaseComplete / onPurchaseError will clear it. If the
      // user cancelled, neither fires (UserCancelled is silent), so we
      // need to clear busy after a short delay to let the dialog
      // animate closed.
      setTimeout(() => {
        setBusy((b) => (b === 'purchasing' ? 'idle' : b));
      }, 600);
    } catch (e) {
      // requestPurchase throws on configuration errors only; user
      // cancellation does not throw. So this branch means something
      // is misconfigured.
      setBusy('idle');
      Alert.alert(
        'Purchase Failed',
        e instanceof Error ? e.message : 'Please try again.',
      );
    }
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
            return (
              <Pressable
                key={key}
                onPress={() => {
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
        <Pressable
          onPress={handleSubscribe}
          style={({ pressed }) => [
            styles.subscribeBtn,
            { opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.subscribeBtnText}>Subscribe</Text>
        </Pressable>
        <View style={styles.footerLinks}>
          <Pressable onPress={() => openLink(TERMS_URL)} hitSlop={6}>
            <Text style={styles.footerLink}>Terms of Use</Text>
          </Pressable>
          <Text style={styles.footerSep}>Cancel anytime</Text>
          <Pressable onPress={() => openLink(PRIVACY_URL)} hitSlop={6}>
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
