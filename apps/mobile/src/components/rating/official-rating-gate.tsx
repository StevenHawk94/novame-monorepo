import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useSegments } from 'expo-router';
import * as StoreReview from 'expo-store-review';

import { subscribeOfficialRatingRequest } from '@/lib/official-rating-prompt';
import { getNextReflectionPaywallVariant, subscribeReflectionPaywallRequest } from '@/lib/reflection-paywall-count';
import { isNavigationTransitionBusy, useRatingTransitionBusy } from '@/lib/rating-navigation';
import { useAppDialogVisible } from '@/components/ui/app-dialog';
import { useSubscriptionTierState } from '@/lib/use-subscription-tier';
import { useActiveModalSlot } from '@/lib/modal-coordinator';
import { isOverlayPresent, useOverlayPresent } from '@/lib/overlay-presence';
import { withDeadline } from '@/lib/async-lifecycle';

let requestInFlight = false;

async function requestOfficialRating(canPresent: () => boolean): Promise<boolean> {
  if (requestInFlight || !canPresent()) return false;
  requestInFlight = true;
  try {
    const supported = await withDeadline(StoreReview.hasAction());
    // Eligibility may change while the store bridge is preparing its dialog.
    if (!canPresent()) return false;
    if (supported) {
      await StoreReview.requestReview();
    }
    return true;
  } catch (error) {
    console.warn('[official-rating] request failed:', error);
    return true;
  } finally {
    requestInFlight = false;
  }
}

/**
 * Non-blocking post-Reflect queue. A due Free paywall has priority over rating.
 * Present on the first frame after native dismissal, without a fixed delay.
 * Both the Reflect picker and base tabs are safe destinations. A due paywall
 * goes first; rating waits for that paywall/other modals to close.
 */
export function OfficialRatingGate() {
  const segments = useSegments();
  const routeKey = useMemo(() => segments.join('/'), [segments]);
  const [pending, setPending] = useState(false);
  const [pendingPaywall, setPendingPaywall] = useState(false);
  const [requestingRating, setRequestingRating] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const transitionBusy = useRatingTransitionBusy();
  const dialogVisible = useAppDialogVisible();
  const tier = useSubscriptionTierState();
  const activeModal = useActiveModalSlot();
  const overlayPresent = useOverlayPresent();
  const mounted = useRef(true);
  const presentingPaywall = useRef(false);
  const presentationRecovery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const routeSegments = routeKey.split('/');
  const atTabs = routeSegments.includes('(tabs)');
  const atReflectPicker = routeKey === '(main)/reflect';
  const idle = appState === 'active' && !transitionBusy && !dialogVisible && !activeModal && !overlayPresent;
  const eligibility = useRef({ paywall: false, rating: false });
  eligibility.current = {
    paywall: idle && tier === 'free' && (atTabs || atReflectPicker) && !presentingPaywall.current,
    rating: idle && (atTabs || atReflectPicker) && !pendingPaywall && !presentingPaywall.current,
  };

  useEffect(() => subscribeOfficialRatingRequest(() => setPending(true)), []);
  useEffect(() => subscribeReflectionPaywallRequest(() => setPendingPaywall(true)), []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(presentationRecovery.current); };
  }, []);

  useEffect(() => {
    if (routeSegments.includes('reflection-plus-paywall')) {
      // A push request is not proof of presentation. Consume only on commit.
      setPendingPaywall(false);
      presentingPaywall.current = false;
      clearTimeout(presentationRecovery.current);
    }
  }, [routeKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // A purchase/paired entitlement obtained while waiting cancels the upsell.
    // Null means hydration is in progress, not that the user is Free.
    if (pendingPaywall && tier !== null && tier !== 'free') {
      setPendingPaywall(false);
      return;
    }
    if (requestingRating) return;
    if (pendingPaywall) {
      if (!eligibility.current.paywall) return;
      const frame = requestAnimationFrame(() => {
        if (!mounted.current || AppState.currentState !== 'active' || !eligibility.current.paywall || isNavigationTransitionBusy() || isOverlayPresent()) return;
        presentingPaywall.current = true;
        eligibility.current.paywall = false;
        eligibility.current.rating = false;
        try {
          router.push({
            pathname: '/(main)/(modals)/reflection-plus-paywall',
            params: { variant: getNextReflectionPaywallVariant() },
          } as never);
          // Recovery only: no delay before opening and no screen-wide lock.
          // If navigation is rejected, the next eligible visit can retry.
          clearTimeout(presentationRecovery.current);
          presentationRecovery.current = setTimeout(() => { presentingPaywall.current = false; }, 1500);
        } catch (error) {
          presentingPaywall.current = false;
          console.warn('[reflection-paywall] presentation failed:', error);
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!pending || !eligibility.current.rating) return;
    const frame = requestAnimationFrame(() => {
      if (!mounted.current || !eligibility.current.rating || isNavigationTransitionBusy() || isOverlayPresent()) return;
      setRequestingRating(true);
      void requestOfficialRating(() => mounted.current && AppState.currentState === 'active' && eligibility.current.rating && !isNavigationTransitionBusy() && !isOverlayPresent())
        .then((handled) => {
          if (!mounted.current) return;
          if (handled) setPending(false);
          setRequestingRating(false);
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [appState, pending, pendingPaywall, requestingRating, routeKey, transitionBusy, dialogVisible, tier, activeModal, overlayPresent]);

  return null;
}
