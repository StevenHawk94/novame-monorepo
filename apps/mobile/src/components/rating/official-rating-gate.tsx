import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useSegments } from 'expo-router';
import * as StoreReview from 'expo-store-review';

import { subscribeOfficialRatingRequest } from '@/lib/official-rating-prompt';
import { getNextReflectionPaywallVariant, subscribeReflectionPaywallRequest } from '@/lib/reflection-paywall-count';
import {
  claimPartnerReflectPaywall,
  peekPartnerReflectPaywall,
  removePartnerReflectPaywall,
  subscribePartnerReflectPaywallRequest,
  syncPartnerReflectPaywallRequests,
} from '@/lib/partner-reflect-paywall';
import { isNavigationTransitionBusy, useRatingTransitionBusy } from '@/lib/rating-navigation';
import { useAppDialogVisible } from '@/components/ui/app-dialog';
import { useSubscriptionTierState } from '@/lib/use-subscription-tier';
import { useActiveModalSlot } from '@/lib/modal-coordinator';
import { isOverlayPresent, useOverlayPresent } from '@/lib/overlay-presence';
import { withDeadline } from '@/lib/async-lifecycle';
import { useHomeEntry } from '@/lib/use-home-entry';

let requestInFlight = false;

async function requestOfficialRating(canPresent: () => boolean): Promise<boolean> {
  if (requestInFlight || !canPresent()) return false;
  requestInFlight = true;
  try {
    const supported = await withDeadline(StoreReview.hasAction());
    if (!canPresent()) return false;
    if (supported) await StoreReview.requestReview();
    return true;
  } catch (error) {
    console.warn('[official-rating] request failed:', error);
    return true;
  } finally {
    requestInFlight = false;
  }
}

/** Non-blocking promotional queue. Partner Reflect offers have first priority. */
export function OfficialRatingGate() {
  const homeEntry = useHomeEntry();
  const segments = useSegments();
  const routeKey = useMemo(() => segments.join('/'), [segments]);
  const [pending, setPending] = useState(false);
  const [pendingPaywall, setPendingPaywall] = useState(false);
  const [partnerReflectId, setPartnerReflectId] = useState<string | null>(peekPartnerReflectPaywall);
  const [requestingRating, setRequestingRating] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const transitionBusy = useRatingTransitionBusy();
  const dialogVisible = useAppDialogVisible();
  const tier = useSubscriptionTierState();
  const activeModal = useActiveModalSlot();
  const overlayPresent = useOverlayPresent();
  const mounted = useRef(true);
  const presentingPaywall = useRef(false);
  const claimingPartner = useRef(false);
  const presentationRecovery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const routeSegments = routeKey.split('/');
  const atTabs = routeSegments.includes('(tabs)');
  const atReflectPicker = routeKey === '(main)/reflect';
  const idle = appState === 'active'
    && !homeEntry.pending
    && !homeEntry.resumeRequired
    && !transitionBusy
    && !dialogVisible
    && !activeModal
    && !overlayPresent;
  const eligibility = useRef({ paywall: false, rating: false });
  eligibility.current = {
    paywall: idle && tier === 'free' && (atTabs || atReflectPicker) && !presentingPaywall.current,
    rating: idle && (atTabs || atReflectPicker) && !partnerReflectId && !pendingPaywall && !presentingPaywall.current,
  };

  useEffect(() => subscribeOfficialRatingRequest(() => setPending(true)), []);
  useEffect(() => subscribeReflectionPaywallRequest(() => setPendingPaywall(true)), []);
  useEffect(() => subscribePartnerReflectPaywallRequest(() => {
    setPartnerReflectId(peekPartnerReflectPaywall());
  }), []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(presentationRecovery.current); };
  }, []);

  useEffect(() => {
    if (routeSegments.includes('partner-reflect-paywall')) {
      presentingPaywall.current = false;
      claimingPartner.current = false;
      clearTimeout(presentationRecovery.current);
    } else if (routeSegments.includes('reflection-plus-paywall')) {
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
    if (appState === 'active') void syncPartnerReflectPaywallRequests();
  }, [appState]);

  useEffect(() => {
    if (tier !== null && tier !== 'free') {
      if (pendingPaywall) setPendingPaywall(false);
      if (partnerReflectId) {
        removePartnerReflectPaywall(partnerReflectId);
        setPartnerReflectId(peekPartnerReflectPaywall());
      }
      return;
    }
    if (requestingRating) return;

    if (partnerReflectId) {
      if (!eligibility.current.paywall || claimingPartner.current) return;
      const frame = requestAnimationFrame(() => {
        if (!mounted.current || !eligibility.current.paywall || isNavigationTransitionBusy() || isOverlayPresent()) return;
        claimingPartner.current = true;
        void claimPartnerReflectPaywall(partnerReflectId).then((result) => {
          if (!mounted.current) return;
          claimingPartner.current = false;
          if (!result.ok) return;
          removePartnerReflectPaywall(partnerReflectId);
          setPartnerReflectId(peekPartnerReflectPaywall());
          if (!result.eligible || !result.assignment || !eligibility.current.paywall) return;
          presentingPaywall.current = true;
          try {
            router.push('/(main)/(modals)/partner-reflect-paywall' as never);
            clearTimeout(presentationRecovery.current);
            presentationRecovery.current = setTimeout(() => { presentingPaywall.current = false; }, 1500);
          } catch (error) {
            presentingPaywall.current = false;
            console.warn('[partner-reflect-paywall] presentation failed:', error);
          }
        });
      });
      return () => cancelAnimationFrame(frame);
    }

    if (pendingPaywall) {
      if (!eligibility.current.paywall) return;
      const frame = requestAnimationFrame(() => {
        if (!mounted.current || AppState.currentState !== 'active' || !eligibility.current.paywall || isNavigationTransitionBusy() || isOverlayPresent()) return;
        presentingPaywall.current = true;
        try {
          router.push({
            pathname: '/(main)/(modals)/reflection-plus-paywall',
            params: { variant: getNextReflectionPaywallVariant() },
          } as never);
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
  }, [appState, partnerReflectId, pending, pendingPaywall, requestingRating, routeKey, transitionBusy, dialogVisible, tier, activeModal, overlayPresent, homeEntry.pending, homeEntry.resumeRequired]);

  return null;
}
