import { useEffect, useState } from 'react';
import { userErrorMessage } from '@/lib/user-error-message';
import { Platform, Linking } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { router } from 'expo-router';

import { haptics } from '@/lib/haptics';
import {
  purchaseSubscription,
  restoreSubscriptions,
  onPurchaseComplete,
  onPurchaseError,
} from '@/lib/iap';
import { getCachedSubscription } from '@/lib/subscription';
import { supabase } from '@/lib/supabase';
import { emitHomeRefresh } from '@/lib/home-refresh-signal';
import { BurrowPaywallPage } from '@/components/paywall/burrow-paywall-page';
import { useStoreSubscriptionPricing } from '@/hooks/use-store-subscription-pricing';

/**
 * One shared two-step presentation for every entry, including onboarding
 * and historical promotion routes. Monthly/yearly store products unchanged.
 *
 * Behaviors preserved from the previous paywall: global purchase listeners
 * (complete → home refresh + account safety + dismiss;
 * error → alert), restore purchases (App Store requirement), dismiss →
 * home refresh, already-subscribed → Apple's manage-subscriptions page,
 * 'scheduled' outcomes explained (the one alert that must stay).
 */
type Phase = 'benefits' | 'plans';

export default function SubscriptionPaywallModal({ onContinue, onClose }: { onContinue?: () => void; onClose?: () => void } = {}) {
  const isPaid = (getCachedSubscription()?.tier ?? 'free') !== 'free';

  const [phase, setPhase] = useState<Phase>('benefits');
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const [busy, setBusy] = useState<'idle' | 'purchasing' | 'restoring'>('idle');
  const [openingPlans, setOpeningPlans] = useState(false);
  const {
    pricing,
    status: priceStatus,
    load: loadPrices,
    retry: retryPrices,
  } = useStoreSubscriptionPricing(true);

  // Global IAP listeners: close on success (no redundant alert — StoreKit
  // already confirmed), then offer account safety without notification setup.
  useEffect(() => {
    const offComplete = onPurchaseComplete(() => {
      setBusy('idle');
      emitHomeRefresh();
      // Returning closes only the paywall; an underlying Reflect settlement
      // stays mounted and reacts to the refreshed tier. Keep the established
      // account-safety prompts, but never chain notification setup.
      if (router.canGoBack()) router.back();
      const openAccountConnection = () => {
        void haptics.pageOpen();
        router.push({
          pathname: '/(main)/(modals)/connect-account',
          params: {
            source: 'post-purchase',
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
              { text: 'Close Anyway', style: 'cancel' },
              { text: 'Connect Account', onPress: openAccountConnection },
            ],
          );
        }, 150);
      };

      // Resolve account state after dismissing the paywall, then present only
      // one surface at a time. Connected users need no additional setup.
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
          if (!needsAccountSafety) return;

          appAlert(
            'Keep your Plus safe',
            "Connect an account so your data can be safe.",
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
        userErrorMessage(err,'Couldn’t finish the purchase. Please try again.'),
      );
    });
    return () => {
      offComplete();
      offError();
    };
  }, []);

  const handleClose = () => {
    onClose?.();
    void haptics.light();
    emitHomeRefresh();
    router.back();
  };

  const handleOpenPlans = async () => {
    if (openingPlans) return;
    void haptics.pageOpen();
    setOpeningPlans(true);
    const loaded = pricing ?? await loadPrices();
    setOpeningPlans(false);
    if (!loaded) {
      appAlert(
        'Prices unavailable',
        `We couldn’t load prices from ${Platform.OS === 'android' ? 'Google Play' : 'the App Store'}. Check your connection and try again.`,
      );
      return;
    }
    onContinue?.();
    setPhase('plans');
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
    if (!pricing) {
      appAlert(
        'Prices unavailable',
        `We couldn’t load prices from ${Platform.OS === 'android' ? 'Google Play' : 'the App Store'}. Please retry before subscribing.`,
      );
      void retryPrices();
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

  return <BurrowPaywallPage phase={phase} pricing={pricing} priceError={priceStatus === 'error'}
    plan={plan} onSelectPlan={value => { void haptics.light(); setPlan(value); }}
    onClose={handleClose} onBack={() => setPhase('benefits')}
    onContinue={() => void handleOpenPlans()} onPurchase={() => void handleSubscribe()}
    onRestore={() => void handleRestore()} onRetry={() => void retryPrices()}
    openingPlans={openingPlans} purchasing={busy === 'purchasing'} restoring={busy === 'restoring'} isPaid={isPaid}/>;
}
